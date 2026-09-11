const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createRouter, enabled } = require('../src/routes/test_data');
const { createStore } = require('../test-support/test_data_store');
const { defaults } = require('../src/services/test_data/model');
const env = { LINKS_ENV:'verification', TEST_DATA_TOOL_ENABLED:'true', NODE_ENV:'test', DB_NAME:'links_verification_tool_control' };
test('environment gate fails closed', () => {
  assert.equal(enabled({}),false); assert.equal(enabled(env),true);
  assert.equal(enabled({...env,NODE_ENV:'production'}),false);
  assert.equal(enabled({...env,LINKS_ENV:'production'}),false);
  assert.equal(enabled({...env,DB_NAME:'links_system'}),false);
});
test('API authorization, version lock, approval invalidation and generation barrier', async t => {
  const generation = { list:async()=>[], get:async()=>null, enqueue:async d=>({id:'job-1',draftId:d.id,revision:d.revision,status:'queued',total:0,processed:0}) };
  const app = express(); app.use(express.json());
  app.use((req,res,next) => { if (req.get('x-test-role')) req.session = { user:{ user_id:1, roles:[req.get('x-test-role')] } }; next(); });
  app.use('/api/test-data',createRouter(createStore(),env,generation));
  app.use('/disabled',createRouter(createStore(),{}));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r)); t.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, method='POST', role='admin') => {
    const response = await fetch(`${root}/api/test-data${path}`, { method:body === undefined ? 'GET' : method,
      headers:{ 'Content-Type':'application/json', ...(role ? {'x-test-role':role}: {}) }, body:body === undefined ? undefined : JSON.stringify(body) });
    return { status:response.status, body:await response.json() };
  };
  assert.equal((await fetch(root+'/disabled/meta')).status,404);
  assert.equal((await call('/meta',undefined,'GET',null)).status,401);
  assert.equal((await call('/meta',undefined,'GET','sales')).status,403);
  const config = defaults('2026-09-10'); config.acceptFill = true;
  const created = await call('/drafts',{config}); assert.equal(created.status,201);
  const id = created.body.draft.id;
  assert.equal((await call(`/drafts/${id}/generate`,{})).status,409);
  const p = (await call(`/drafts/${id}/preview`,{})).body.preview;
  assert.equal((await call(`/drafts/${id}/approve`,{revision:0,hash:p.hash})).status,409);
  assert.equal((await call(`/drafts/${id}/approve`,{revision:1,hash:p.hash})).status,200);
  assert.equal((await call(`/drafts/${id}/generate`,{})).status,202);
  assert.equal((await call(`/drafts/${id}`,{revision:1,config},'PUT')).status,200);
  assert.equal((await call(`/drafts/${id}/generate`,{})).status,409);
  assert.equal((await call(`/drafts/${id}`,{revision:1,config},'PUT')).status,409);
  const packet = await call(`/drafts/${id}/share`); assert.equal(packet.body.package.anonymous,true);
});
