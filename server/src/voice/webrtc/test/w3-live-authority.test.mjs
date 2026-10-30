import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createW3LiveAuthority } from '../w3-live-authority.mjs';
import { requireW3Secret, verifyLeaseRequest } from '../w3-ticket.mjs';

const uuid = n => `01234567-89ab-cdef-0123-${n.toString(16).padStart(12, '0')}`;

test('W3 90-peer lease uses ONE signed loopback request, fails closed', async t => {
  const secret = requireW3Secret(randomBytes(32).toString('base64'));
  let calls = 0;
  let allow = true;
  const server = http.createServer(async (req, res) => {
    calls++;
    const body = await new Promise(resolve => {
      const buffers = [];
      req.on('data', chunk => buffers.push(chunk));
      req.once('end', () => resolve(Buffer.concat(buffers).toString('utf8')));
    });
    const valid = verifyLeaseRequest({ secret, body,
      timestamp: Number(req.headers['x-vme2-w3-timestamp']), signature: req.headers['x-vme2-w3-signature'] });
    if (!valid) { res.writeHead(403); res.end(); return; }
    const entries = JSON.parse(body).entries;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, allowed: entries.map(x => allow && x.userId !== 'banned') }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const authority = createW3LiveAuthority({ secret, authorityBase: `http://127.0.0.1:${server.address().port}` });
  const peers = Array.from({ length: 90 }, (_, i) => ({ roomId: 'room', userId: `u${i}`, controlConnectionId: uuid(i) }));
  peers[10].userId = 'banned';
  const statuses = await authority.liveBatch(peers);
  assert.equal(calls, 1);
  assert.equal(statuses?.length, 90);
  assert.equal(statuses?.[10], false);
  assert.equal(statuses?.filter(Boolean).length, 89);
  allow = false;
  assert((await authority.liveBatch(peers)).every(v => !v));
  assert.equal(calls, 2);
});
