const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { localUrl } = require('../src/middleware/local_url');

test('localhostの画面だけIPv4へ誘導し、NAS・API・POSTを維持する', async () => {
  const app = express();
  app.use(localUrl);
  app.use((_req, res) => res.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [host, route, method, location] of [
      ['localhost:8080', '/?a=1', 'GET', 'http://127.0.0.1:8080/?a=1'],
      ['LOCALHOST', '/', 'GET', 'http://127.0.0.1/'],
      ['192.168.1.50:8080', '/', 'GET', null],
      ['links.example', '/', 'GET', null],
      ['localhost:8080', '/api/auth/me', 'GET', null],
      ['localhost:8080', '/', 'POST', null],
    ]) {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(base + route, { method, headers: { host } }, (response) => {
          response.resume();
          response.on('end', () => resolve(response));
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(res.statusCode, location ? 302 : 204, `${host} ${method} ${route}`);
      assert.equal(res.headers.location || null, location);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
