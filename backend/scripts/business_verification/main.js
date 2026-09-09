const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const S=require('./scenarios');
const R=require('./runtime');

async function main(){
  const action=process.argv[2]||'preview';
  if(action==='preview'){
    const c=S.catalog();console.log(JSON.stringify({version:S.VERSION,asOf:S.DEFAULT_AS_OF,counts:{companies:100,partners:130,base_projects:100,projects:120},companies:[c.companies[0],c.companies[25],c.companies[45]],partners:c.partners.slice(0,12),staff:c.staff,changes:c.projects.slice(100),price:S.price(c.projects[0],c.companies[0]),examples:['2026-06-01','2026-06-02','2026-06-03'].map(d=>S.input(c.projects[0],c.companies[0],d)),exceptions:S.EXCEPTIONS},null,2));return;
  }
  const env=R.environment();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(env.asOf)||env.asOf<S.DEFAULT_AS_OF||env.asOf>'2026-09-30')throw new Error('This scenario version supports 2026-09-07 through 2026-09-30');
  const {getPool}=require('../../src/db');
  const pool=getPool();
  let api;
  try{
    if(action==='verify'){
      const result=await require('./verify').verify(pool,env);console.log(JSON.stringify(result,null,2));return;
    }
    if(action!=='generate')throw new Error('Use preview, generate, or verify');
    const migrations=await R.schema(pool);
    const resume=process.argv.includes('--resume');
    const [[existing]]=await pool.query('SELECT (SELECT COUNT(*) FROM companies)+(SELECT COUNT(*) FROM partners)+(SELECT COUNT(*) FROM projects)+(SELECT COUNT(*) FROM invoices)+(SELECT COUNT(*) FROM payments) AS n');
    if(Number(existing.n)&&!resume)throw new Error('Generation requires an empty dedicated DB. Existing records are never deleted.');
    await fs.mkdir(env.out,{recursive:true});
    const mark=path.join(env.out,'generation.json');
    if(resume){const prior=JSON.parse(await fs.readFile(mark,'utf8'));if(prior.version!==S.VERSION||prior.database!==env.db||prior.asOf!==env.asOf||prior.seed!==env.seed||prior.status!=='running')throw new Error('Cannot resume a different or completed generation');}
    else await fs.writeFile(mark,JSON.stringify({version:S.VERSION,database:env.db,asOf:env.asOf,seed:env.seed,status:'running',generatedAt:new Date().toISOString()}),{flag:'wx'});
    R.setClock(pool);R.at(S.START);
    const summary=await require('../../src/services/settlement_pdf').withPdfBatch(async()=>{
      const c=resume?JSON.parse(await fs.readFile(path.join(env.out,'catalog.json'),'utf8')):await require('./masters').masters(pool);
      api=await R.client(c.actor);
      await fs.writeFile(path.join(env.out,'catalog.json'),JSON.stringify(c,null,2));
      return require('./workflows').workflows(pool,c,api,env);
    });
    const result=await require('./verify').verify(pool,env,api);
    await fs.writeFile(path.join(env.out,'result.json'),JSON.stringify({summary,...result},null,2));
    await fs.writeFile(mark,JSON.stringify({version:S.VERSION,database:env.db,asOf:env.asOf,seed:env.seed,status:'complete',generatedAt:new R.RealDate().toISOString(),migrations,semanticChecksum:result.semanticChecksum},null,2));
    console.log(JSON.stringify(result,null,2));
  }finally{if(api)await api.close();await pool.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('[business-verification]',e.stack);process.exit(1);});
