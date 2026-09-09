// Local inspection only; no migrations, seed, or production configuration changes.
const R=require('./runtime');
async function main(){const env=R.environment();await R.schema(require('../../src/db').getPool());const app=await require('../../src/server').createApp();const port=Number(process.env.VERIFICATION_PORT||18080);app.listen(port,'127.0.0.1',()=>console.log(`[verification] http://127.0.0.1:${port} DB=${env.db}`));}
main().catch(e=>{console.error(e.stack);process.exit(1);});
