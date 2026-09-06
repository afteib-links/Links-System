// Re-render fictional generation artifacts only, preserving originals in QA storage.
const fs=require('node:fs/promises');
const path=require('node:path');
const R=require('./runtime');
async function main(){
  const env=R.environment(),mark=JSON.parse(await fs.readFile(path.join(env.out,'generation.json'),'utf8'));
  if(mark.version!==require('./scenarios').VERSION||mark.database!==env.db)throw new Error('Not this generator output');
  const pool=require('../../src/db').getPool();
  try{
    await R.schema(pool);
    const [[foreign]]=await pool.query("SELECT COUNT(*) n FROM companies WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))<>? OR extra_data IS NULL",[mark.version]);
    if(foreign.n)throw new Error('Not exclusively fictional generation data');
    const pdf=require('../../src/services/settlement_pdf'),[docs]=await pool.query('SELECT file_path,snapshot_json FROM settlement_documents ORDER BY settlement_document_id');
    const backup=path.join(env.out,'qa','original-pdf');await fs.mkdir(backup,{recursive:true});
    await pdf.withPdfBatch(async()=>{for(const d of docs){
      if(path.basename(d.file_path)!==d.file_path)throw new Error('Unsafe PDF path');
      const source=path.join(env.pdf,d.file_path),saved=path.join(backup,d.file_path);
      if(!await fs.stat(saved).then(()=>true,()=>false))await fs.copyFile(source,saved,1);
      const snapshot=typeof d.snapshot_json==='string'?JSON.parse(d.snapshot_json):d.snapshot_json;
      await pdf.writePdf(snapshot.document,snapshot.internal_lines||snapshot.lines);
    }});
    console.log(`Re-rendered ${docs.length} fictional PDFs; originals retained in QA storage`);
  }finally{await pool.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.stack);process.exit(1);});
