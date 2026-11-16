const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const app = process.env.VIRAL_HTTP_CHECK_APP;
const appRequire = app ? require('node:module').createRequire(require('node:path').join(app, 'package.json')) : require;
appRequire(app ? './server/http-runtime.cjs' : '../../server/http-runtime.cjs');
const undici = appRequire('undici');
async function check() {
  assert.equal(globalThis.fetch, undici.fetch);
  for (const name of ['Headers', 'Request', 'Response', 'FormData']) assert.equal(globalThis[name], undici[name]);
  const large = Buffer.alloc(1024 * 1024, 97), received = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Connection', 'close');
    if (req.url === '/truncated') { res.writeHead(200, { 'Content-Length': large.length }); res.write(large.subarray(0, 65536)); setTimeout(() => res.destroy(), 20); return; }
    if (req.method === 'POST') { for await (const part of req) received.push(part); res.end(JSON.stringify({ type: req.headers['content-type'], bytes: Buffer.concat(received).toString() })); return; }
    if (req.url === '/ok') { res.end('ok'); return; }
    res.writeHead(200, { 'Content-Length': large.length }); res.end(large);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 4; i++) {
      const response = await fetch(url + '/paused', { signal: AbortSignal.timeout(5000) });
      await delay(150); // Hold the body while the peer closes its connection.
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), large);
    }
    const cancelled = await fetch(url + '/cancel'); await cancelled.body.cancel();
    await assert.rejects(async () => { const response = await fetch(url + '/truncated'); await response.arrayBuffer(); });
    assert.equal(await (await fetch(url + '/ok')).text(), 'ok');
    const form = new FormData(); form.append('caption', 'Reviewed news'); form.append('file', new Blob(['video bytes']), 'clip.mp4');
    const request = new Request(url + '/upload', { method: 'POST', body: form });
    const upload = await (await fetch(request)).json();
    assert.match(upload.type, /multipart\/form-data; boundary=/);
    assert.match(upload.bytes, /Reviewed news/); assert.match(upload.bytes, /video bytes/);
    return { passed: true, node: process.versions.node, bundledUndici: process.versions.undici, activeUndici: appRequire('undici/package.json').version, checks: ['paused-body-close', 'cancel-body', 'truncated-response', 'next-request-works', 'paired-multipart'] };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
module.exports = { check };
if (require.main === module) check().then(report => console.log(JSON.stringify(report)), error => { console.error(error); process.exitCode = 1; });
