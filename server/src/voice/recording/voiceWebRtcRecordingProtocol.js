import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ROOM_RE = /^[\p{L}\p{N}_.:-]{1,128}$/u;
const MAX_PACKET_BYTES = 4096;
const MAX_LINE_BYTES = 8192;
const MAX_CLOCK_SKEW_MS = 10000;

function recordingBridgeSecret(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('W4_RECORDING_SECRET_REQUIRED');
  }
  const secret = Buffer.from(base64, 'base64');
  if (secret.length < 32) throw new Error('W4_RECORDING_SECRET_TOO_SHORT');
  return secret;
}

function bodyForMac(frame) {
  return `vme2-w4-recording-v1\0${frame.v}\0${frame.ts}\0${frame.seq}\0${frame.roomId}\0${frame.connectionId}\0${frame.payload}`;
}

function macForFrame(frame, secret) {
  return createHmac('sha256', secret).update(bodyForMac(frame)).digest('base64url');
}

function encodeRecordingFrame({ roomId, connectionId, payload, sequence, secret, now = Date.now() }) {
  if (!ROOM_RE.test(roomId) || !UUID_RE.test(connectionId) || !Buffer.isBuffer(payload) ||
      payload.length < 1 || payload.length > MAX_PACKET_BYTES ||
      !Number.isSafeInteger(sequence) || sequence < 1 || !Number.isSafeInteger(now)) {
    throw new Error('W4_RECORDING_INVALID_FRAME');
  }
  const frame = { v: 1, ts: now, seq: sequence, roomId,
    connectionId: connectionId.toLowerCase(), payload: payload.toString('base64') };
  frame.mac = macForFrame(frame, secret);
  const encoded = Buffer.from(JSON.stringify(frame) + '\n');
  if (encoded.length > MAX_LINE_BYTES) throw new Error('W4_RECORDING_FRAME_TOO_LARGE');
  return encoded;
}

function decodeRecordingFrame(line, { secret, lastSequence = 0, now = Date.now() }) {
  if (!Buffer.isBuffer(line) || line.length === 0 || line.length > MAX_LINE_BYTES) return null;
  let frame;
  try { frame = JSON.parse(line.toString('utf8')); } catch { return null; }
  if (!frame || Array.isArray(frame) || frame.v !== 1 ||
      !Number.isSafeInteger(frame.ts) || Math.abs(now - frame.ts) > MAX_CLOCK_SKEW_MS ||
      !Number.isSafeInteger(frame.seq) || frame.seq <= lastSequence ||
      !ROOM_RE.test(frame.roomId) || !UUID_RE.test(frame.connectionId) ||
      frame.connectionId !== frame.connectionId.toLowerCase() ||
      typeof frame.payload !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.payload) ||
      typeof frame.mac !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(frame.mac)) return null;
  const payload = Buffer.from(frame.payload, 'base64');
  if (payload.length < 1 || payload.length > MAX_PACKET_BYTES) return null;
  const expected = Buffer.from(macForFrame(frame, secret));
  const provided = Buffer.from(frame.mac);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return { roomId: frame.roomId, connectionId: frame.connectionId, payload, sequence: frame.seq };
}

// Strips RTP v2 fixed header, CSRC list, optional extensions, and padding.
// The remaining bytes are the compressed Opus payload, not decoded PCM.
function extractOpusFromRtp(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 13 || (packet[0] >> 6) !== 2) return null;
  const csrcCount = packet[0] & 0x0f;
  let offset = 12 + csrcCount * 4;
  if (offset >= packet.length) return null;
  if ((packet[0] & 0x10) !== 0) {
    if (offset + 4 > packet.length) return null;
    const words = packet.readUInt16BE(offset + 2);
    offset += 4 + words * 4;
    if (offset >= packet.length) return null;
  }
  const padding = packet[0] & 0x20 ? packet[packet.length - 1] : 0;
  const end = packet.length - padding;
  if (padding >= packet.length || end <= offset || end - offset > MAX_PACKET_BYTES) return null;
  return packet.subarray(offset, end);
}

export { MAX_LINE_BYTES, decodeRecordingFrame, encodeRecordingFrame, extractOpusFromRtp, recordingBridgeSecret };
