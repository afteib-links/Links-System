// Portable, fictional verification data only. Never accepts links_system or arbitrary dumps.
const fs=require('node:fs/promises');
const io=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Readable}=require('node:stream');
const readline=require('node:readline');
const R=require('./runtime');
const S=require('./scenarios');
async function hash(file){const h=crypto.createHash('sha256');for await(const chunk of io.createReadStream(file))h.update(chunk);return h.digest('hex');}
function child(root,relative){const file=path.resolve(root,relative);if(!file.startsWith(path.resolve(root)+path.sep))throw new Error('Unsafe package path');return file;}
async function tableInfo(pool){const [tables]=await pool.query('SHOW FULL TABLES');const result=[];for(const row of tables){if(Object.values(row)[1]!=='BASE TABLE')continue;const name=Object.values(row)[0];if(name==='sessions')continue;if(!/^\w+$/.test(name))throw new Error('Unsafe table name');const [cols]=await pool.query(`SHOW COLUMNS FROM \`${name}\``);result.push({name,columns:cols.filter(c=>!c.Extra.includes('GENERATED')).map(c=>c.Field)});}return result.sort((a,b)=>a.name.localeCompare(b.name));}
async function exportPackage(pool,env,dest){
  await require('./verify').verify(pool,env);
  const generation=JSON.parse(await fs.readFile(path.join(env.out,'generation.json'),'utf8'));
  if(generation.status!=='complete'||generation.database!==env.db)throw new Error('Only a completed verification generation can be packaged');
  await fs.mkdir(dest,{recursive:false});
  const tables=await tableInfo(pool),files=[];
  await fs.mkdir(path.join(dest,'tables'));
  for(const t of tables){
    const file=`tables/${t.name}.jsonl.gz`;let count=0;
    async function* rows(){
      const stream=pool.pool.query(`SELECT * FROM \`${t.name}\``).stream({highWaterMark:8});
      for await(const row of stream){count++;yield JSON.stringify(t.columns.map(k=>row[k]))+'\n';}
    }
    await pipeline(Readable.from(rows()),zlib.createGzip(),io.createWriteStream(child(dest,file),{flags:'wx'}));
    files.push({path:file,sha256:await hash(child(dest,file)),rows:count,table:t.name,columns:t.columns});
  }
  for(const folder of ['pdf','csv']){
    await fs.mkdir(path.join(dest,folder));
    for(const entry of await fs.readdir(path.join(env.out,folder),{withFileTypes:true})){
      if(!entry.isFile())throw new Error('Unexpected artifact subdirectory');
      const file=`${folder}/${entry.name}`;await fs.copyFile(child(env.out,file),child(dest,file),io.constants.COPYFILE_EXCL);
      files.push({path:file,sha256:await hash(child(dest,file))});
    }
  }
  for(const file of ['catalog.json','result.json','generation.json']){await fs.copyFile(child(env.out,file),child(dest,file),io.constants.COPYFILE_EXCL);files.push({path:file,sha256:await hash(child(dest,file))});}
  const manifest={format:1,version:S.VERSION,asOf:env.asOf,source:env.db,migrations:await R.schema(pool),files};
  await fs.writeFile(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log(JSON.stringify({package:dest,tables:tables.length,files:files.length,manifestSha256:await hash(path.join(dest,'manifest.json'))}));
}
async function restorePackage(pool,env,source){
  const migrations=await R.schema(pool),manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
  if(manifest.format!==1||manifest.version!==S.VERSION||JSON.stringify(manifest.migrations)!==JSON.stringify(migrations))throw new Error('Package/schema version mismatch');
  if(manifest.asOf!==env.asOf)throw new Error('Package reference date mismatch');
  const [[existing]]=await pool.query('SELECT (SELECT COUNT(*) FROM companies)+(SELECT COUNT(*) FROM partners)+(SELECT COUNT(*) FROM daily_reports)+(SELECT COUNT(*) FROM projects)+(SELECT COUNT(*) FROM invoices)+(SELECT COUNT(*) FROM payments) n');
  if(Number(existing.n))throw new Error('Restore requires an empty dedicated verification DB; no existing business data is deleted');
  if((await fs.readdir(env.out).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).length)throw new Error('Restore requires a new or empty output directory');
  const tables=await tableInfo(pool),data=manifest.files.filter(f=>f.table);
  if(JSON.stringify(data.map(f=>({name:f.table,columns:f.columns})))!==JSON.stringify(tables))throw new Error('Package table/column mismatch');
  const paths=new Set();
  for(const f of manifest.files){
    if(paths.has(f.path)||!(/^(tables\/\w+\.jsonl\.gz|pdf\/[^/\\]+\.pdf|csv\/[^/\\]+\.csv|catalog\.json|generation\.json|result\.json)$/).test(f.path))throw new Error('Unexpected package entry');
    paths.add(f.path);if(await hash(child(source,f.path))!==f.sha256)throw new Error(`Checksum mismatch: ${f.path}`);
  }
  const conn=await pool.getConnection();
  try{
    await conn.query('SET FOREIGN_KEY_CHECKS=0');await conn.beginTransaction();
    // Only migration-installed defaults in this verified empty dedicated DB are replaced.
    for(const t of tables)await conn.query(`DELETE FROM \`${t.name}\``);
    for(const f of data){
      const lines=readline.createInterface({input:io.createReadStream(child(source,f.path)).pipe(zlib.createGunzip()),crlfDelay:Infinity});let count=0,batch=[],bytes=0;
      async function flush(){if(!batch.length)return;await conn.query(`INSERT INTO \`${f.table}\` (${f.columns.map(c=>'`'+c+'`').join(',')}) VALUES ?`,[batch]);batch=[];bytes=0;}
      for await(const line of lines){const row=JSON.parse(line);if(!Array.isArray(row)||row.length!==f.columns.length)throw new Error('Invalid package row');batch.push(row.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));bytes+=Buffer.byteLength(line);count++;if(batch.length>=50||bytes>1000000)await flush();}
      await flush();if(count!==f.rows)throw new Error(`Row count mismatch: ${f.table}`);
    }
    await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{await conn.query('SET FOREIGN_KEY_CHECKS=1');conn.release();}
  await fs.mkdir(env.out,{recursive:true});
  for(const f of manifest.files.filter(f=>!f.table)){await fs.mkdir(path.dirname(child(env.out,f.path)),{recursive:true});await fs.copyFile(child(source,f.path),child(env.out,f.path),io.constants.COPYFILE_EXCL);}
  const result=await require('./verify').verify(pool,env);
  const expected=JSON.parse(await fs.readFile(path.join(env.out,'result.json'),'utf8'));
  if(expected.semanticChecksum!==result.semanticChecksum)throw new Error('Restored semantic checksum mismatch');
  await fs.writeFile(path.join(env.out,'restore-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
async function main(){const env=R.environment(),[action,arg]=process.argv.slice(2);if(!arg)throw new Error('Usage: package.js export NEW_DIRECTORY | restore PACKAGE_DIRECTORY');const pool=require('../../src/db').getPool();try{if(action==='export')await exportPackage(pool,env,path.resolve(arg));else if(action==='restore')await restorePackage(pool,env,path.resolve(arg));else throw new Error('Unknown package action');}finally{await pool.end();}}
if(require.main===module)main().then(()=>process.exit(0)).catch(e=>{console.error(e.stack);process.exit(1);});
module.exports={child,hash};
