import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createVoiceWebRtcW3AuthHandler } from '../voiceWebRtcW3AuthHandler.js';
import { requireW3Secret, verifyW3Ticket, signLeaseRequest } from '../w3-ticket.mjs';

const SECRET = randomBytes(32).toString('base64');
const roomId = 'room_1';
const uuid = n => `01234567-89ab-cdef-0123-${n.toString(16).padStart(12, '0')}`;

test('W3 ticket auth and batched live membership checks (no DB calls)', async t => {
  const records = new Map();
  for (let i = 1; i <= 90; i++) records.set(uuid(i), { roomId, userId: `user${i}`, connectionId: uuid(i), state: 2 });
  let lookups = 0;
  const handler = createVoiceWebRtcW3AuthHandler({
    secretBase64: SECRET, allowedOrigin: 'https://test.example',
    tokenVerifier: { verify: token => ({ success: token === 'valid-token', userId: 'user1' }) },
    voiceConnectionRegistry: { getByConnectionId(id) { lookups++; return records.get(id) ?? null; } },
    gameSessionRegistry: {
      findSessionByRoom(id) { return id === roomId ? { roomId, sessionId: 'session_1', serverId: 'srv', players: [...records.values()].map(r => ({ userId: r.userId, connectionId: r.connectionId, isReady: true })) } : null; },
      isPublicSessionOpen(session) { return session?.roomId === roomId; }
    }
  });
  const server = http.createServer((req, res) => { void handler(req, res).then(handled => {
    if (!handled) { res.writeHead(404); res.end(); }
  }).catch(e => { res.writeHead(500); res.end(String(e)); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ticketRes = await fetch(origin + '/game-server-control/client/voice-webrtc-ticket', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
    body: JSON.stringify({ roomId, controlConnectionId: uuid(1) })
  });
  assert.equal(ticketRes.status, 200);
  const ticketJson = await ticketRes.json();
  assert.equal(ticketJson.ok, true);
  const secret = requireW3Secret(SECRET);
  const decoded = verifyW3Ticket({ secret, ticket: ticketJson.ticket });
  assert.equal(decoded.userId, 'user1');
  const identities = [...records.values()].map(r => ({ roomId: r.roomId, userId: r.userId, controlConnectionId: r.connectionId }));
  async function sendLease(entries) {
    const body = JSON.stringify({ entries });
    const timestamp = Date.now();
    const response = await fetch(origin + '/game-server-control/internal/voice-webrtc-lease', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-VME2-W3-Timestamp': String(timestamp),
        'X-VME2-W3-Signature': signLeaseRequest({ secret, body, timestamp }) }, body
    });
    assert.equal(response.status, 200);
    return (await response.json()).allowed;
  }
  const allowed = await sendLease(identities);
  assert.equal(allowed.length, 90);
  assert(allowed.every(v => v));
  records.delete(uuid(10));
  const changed = await sendLease(identities);
  assert.equal(changed[9], false);
  assert.equal(changed.filter(Boolean).length, 89);
  assert(lookups < 2000);
  const badRes = await fetch(origin + '/game-server-control/client/voice-webrtc-ticket', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
    body: JSON.stringify({ roomId, controlConnectionId: uuid(1) })
  });
  assert.equal(badRes.status, 401);
  const preflight = await fetch(origin + '/game-server-control/client/voice-webrtc-ticket', {
    method: 'OPTIONS', headers: { Origin: 'https://test.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://test.example');
  const wrongOrigin = await fetch(origin + '/game-server-control/client/voice-webrtc-ticket', {
    method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token' },
    body: JSON.stringify({ roomId, controlConnectionId: uuid(1) })
  });
  assert.equal(wrongOrigin.status, 403);
});
