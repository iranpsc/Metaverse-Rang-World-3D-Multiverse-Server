import { requireW3Secret, requireW3Identity, mintW3Ticket, verifyLeaseRequest } from './w3-ticket.mjs';
import { authorizeVoiceMediaControlBind, authorizeVoiceMediaBoundControl } from '../security/voiceMediaBindAuthorizationPolicy.js';
import { VoiceDedicatedPlayerAdapter } from '../adapters/voiceDedicatedPlayerAdapter.js';
import { canonicalizeVoiceEligibilityConnectionId } from '../dedicated/voiceDedicatedSessionEligibilityService.js';
import { VoiceSessionState } from '../session/voiceSessionConstants.js';
import { getWebGlMicDeniedSendersForLease } from '../directional/voiceWebGlMicSfuPolicyRelay.js';

const TICKET_PATH = '/game-server-control/client/voice-webrtc-ticket';
const LEASE_PATH = '/game-server-control/internal/voice-webrtc-lease';

function json(res, code, data) {
  if (res.writableEnded || res.destroyed) return;
  const text = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text), 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}
async function readBody(req, max = 4096) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new Error('W3_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('W3_BAD_BODY');
  return { text, value };
}
const pathOf = req => new URL(req.url ?? '/', 'http://localhost').pathname;
const localhost = addr => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);

export function createVoiceWebRtcW3AuthHandler({ tokenVerifier, voiceConnectionRegistry, gameSessionRegistry,
  voiceSessionRegistry = null, sessionAclEnabled = process.env.VME2_WEBRTC_SESSION_ACL_ENABLED === '1',
  secretBase64, allowedOrigin = '', now = () => Date.now() } = {}) {
  if (!tokenVerifier || typeof tokenVerifier.verify !== 'function' ||
      !voiceConnectionRegistry || typeof voiceConnectionRegistry.getByConnectionId !== 'function' ||
      !gameSessionRegistry) throw new Error('W3_LIVE_AUTH_DEPENDENCY_MISSING');
  if (sessionAclEnabled &&
      (typeof voiceSessionRegistry?.listActiveByConnectionId !== 'function' ||
       typeof voiceConnectionRegistry.getSessionEligibility !== 'function')) {
    throw new Error('W4_SESSION_ACL_AUTHORITY_REQUIRED');
  }
  const secret = requireW3Secret(secretBase64);
  if (!/^https:\/\/[^/]+$/.test(allowedOrigin)) throw new Error('W3_ALLOWED_ORIGIN_REQUIRED');
  const dedicated = new VoiceDedicatedPlayerAdapter({ sessionRegistry: gameSessionRegistry });
  const verifyLive = identity => {
    const control = voiceConnectionRegistry.getByConnectionId(identity.controlConnectionId);
    const bound = authorizeVoiceMediaBoundControl({ ...identity, controlRecord: control });
    if (!bound.allowed) return false;
    const member = dedicated.verify({ userId: identity.userId, roomId: identity.roomId });
    if (member?.success !== true) return false;
    // Do not grant a new SFU lease to a stale avatar / old dedicated connection.
    return canonicalizeVoiceEligibilityConnectionId(member.connectionId) ===
      canonicalizeVoiceEligibilityConnectionId(identity.controlConnectionId);
  };
  const perUser = new Map();
  return async function handleW3(req, res) {
    const path = pathOf(req);
    if (path !== TICKET_PATH && path !== LEASE_PATH) return false;
    if (path === TICKET_PATH) {
      const requestOrigin = String(req.headers.origin ?? '');
      if (requestOrigin && requestOrigin !== allowedOrigin) {
        json(res, 403, { ok: false, error: 'ORIGIN_DENIED' }); return true;
      }
      if (requestOrigin === allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return true;
      }
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); return true; }
    if (String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      json(res, 415, { ok: false, error: 'UNSUPPORTED_CONTENT_TYPE' }); return true;
    }
    if (path === LEASE_PATH && !localhost(req.socket?.remoteAddress)) {
      json(res, 403, { ok: false, error: 'FORBIDDEN' }); return true;
    }
    let parsedBody;
    try { parsedBody = await readBody(req, path === LEASE_PATH ? 65536 : 4096); }
    catch { json(res, 400, { ok: false, error: 'INVALID_BODY' }); return true; }
    const rawBody = parsedBody.value;
    if (path === LEASE_PATH) {
      const timestamp = Number(req.headers['x-vme2-w3-timestamp']);
      // Sign and verify EXACT request bytes, not reserialized JSON.
      const valid = verifyLeaseRequest({ secret, body: parsedBody.text, timestamp,
        signature: req.headers['x-vme2-w3-signature'], now: now() });
      if (!valid) { json(res, 403, { ok: false, error: 'FORBIDDEN' }); return true; }
      if (!Array.isArray(rawBody.entries) || rawBody.entries.length === 0 || rawBody.entries.length > 128) {
        json(res, 400, { ok: false, error: 'W3_INVALID_BATCH' }); return true;
      }
      // Fast in-memory lookup for all peers, once every lease interval.
      // No database, Redis or HTTP request per media packet.
      const allowed = rawBody.entries.map(entry => {
        try { return verifyLive(requireW3Identity(entry)); }
        catch { return false; }
      });
      // Only admitted peers from this signed batch can appear in WebGL mic denials.
      const identities = rawBody.entries.map((entry, index) => {
        if (!allowed[index]) return null;
        try { return requireW3Identity(entry); } catch { return null; }
      });
      const directionalDenied = getWebGlMicDeniedSendersForLease(identities);
      if (!sessionAclEnabled) {
        json(res, 200, { ok: true, allowed, directionalDenied });
        return true;
      }
      const liveByConnection = new Map();
      for (const identity of identities) {
        if (identity) liveByConnection.set(
          canonicalizeVoiceEligibilityConnectionId(identity.controlConnectionId), identity);
      }
      const eligibleConnection = identity => {
        if (!identity) return false;
        const status = voiceConnectionRegistry.getSessionEligibility(identity.controlConnectionId);
        return status?.initialized === true && status?.eligible === true;
      };
      const eligibilityCache = new Map();
      for (const identity of identities) {
        if (identity) eligibilityCache.set(
          canonicalizeVoiceEligibilityConnectionId(identity.controlConnectionId), eligibleConnection(identity));
      }
      const sessionPeers = identities.map(identity => {
        if (!identity) return [];
        const ownKey = canonicalizeVoiceEligibilityConnectionId(identity.controlConnectionId);
        if (eligibilityCache.get(ownKey) !== true) return [];
        const sessions = voiceSessionRegistry.listActiveByConnectionId(identity.controlConnectionId);
        if (!Array.isArray(sessions)) return [];
        const peers = new Set();
        for (const session of sessions) {
          if (session.state !== VoiceSessionState.ACTIVE || session.roomId !== identity.roomId ||
              !Array.isArray(session.participants) ||
              !session.participants.some(p => p.userId === identity.userId &&
                canonicalizeVoiceEligibilityConnectionId(p.connectionId) === ownKey)) continue;
          for (const member of session.participants) {
            const key = canonicalizeVoiceEligibilityConnectionId(member.connectionId);
            const other = liveByConnection.get(key);
            if (key !== ownKey && other && other.roomId === identity.roomId &&
                other.userId === member.userId && eligibilityCache.get(key) === true) {
              peers.add(other.controlConnectionId.toLowerCase());
            }
          }
        }
        return [...peers].sort().slice(0, 128);
      });
      json(res, 200, { ok: true, allowed, sessionPeers, directionalDenied });
      return true;
    }
    const authorization = String(req.headers.authorization ?? '');
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!match) { json(res, 401, { ok: false, error: 'UNAUTHORIZED' }); return true; }
    const tokenResult = tokenVerifier.verify(match[1]);
    if (tokenResult?.success !== true) { json(res, 401, { ok: false, error: 'UNAUTHORIZED' }); return true; }
    let identity;
    try { identity = requireW3Identity({ ...rawBody, userId: tokenResult.userId }); }
    catch { json(res, 400, { ok: false, error: 'INVALID_IDENTITY' }); return true; }
    const current = now();
    const window = perUser.get(identity.userId) ?? { start: current, count: 0 };
    if (current - window.start > 10000) { window.start = current; window.count = 0; }
    if (++window.count > 8) { json(res, 429, { ok: false, error: 'RATE_LIMITED' }); return true; }
    perUser.set(identity.userId, window);
    if (perUser.size > 10000) {
      for (const [key, value] of perUser) if (current - value.start > 10000) perUser.delete(key);
      if (perUser.size > 10000) perUser.clear();
    }
    const control = voiceConnectionRegistry.getByConnectionId(identity.controlConnectionId);
    const bound = authorizeVoiceMediaControlBind({ controlConnectionId: identity.controlConnectionId,
      roomId: identity.roomId, tokenResult, controlRecord: control });
    if (!bound.allowed || !verifyLive(identity)) { json(res, 403, { ok: false, error: 'NOT_AUTHORIZED' }); return true; }
    const ticket = mintW3Ticket({ secret, identity, now: current });
    json(res, 200, { ok: true, ticket, expiresInSeconds: 30 });
    return true;
  };
}
export { TICKET_PATH, LEASE_PATH };
