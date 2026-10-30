import net from 'node:net';
import { encodeRecordingFrame, recordingBridgeSecret, extractOpusFromRtp } from '../recording/voiceWebRtcRecordingProtocol.js';

export function createWebRtcRecordingBridgeClient({ secretBase64, port = 8768,
  logger = console, retryMs = 2000 } = {}) {
  const secret = recordingBridgeSecret(secretBase64);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('W4_RECORDING_PORT_INVALID');
  let socket = null;
  let reconnectTimer = null;
  let stopped = false;
  let sequence = 0;
  let forwarded = 0;
  let dropped = 0;
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, retryMs);
    reconnectTimer.unref?.();
  }
  function connect() {
    if (stopped || socket) return;
    const next = net.createConnection({ host: '127.0.0.1', port });
    socket = next;
    let established = false;
    next.setNoDelay(true);
    next.on('connect', () => {
      established = true;
      sequence = 0;
      logger?.info?.('[VME2_W4_RECORDING] bridge_connected');
    });
    next.on('error', () => { /* backend may be restarting; never interfere with voice */ });
    next.once('close', () => {
      if (socket === next) socket = null;
      if (established) logger?.warn?.('[VME2_W4_RECORDING] bridge_disconnected');
      scheduleReconnect();
    });
  }
  function sendRtp({ roomId, connectionId, rtpPacket }) {
    const current = socket;
    if (!current || current.destroyed || !current.writable || current.connecting || current.writableLength > 256 * 1024) {
      dropped += 1; return false;
    }
    const payload = extractOpusFromRtp(rtpPacket);
    if (!payload) { dropped += 1; return false; }
    try {
      const frame = encodeRecordingFrame({ roomId, connectionId, payload, sequence: ++sequence, secret });
      current.write(frame);
      forwarded += 1;
      return true;
    } catch {
      dropped += 1;
      return false;
    }
  }
  function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    socket?.destroy(); socket = null;
  }
  connect();
  return Object.freeze({ sendRtp, stop,
    getStats: () => ({ connected: !!socket && !socket.connecting && !socket.destroyed,
      forwarded, dropped }) });
}
