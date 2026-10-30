import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TICKET_ISSUER = 'vme2-webrtc-w3';
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function requireW3Secret(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/=]{43,}$/.test(value) ||
      Buffer.from(value, 'base64').length < 32) throw new Error('W3_SECRET_BASE64_32_BYTES_REQUIRED');
  return Buffer.from(value, 'base64');
}
export function requireW3Identity({ roomId, controlConnectionId, userId }) {
  if (typeof roomId !== 'string' || !roomId || roomId.length > 128 ||
      !/^[\p{L}\p{N}_.:-]+$/u.test(roomId)) throw new Error('W3_INVALID_ROOM');
  if (typeof controlConnectionId !== 'string' || !ID.test(controlConnectionId)) throw new Error('W3_INVALID_CONNECTION');
  if (typeof userId !== 'string' || !userId.trim() || Buffer.byteLength(userId) > 512) throw new Error('W3_INVALID_USER');
  return { roomId, controlConnectionId: controlConnectionId.toLowerCase(), userId: userId.trim() };
}
const sign = (bytes, secret) => createHmac('sha256', secret).update(bytes).digest('base64url');
export function mintW3Ticket({ secret, identity, now = Date.now(), ttlMs = 30000 }) {
  const subject = requireW3Identity(identity);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 30000) throw new Error('W3_INVALID_TTL');
  const body = Buffer.from(JSON.stringify({ iss: TICKET_ISSUER, ...subject, iat: now, exp: now + ttlMs,
    jti: randomBytes(16).toString('hex') })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}
export function verifyW3Ticket({ ticket, secret, now = Date.now(), usedJtis }) {
  if (typeof ticket !== 'string' || ticket.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) throw new Error('W3_TICKET_INVALID');
  const [body, sig] = ticket.split('.');
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('W3_TICKET_SIGNATURE');
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new Error('W3_TICKET_INVALID'); }
  if (!claims || claims.iss !== TICKET_ISSUER || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.iat > now + 5000 || claims.exp <= now || claims.exp - claims.iat > 30000 ||
      !/^[0-9a-f]{32}$/.test(claims.jti ?? '')) throw new Error('W3_TICKET_EXPIRED_OR_INVALID');
  const identity = requireW3Identity(claims);
  if (usedJtis?.has(claims.jti)) throw new Error('W3_TICKET_REPLAY');
  if (usedJtis) usedJtis.set(claims.jti, claims.exp);
  return Object.freeze({ ...identity, jti: claims.jti, exp: claims.exp });
}
export function signLeaseRequest({ secret, body, timestamp }) {
  if (!Number.isSafeInteger(timestamp)) throw new Error('W3_INVALID_LEASE_TIME');
  return sign(`${timestamp}.${body}`, secret);
}
export function verifyLeaseRequest({ secret, body, timestamp, signature, now = Date.now() }) {
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 10000 ||
      typeof signature !== 'string') return false;
  const expected = Buffer.from(signLeaseRequest({ secret, body, timestamp }));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
