const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {VERSION,DEFAULT_AS_OF,START}=require('./scenarios');
const ROOT=path.resolve(__dirname,'../../..');
const RealDate=Date;
let simulated=Date.parse(`${START}T00:00:00Z`);
function at(date){simulated=Date.parse(date.length===10?`${date}T09:00:00Z`:date);if(!Number.isFinite(simulated))throw new Error('Invalid simulation date');}
function setClock(pool){
  // Only the dedicated generator process uses a simulated clock; production APIs are unchanged.
  global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[simulated]));}static now(){return simulated;}};
  pool.pool.on('acquire',connection=>connection.query(`SET timestamp=${Math.floor(simulated/1000)}`));
}
async function insert(pool,table,data){
  const columns=Object.keys(data);
  if(!/^[a-z_]+$/.test(table)||columns.some(k=>!/^\w+$/.test(k)))throw new Error('Invalid identifier');
  const [r]=await pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,columns.map(k=>data[k]!==null&&typeof data[k]==='object'?JSON.stringify(data[k]):data[k]));
  return Number(r.insertId);
}
function environment(){
  const db=process.env.DB_NAME;
  if(!/^links_verification_[a-z0-9_]+$/.test(db||''))throw new Error('DB_NAME must name a dedicated links_verification_* database');
  if(process.env.VERIFICATION_ENV!=='isolated')throw new Error('VERIFICATION_ENV=isolated is required');
  const out=path.resolve(process.env.VERIFICATION_OUTPUT||path.join(ROOT,'output/business-verification',db));
  const pdf=path.resolve(process.env.PDF_DIR||path.join(out,'pdf'));
  if(!pdf.startsWith(out+path.sep))throw new Error('PDF_DIR must be inside VERIFICATION_OUTPUT');
  process.env.PDF_DIR=pdf;
  return {db,out,pdf,asOf:process.env.VERIFICATION_AS_OF||DEFAULT_AS_OF,seed:Number(process.env.VERIFICATION_SEED||93)};
}
async function schema(pool){
  const files=(await fs.readdir(path.join(ROOT,'db/migrations'))).filter(n=>n.endsWith('.sql')).sort();
  if(files.at(-1)!=='029_daily_report_submissions.sql')throw new Error('Schema changed: review generator compatibility before writing');
  const [applied]=await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
  if(JSON.stringify(files)!==JSON.stringify(applied.map(x=>x.filename)))throw new Error('Pending or unknown migrations');
  const required={companies:['company_name'],partners:['account_name_kana'],projects:['vehicle_owner_type','payment_type'],staff_masters:['area_name'],daily_reports:['calculation_detail','is_absent','work_hours'],cash_export_batches:['definition_snapshot_json','file_checksum'],settlement_line_sources:['monthly_approval_id']};
  for(const [table,cols]of Object.entries(required)){
    const [rows]=await pool.query(`SHOW COLUMNS FROM ${table}`);
    for(const col of cols)if(!rows.some(r=>r.Field===col))throw new Error(`Schema incompatible: ${table}.${col}`);
  }
  const [columns]=await pool.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
  const groups={};for(const col of columns)(groups[col.TABLE_NAME]??=[]).push(col);
  const tableContract=require('./schema-contract.json');
  if(JSON.stringify(Object.keys(groups))!==JSON.stringify(Object.keys(tableContract)))throw new Error('Schema table list changed');
  for(const [table,cols]of Object.entries(groups))if(crypto.createHash('sha256').update(JSON.stringify(cols)).digest('hex')!==tableContract[table])throw new Error(`Column/type/default/state contract changed: ${table}`);
  const hashes=await Promise.all(files.map(async name=>({name,sha256:crypto.createHash('sha256').update((await fs.readFile(path.join(ROOT,'db/migrations',name),'utf8')).replace(/\r\n/g,'\n')).digest('hex')})));
  const contract=require('./migration-contract.json');
  for(const {name,sha256} of hashes)if(contract[name]!==sha256)throw new Error(`Migration contract changed: ${name}`);
  return hashes;
}
async function client(actor){
  const express=require('express');const app=express();const secret=crypto.randomBytes(32).toString('hex');
  app.use(express.json({limit:'5mb'}));
  app.use((req,res,next)=>{if(req.headers['x-verification-token']!==secret)return res.sendStatus(401);req.session={user:{user_id:actor,role:'admin',roles:['admin'],is_active:true}};next();});
  app.use('/daily',require('../../src/routes/daily_reports'));
  app.use('/settlements',require('../../src/routes/settlements'));
  app.use('/advances',require('../../src/routes/advances_matrix'));
  app.use('/cash',require('../../src/routes/cash_management').router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const request=async(route,body,method=body===undefined?'GET':'POST',attempt=0)=>{
    const r=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,headers:{'content-type':'application/json','x-verification-token':secret},body:body===undefined?undefined:JSON.stringify(body)});
    const buffer=Buffer.from(await r.arrayBuffer());
    // Only an explicit transaction rollback due to deadlock is retryable. Never retry
    // an uncertain HTTP/network result that could have committed a financial action.
    if(r.status===400&&buffer.toString().includes('Deadlock found when trying to get lock')&&attempt<3){await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));return request(route,body,method,attempt+1);}
    if(!r.ok)throw new Error(`${method} ${route}: ${r.status} ${buffer.toString().slice(0,600)}`);
    return r.headers.get('content-type')?.includes('json')?JSON.parse(buffer):{buffer,batchId:Number(r.headers.get('x-cash-export-batch-id'))};
  };
  return {request,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
module.exports={ROOT,RealDate,at,setClock,insert,environment,schema,client};
