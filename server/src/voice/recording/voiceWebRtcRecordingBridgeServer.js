import net from 'node:net';
import { decodeRecordingFrame, MAX_LINE_BYTES, recordingBridgeSecret } from './voiceWebRtcRecordingProtocol.js';

function createVoiceWebRtcRecordingBridgeServer({ recordingService, secretBase64, port = 8768,
  logger = console, now = () => Date.now() } = {}) {
  if (!recordingService || typeof recordingService.captureWebRtcFrame !== 'function')
    throw new TypeError('W4_RECORDING_SERVICE_REQUIRED');
  const secret = recordingBridgeSecret(secretBase64);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('W4_RECORDING_PORT_INVALID');
  const sockets = new Set();
  let server = null;
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalCaptured = 0;
  function onClient(socket) {
    if (sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket);
    socket.setNoDelay(true);
    let pending = Buffer.alloc(0);
    let lastSequence = 0;
    socket.on('data', chunk => {
      let cursor = 0;
      while (cursor < chunk.length) {
        const newline = chunk.indexOf(10, cursor);
        const part = chunk.subarray(cursor, newline < 0 ? chunk.length : newline);
        if (pending.length + part.length > MAX_LINE_BYTES) { socket.destroy(); return; }
        if (newline < 0) {
          pending = Buffer.concat([pending, part]);
          break;
        }
        const line = pending.length ? Buffer.concat([pending, part]) : part;
        pending = Buffer.alloc(0);
        cursor = newline + 1;
        const frame = decodeRecordingFrame(line, { secret, lastSequence, now: now() });
        if (!frame) { totalRejected += 1; socket.destroy(); return; }
        lastSequence = frame.sequence;
        totalAccepted += 1;
        try {
          totalCaptured += recordingService.captureWebRtcFrame(frame);
          if (totalAccepted === 1 || totalAccepted % 2000 === 0) {
            logger?.info?.('[VME2_W4_RECORDING] frame_progress',
              { ingressFrames: totalAccepted, recordingFrames: totalCaptured });
          }
        } catch (err) {
          logger?.warn?.('[VME2_W4_RECORDING] capture_error',
            { error: String(err?.message ?? err).slice(0, 120) });
        }
      }
    });
    socket.once('close', () => sockets.delete(socket));
    socket.once('error', () => socket.destroy());
  }
  async function start() {
    if (server) return;
    const candidate = net.createServer(onClient);
    try {
      await new Promise((resolve, reject) => {
        candidate.once('error', reject);
        candidate.listen(port, '127.0.0.1', () => { candidate.off('error', reject); resolve(); });
      });
    } catch (error) { candidate.close(); throw error; }
    server = candidate;
    logger?.info?.('[VME2_W4_RECORDING] bridge_listening', { address: '127.0.0.1', port });
  }
  async function stop() {
    const running = server;
    if (!running) return;
    server = null;
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => running.close(() => resolve()));
  }
  return Object.freeze({ start, stop,
    getStats: () => ({ clients: sockets.size, ingressFrames: totalAccepted,
      rejectedFrames: totalRejected, recordingFrames: totalCaptured }) });
}

export { createVoiceWebRtcRecordingBridgeServer };
