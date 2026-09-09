// Creates a NEW isolated schema only. Does not delete or modify an existing database.
const {environment}=require('./runtime');
const env=environment();
const {config}=require('../../src/config');
const mysql=require('mysql2/promise');
async function main(){
  if(!process.env.MYSQL_ROOT_PASSWORD)throw new Error('MYSQL_ROOT_PASSWORD is required from the local environment');
  const conn=await mysql.createConnection({host:config.db.host,port:config.db.port,user:'root',password:process.env.MYSQL_ROOT_PASSWORD});
  try{
    const [rows]=await conn.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[env.db]);
    if(rows.length)throw new Error('Database already exists. Choose a new verification DB name.');
    if(!/^\w+$/.test(config.db.user))throw new Error('Invalid DB user');
    await conn.query(`CREATE DATABASE \`${env.db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`GRANT ALL ON \`${env.db}\`.* TO '${config.db.user}'@'%'`);
    console.log('Created dedicated verification schema:',env.db);
  }finally{await conn.end();}
  const {applyMigrations}=require('../../src/migrate');await applyMigrations();await require('../../src/db').getPool().end();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
