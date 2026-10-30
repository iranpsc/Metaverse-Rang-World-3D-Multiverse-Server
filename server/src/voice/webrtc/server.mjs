import http from 'node:http';
import { isIP } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import * as mediasoup from 'mediasoup';
import { Vme2StageSfu, assertLabOnlyConfiguration, checkRpcRequest } from './sfu-core.mjs';
import { createWebRtcRecordingBridgeClient } from './recording-bridge-client.mjs';
import { requireW3Secret } from './w3-ticket.mjs';
import { createW3LiveAuthority } from './w3-live-authority.mjs';

const w3Enabled = process.env.VME2_WEBRTC_W3_ENABLED === '1';
const host = '127.0.0.1'; // The signalling service is ALWAYS loopback, public WSS enters the established realtime WS proxy.
const port = Number(process.env.VME2_SFU_PORT ?? 8767);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
const allowedOrigin = w3Enabled ? String(process.env.VME2_WEBRTC_ALLOWED_ORIGIN ?? '').trim() : '';
if (w3Enabled && !/^https:\/\/[^/]+$/.test(allowedOrigin)) throw new Error('W3_ALLOWED_ORIGIN_REQUIRED');
const sessionAclEnabled = w3Enabled && process.env.VME2_WEBRTC_SESSION_ACL_ENABLED === '1';
const authority = w3Enabled ? createW3LiveAuthority({
  sessionAclEnabled,
  secret: requireW3Secret(process.env.VME2_WEBRTC_AUTH_SECRET),
  authorityBase: process.env.VME2_WEBRTC_MAIN_INTERNAL_URL
}) : null;
const announcedAddress = w3Enabled ? String(process.env.VME2_SFU_UDP_ANNOUNCED_ADDRESS ?? '').trim() : '';
if (announcedAddress && isIP(announcedAddress) !== 4) throw new Error('W3_ANNOUNCED_ADDRESS_MUST_BE_IPV4');
if (w3Enabled && !announcedAddress) throw new Error('W3_SFU_UDP_ANNOUNCED_ADDRESS_REQUIRED');
const rtcMin = Number(process.env.VME2_SFU_UDP_MIN ?? (w3Enabled ? 40000 : 10000));
const rtcMax = Number(process.env.VME2_SFU_UDP_MAX ?? (w3Enabled ? 40255 : 59999));
if (!Number.isInteger(rtcMin) || !Number.isInteger(rtcMax) || rtcMin < 1024 || rtcMax > 65535 || rtcMax < rtcMin ||
    (w3Enabled && rtcMax - rtcMin > 1024)) throw new Error('W3_INVALID_RTC_PORT_RANGE');
if (!w3Enabled) assertLabOnlyConfiguration({ host, announcedAddress });

const recordingBridge = process.env.VME2_WEBRTC_RECORDING_BRIDGE_ENABLED === '1'
  ? createWebRtcRecordingBridgeClient({
      secretBase64: process.env.VME2_WEBRTC_AUTH_SECRET,
      port: Number(process.env.VME2_WEBRTC_RECORDING_BRIDGE_PORT ?? 8768)
    }) : null;
const sfu = new Vme2StageSfu({ mediasoup,
  listenIp: announcedAddress ? '0.0.0.0' : '127.0.0.1', announcedAddress,
  authorizeJoin: authority?.authorizeJoin ?? null, workerPortMin: rtcMin, workerPortMax: rtcMax,
  recordingBridge, sessionAclEnabled });
await sfu.initialize();
const httpServer = http.createServer((req, res) => {
  if (req.url !== '/' || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ service: 'VME2_WebRTC_SFU', stageOnly: !w3Enabled, ready: !!sfu.router }));
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
const allowedStageOrigin = origin => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin ?? '');
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' ||
      !(w3Enabled ? req.headers.origin === allowedOrigin : allowedStageOrigin(req.headers.origin)) ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', ws => {
  const peer = sfu.createPeer((event, data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, data }));
  });
  // Prevent unauthenticated clients from occupying the signalling proxy indefinitely.
  const joinTimer = setTimeout(() => {
    if (!peer.closed && !peer.joined) {
      try { ws.close(1008, 'join_timeout'); } catch {}
      sfu.disposePeer(peer);
    }
  }, 12000);
  joinTimer.unref?.();
  let requestsInWindow = 0;
  let windowStart = Date.now();
  // A single shared batched lease reconciliation replaces N independent HTTP timers.
  peer.closeSignalling = reason => {
    try { if (ws.readyState === WebSocket.OPEN) ws.close(1008, reason); } catch {}
  };
  ws.on('message', async buffer => {
    const now = Date.now();
    if (now - windowStart > 10000) { windowStart = now; requestsInWindow = 0; }
    if (++requestsInWindow > 100) { ws.close(1008, 'rate_limit'); return; }
    let id = null;
    try {
      const msg = JSON.parse(buffer.toString());
      checkRpcRequest(msg);
      id = msg.id;
      const data = await sfu.handle(peer, msg.action, msg.data);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, ok: true, data }));
    } catch (error) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
        id, ok: false, error: String(error?.message ?? 'ERROR').slice(0, 160)
      }));
    }
  });
  const cleanup = () => { clearTimeout(joinTimer); sfu.disposePeer(peer); };
  ws.once('close', cleanup);
  ws.once('error', cleanup);
});
// Control-plane only. 1 loopback request per 5 seconds for up to 128 admitted peers.
// WebRTC RTP, DTLS, Opus and packet forwarding never wait for these checks.
let leaseSweepRunning = false;
const leaseSweep = async () => {
  if (!authority || leaseSweepRunning) return;
  const peers = [...sfu.peers].filter(peer => peer.joined && !peer.closed && peer.authIdentity);
  if (peers.length === 0) return;
  leaseSweepRunning = true;
  try {
    for (let start = 0; start < peers.length; start += 128) {
      const chunk = peers.slice(start, start + 128);
      const result = await authority.liveBatchWithPeers(chunk.map(peer => peer.authIdentity));
      const allowed = result?.allowed ?? null;
      for (let i = 0; i < chunk.length; i++) {
        const peer = chunk[i];
        if (peer.closed) continue;
        if (allowed?.[i] === true) {
          peer.w3LeaseTransientFailures = 0;
          peer.lastVerifiedAt = Date.now();
          if (sessionAclEnabled) sfu.reconcileSessionGrants(peer, result.sessionPeers[i]);
          if (result.directionalDenied !== null) {
            sfu.reconcileWebGlMicDenials(peer, result.directionalDenied[i]);
          }
        } else if (allowed === null) {
          // Never continue media delivery using stale pair permissions.
          if (sessionAclEnabled) sfu.reconcileSessionGrants(peer, []);
          // Brief control-plane outage must not immediately interrupt signalling.
          // Fail closed after two consecutive failed checks (bounded grace).
          peer.w3LeaseTransientFailures = (peer.w3LeaseTransientFailures ?? 0) + 1;
          if (peer.w3LeaseTransientFailures >= 2) {
            peer.closeSignalling?.('w3_authority_unavailable'); sfu.disposePeer(peer);
          }
        } else {
          if (sessionAclEnabled) sfu.reconcileSessionGrants(peer, []);
          // Explicit revoked membership has no grace period.
          peer.closeSignalling?.('w3_control_revoked'); sfu.disposePeer(peer);
        }
      }
    }
  } finally { leaseSweepRunning = false; }
};
const leaseSweepTimer = setInterval(() => { void leaseSweep().catch(error => {
  console.error('[VME2_SFU] w3 lease sweep error', String(error?.message ?? error));
}); }, sessionAclEnabled ? 1000 : 5000);
leaseSweepTimer.unref?.();
const purgeTimer = setInterval(() => authority?.purgeExpired(), 30000);
purgeTimer.unref?.();
await new Promise((resolve, reject) => httpServer.listen(port, host, err => err ? reject(err) : resolve()));
console.log(`[VME2_SFU] HTTP+WS listening on http://${host}:${port}, W3=${w3Enabled}, mediaPublic=${!!announcedAddress}, sessionAcl=${sessionAclEnabled}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => {
  clearInterval(purgeTimer);
  clearInterval(leaseSweepTimer);
  wss.close(); httpServer.close(); sfu.close(); recordingBridge?.stop();
});
