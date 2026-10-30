import { WebSocket } from 'ws';

const MAX_QUEUE_BYTES = 128 * 1024;
const MAX_CLIENTS = 100;

// Bridges the already-secure public realtime WS connection to localhost SFU signalling.
// Does not proxy RTP media: WebRTC ICE/UDP runs directly between browser and worker.
export function createVoiceWebRtcW3SignalProxy({
  target = 'ws://127.0.0.1:8767/ws', allowedOrigin = '', logger = null
} = {}) {
  const parsed = new URL(target);
  if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      parsed.pathname !== '/ws') throw new Error('W3_PROXY_TARGET_MUST_BE_LOCAL');
  if (!/^https:\/\/[^/]+$/.test(allowedOrigin)) throw new Error('W3_ALLOWED_ORIGIN_REQUIRED');
  const sessions = new Set();
  let stopped = false;
  function accept(client, req) {
    if (stopped || req?.headers?.origin !== allowedOrigin || sessions.size >= MAX_CLIENTS) {
      client.close(1008, 'webrtc_w3_denied');
      return;
    }
    const upstream = new WebSocket(target, { origin: allowedOrigin, perMessageDeflate: false, maxPayload: 65536,
      handshakeTimeout: 6000 });
    const session = { client, upstream };
    sessions.add(session);
    let upstreamReady = false;
    let queue = [];
    let queued = 0;
    const drop = () => { sessions.delete(session); queue = []; };
    const closePair = () => {
      try { if (client.readyState === WebSocket.OPEN) client.close(1011, 'sfu_disconnected'); } catch {}
      try { if (upstream.readyState === WebSocket.OPEN) upstream.close(1001, 'proxy_closed');
        else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate(); } catch {}
      drop();
    };
    upstream.on('open', () => {
      upstreamReady = true;
      for (const item of queue) upstream.send(item.data, { binary: item.binary });
      queue = [];
      queued = 0;
    });
    client.on('message', (data, binary) => {
      if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary });
      } else if (upstream.readyState === WebSocket.CONNECTING && queued + data.length <= MAX_QUEUE_BYTES) {
        queue.push({ data, binary }); queued += data.length;
      } else closePair();
    });
    upstream.on('message', (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    client.once('close', closePair);
    client.once('error', closePair);
    upstream.once('close', closePair);
    upstream.once('error', err => { logger?.warn?.('[W3] SFU proxy failure', { error: err?.code || 'UPSTREAM_ERROR' }); closePair(); });
  }
  function stop() {
    stopped = true;
    for (const session of [...sessions]) {
      try { session.client.close(1001, 'proxy_stopped'); } catch {}
      try { session.upstream.terminate(); } catch {}
    }
    sessions.clear();
  }
  return Object.freeze({ accept, stop, stats: () => ({ connections: sessions.size, stopped }) });
}
