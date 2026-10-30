import { signLeaseRequest, verifyW3Ticket } from './w3-ticket.mjs';

export function createW3LiveAuthority({ secret, authorityBase, usedJtis = new Map(),
  sessionAclEnabled = false, now = () => Date.now() }) {
  const base = new URL(authorityBase);
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname) ||
      base.pathname !== '/' || base.search || base.hash) throw new Error('W3_AUTHORITY_MUST_BE_LOOPBACK_HTTP');
  const url = new URL('/game-server-control/internal/voice-webrtc-lease', base);
  async function liveBatchWithPeers(identities) {
    if (!Array.isArray(identities) || identities.length < 1 || identities.length > 128) return null;
    const body = JSON.stringify({ entries: identities.map(identity => ({
      roomId: identity.roomId, controlConnectionId: identity.controlConnectionId, userId: identity.userId
    })) });
    const timestamp = now();
    try {
      const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(2400),
        headers: { 'Content-Type': 'application/json', 'X-VME2-W3-Timestamp': String(timestamp),
          'X-VME2-W3-Signature': signLeaseRequest({ secret, body, timestamp }) }, body });
      if (response.status !== 200) return null;
      const data = await response.json();
      if (data?.ok !== true || !Array.isArray(data.allowed) ||
          data.allowed.length !== identities.length || data.allowed.some(value => typeof value !== 'boolean')) return null;
      // Legacy authority replies omit directionalDenied; continue in legacy mode.
      let directionalDenied = null;
      if (data.directionalDenied !== undefined) {
        if (!Array.isArray(data.directionalDenied) || data.directionalDenied.length !== identities.length ||
            data.directionalDenied.some(group => !Array.isArray(group) || group.length > 128 ||
              group.some(id => typeof id !== 'string' ||
                !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)))) return null;
        directionalDenied = data.directionalDenied;
      }
      if (!sessionAclEnabled) return { allowed: data.allowed, sessionPeers: null, directionalDenied };
      if (!Array.isArray(data.sessionPeers) || data.sessionPeers.length !== identities.length ||
          data.sessionPeers.some(group => !Array.isArray(group) || group.length > 128 ||
            group.some(id => typeof id !== 'string' ||
              !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)))) return null;
      return { allowed: data.allowed, sessionPeers: data.sessionPeers, directionalDenied };
    } catch { return null; }
  }
  async function liveBatch(identities) {
    return (await liveBatchWithPeers(identities))?.allowed ?? null;
  }
  async function live(identity) {
    const results = await liveBatch([identity]);
    return results?.[0] === true;
  }
  async function authorizeJoin({ roomId, controlConnectionId, ticket }) {
    const identity = verifyW3Ticket({ ticket, secret, now: now(), usedJtis });
    if (identity.roomId !== roomId || identity.controlConnectionId !== controlConnectionId) throw new Error('W3_TICKET_BINDING_MISMATCH');
    if (!(await live(identity))) throw new Error('W3_MEMBERSHIP_NOT_ACTIVE');
    return identity;
  }
  function purgeExpired() {
    const time = now();
    for (const [id, expiry] of usedJtis) if (expiry < time) usedJtis.delete(id);
  }
  return Object.freeze({ live, liveBatch, liveBatchWithPeers, authorizeJoin, purgeExpired });
}
