import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { requireW3Secret, mintW3Ticket, verifyW3Ticket, signLeaseRequest, verifyLeaseRequest } from '../w3-ticket.mjs';

const secret = requireW3Secret(randomBytes(32).toString('base64'));
const identity = { userId: 'user_01', roomId: 'room_01', controlConnectionId: '01234567-89ab-cdef-0123-456789abcdef' };

test('W3 ticket: identity, TTL and one-time replay rejection', () => {
  const now = 100000;
  const ticket = mintW3Ticket({ secret, identity, now });
  const usedJtis = new Map();
  assert.equal(verifyW3Ticket({ ticket, secret, now, usedJtis }).userId, identity.userId);
  assert.throws(() => verifyW3Ticket({ ticket, secret, now, usedJtis }), /W3_TICKET_REPLAY/);
  assert.throws(() => verifyW3Ticket({ ticket, secret, now: now + 30001 }), /W3_TICKET_EXPIRED_OR_INVALID/);
  const [payload, sig] = ticket.split('.');
  assert.throws(() => verifyW3Ticket({ ticket: `${payload}X.${sig}`, secret, now }), /W3_TICKET_SIGNATURE/);
});
test('W3 lease signature: exact byte HMAC, bounded time', () => {
  const now = 100000;
  const body = JSON.stringify({ entries: [identity] });
  const signature = signLeaseRequest({ secret, body, timestamp: now });
  assert.equal(verifyLeaseRequest({ secret, body, timestamp: now, signature, now }), true);
  assert.equal(verifyLeaseRequest({ secret, body: body + ' ', timestamp: now, signature, now }), false);
  assert.equal(verifyLeaseRequest({ secret, body, timestamp: now, signature, now: now + 10001 }), false);
});
