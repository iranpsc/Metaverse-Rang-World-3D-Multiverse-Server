import { createCipheriv } from "node:crypto";
import { VoiceMediaV2PacketKind } from "../mediaV2/voiceMediaV2Protocol.js";

const ENCRYPTION_KEY_BYTES = 32;
const COUNTER_BYTES = 16;
const COUNTER_DOMAIN = Buffer.from("VME2ENC1", "ascii");

function normalizeKey(value) {
    const key = Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
    if (!key || key.length !== ENCRYPTION_KEY_BYTES) throw new RangeError("Media encryption key must contain exactly 32 bytes.");
    return Buffer.from(key);
}

function normalizeContextId(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) throw new RangeError("securityContextId must be a non-zero unsigned 32-bit integer.");
    return value >>> 0;
}

function isEncryptedKind(kind) {
    return kind === VoiceMediaV2PacketKind.MEDIA || kind === VoiceMediaV2PacketKind.PING || kind === VoiceMediaV2PacketKind.PONG;
}

function createCounter(securityContextId, transportSequence) {
    if (!Number.isSafeInteger(transportSequence) || transportSequence <= 0 || transportSequence > 0xffffffff) throw new RangeError("Encrypted packet transportSequence is invalid.");
    const counter = Buffer.alloc(COUNTER_BYTES);
    counter.writeUInt32BE(securityContextId, 0);
    counter.writeUInt32BE(transportSequence >>> 0, 4);
    COUNTER_DOMAIN.copy(counter, 8);
    return counter;
}

function copyPacket(packet, payload) {
    return Object.freeze({ ...packet, payloadBytes: payload.length, payload });
}

function createVoiceMediaPayloadCipher({ securityContextId, key } = {}) {
    const contextId = normalizeContextId(securityContextId);
    const encryptionKey = normalizeKey(key);
    let encryptedPackets = 0;
    let decryptedPackets = 0;
    let disposed = false;

    function transform(packet) {
        if (disposed) throw new Error("Media payload cipher is disposed.");
        if (!packet || !isEncryptedKind(packet.kind)) throw new RangeError("Packet kind cannot be encrypted.");
        const payload = Buffer.isBuffer(packet.payload) ? Buffer.from(packet.payload) : packet.payload instanceof Uint8Array ? Buffer.from(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength) : null;
        if (!payload) throw new TypeError("packet payload must be binary data.");
        const counter = createCounter(contextId, packet.transportSequence);
        const cipher = createCipheriv("aes-256-ctr", encryptionKey, counter);
        const output = Buffer.concat([cipher.update(payload), cipher.final()]);
        counter.fill(0);
        return copyPacket(packet, output);
    }

    function encrypt(packet) {
        const result = transform(packet);
        encryptedPackets += 1;
        return result;
    }

    function decrypt(packet) {
        const result = transform(packet);
        decryptedPackets += 1;
        return result;
    }

    function getStats() {
        return Object.freeze({ securityContextId: contextId, encryptedPackets, decryptedPackets });
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        encryptionKey.fill(0);
    }

    return Object.freeze({ encrypt, decrypt, getStats, dispose });
}

export {
    COUNTER_BYTES,
    ENCRYPTION_KEY_BYTES,
    createVoiceMediaPayloadCipher
};
