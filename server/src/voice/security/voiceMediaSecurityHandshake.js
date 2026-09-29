import { createHmac, randomBytes } from "node:crypto";

const HANDSHAKE_VERSION = "vme2s1";
const HANDSHAKE_PREFIX = "media_bind_ok";
const NONCE_BYTES = 32;
const KEY_BYTES = 32;
const INFO_PREFIX = Buffer.from("VME2-MEDIA-INTEGRITY-V1", "ascii");

function normalizeText(value, fieldName, maximumBytes) {
    const text = String(value ?? "").trim();
    const bytes = Buffer.from(text, "utf8");
    if (!text || bytes.length > maximumBytes) throw new RangeError(`${fieldName} is invalid.`);
    return Object.freeze({ text, bytes });
}

function normalizeContextId(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) throw new RangeError("securityContextId is invalid.");
    return value >>> 0;
}

function normalizeNonce(value) {
    const nonce = Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
    if (!nonce || nonce.length !== NONCE_BYTES) throw new RangeError("security nonce is invalid.");
    return nonce;
}

function writeLengthPrefixedText(value) {
    if (value.length > 0xffff) throw new RangeError("Security context text is too long.");
    const result = Buffer.alloc(2 + value.length);
    result.writeUInt16BE(value.length, 0);
    value.copy(result, 2);
    return result;
}

function buildInfo({ securityContextId, roomId, controlConnectionId, streamId, direction }) {
    const context = Buffer.alloc(4);
    context.writeUInt32BE(normalizeContextId(securityContextId), 0);
    const room = normalizeText(roomId, "roomId", 512).bytes;
    const control = normalizeText(controlConnectionId, "controlConnectionId", 64).bytes;
    const stream = normalizeText(streamId, "streamId", 64).bytes;
    const safeDirection = normalizeText(direction, "direction", 8).bytes;
    return Buffer.concat([INFO_PREFIX, context, writeLengthPrefixedText(room), writeLengthPrefixedText(control), writeLengthPrefixedText(stream), writeLengthPrefixedText(safeDirection)]);
}

function expandKey(prk, info) {
    const block = createHmac("sha256", prk).update(info).update(Buffer.from([1])).digest();
    const result = Buffer.from(block.subarray(0, KEY_BYTES));
    block.fill(0);
    return result;
}

function deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId, streamId, securityContextId, nonce } = {}) {
    const token = normalizeText(accessToken, "accessToken", 16384).bytes;
    const safeNonce = normalizeNonce(nonce);
    const prk = createHmac("sha256", safeNonce).update(token).digest();
    const common = { securityContextId, roomId, controlConnectionId: String(controlConnectionId ?? "").trim().toLowerCase(), streamId: String(streamId ?? "").trim().toLowerCase() };
    const clientToServerKey = expandKey(prk, buildInfo({ ...common, direction: "c2s" }));
    const serverToClientKey = expandKey(prk, buildInfo({ ...common, direction: "s2c" }));
    const clientToServerEncryptionKey = expandKey(prk, buildInfo({ ...common, direction: "c2e" }));
    const serverToClientEncryptionKey = expandKey(prk, buildInfo({ ...common, direction: "s2e" }));
    prk.fill(0);
    safeNonce.fill(0);
    return Object.freeze({ clientToServerKey, serverToClientKey, clientToServerEncryptionKey, serverToClientEncryptionKey });
}

function encodeVoiceMediaSecurityHandshake({ securityContextId, nonce } = {}) {
    const contextId = normalizeContextId(securityContextId);
    const safeNonce = normalizeNonce(nonce);
    return `${HANDSHAKE_PREFIX}|${HANDSHAKE_VERSION}|${contextId.toString(16).padStart(8, "0")}|${safeNonce.toString("base64url")}`;
}

function decodeVoiceMediaSecurityHandshake(message) {
    const parts = String(message ?? "").trim().split("|");
    if (parts.length !== 4 || parts[0] !== HANDSHAKE_PREFIX || parts[1] !== HANDSHAKE_VERSION || !/^[0-9a-f]{8}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) throw new Error("Media security handshake is invalid.");
    const securityContextId = Number.parseInt(parts[2], 16) >>> 0;
    const nonce = Buffer.from(parts[3], "base64url");
    normalizeContextId(securityContextId);
    normalizeNonce(nonce);
    return Object.freeze({ securityContextId, nonce });
}

function createVoiceMediaSecurityHandshake({ accessToken, roomId, controlConnectionId, streamId, randomBytesSource = randomBytes } = {}) {
    if (typeof randomBytesSource !== "function") throw new TypeError("randomBytesSource is invalid.");
    let nonce;
    let securityContextId = 0;
    do {
        nonce = normalizeNonce(randomBytesSource(NONCE_BYTES));
        securityContextId = nonce.readUInt32BE(0) >>> 0;
    } while (securityContextId === 0);
    const keys = deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId, streamId, securityContextId, nonce });
    const message = encodeVoiceMediaSecurityHandshake({ securityContextId, nonce });
    return Object.freeze({ securityContextId, nonce, message, ...keys });
}

export {
    HANDSHAKE_PREFIX,
    HANDSHAKE_VERSION,
    KEY_BYTES,
    NONCE_BYTES,
    createVoiceMediaSecurityHandshake,
    decodeVoiceMediaSecurityHandshake,
    deriveVoiceMediaSecurityKeys,
    encodeVoiceMediaSecurityHandshake
};
