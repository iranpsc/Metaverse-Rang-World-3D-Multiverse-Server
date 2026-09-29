import { createHmac, timingSafeEqual } from "node:crypto";
import {
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { createVoiceMediaReplayWindow } from "./voiceMediaReplayWindow.js";

const SECURITY_ENVELOPE_VERSION = 1;
const AUTHENTICATION_TAG_BYTES = 16;
const SECURITY_ENVELOPE_BYTES = 1 + AUTHENTICATION_TAG_BYTES;

const VoiceMediaPacketIntegrityReason = Object.freeze({
    ACCEPTED: "accepted",
    INVALID_PACKET: "invalid_packet",
    UNSUPPORTED_KIND: "unsupported_kind",
    INVALID_CONTEXT: "invalid_context",
    INVALID_TAG: "invalid_tag",
    REPLAY_REJECTED: "replay_rejected"
});

function normalizeKey(value) {
    const key = Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
    if (!key || key.length < 32) throw new RangeError("Integrity key must contain at least 32 bytes.");
    return Buffer.from(key);
}

function normalizeContextId(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) throw new RangeError("securityContextId must be a non-zero unsigned 32-bit integer.");
    return value >>> 0;
}

function normalizePayload(value) {
    if (value == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    throw new TypeError("payload must be binary data.");
}

function isProtectedPacketKind(kind) {
    return kind === VoiceMediaV2PacketKind.MEDIA || kind === VoiceMediaV2PacketKind.PING || kind === VoiceMediaV2PacketKind.PONG;
}

function calculateTag(key, packetWithZeroTag) {
    return createHmac("sha256", key).update(packetWithZeroTag).digest().subarray(0, AUTHENTICATION_TAG_BYTES);
}

function createVoiceMediaPacketIntegrityPolicy({ securityContextId, key, replayWindow = createVoiceMediaReplayWindow() } = {}) {
    const contextId = normalizeContextId(securityContextId);
    const integrityKey = normalizeKey(key);
    if (!replayWindow || typeof replayWindow.accept !== "function") throw new TypeError("replayWindow is invalid.");
    let authenticatedPackets = 0;
    let invalidPackets = 0;
    let invalidContextPackets = 0;
    let invalidTagPackets = 0;
    let replayRejectedPackets = 0;

    function protect(packet = {}) {
        if (!isProtectedPacketKind(packet.kind)) throw new RangeError("Packet kind cannot be integrity protected.");
        if (!Number.isSafeInteger(packet.transportSequence) || packet.transportSequence <= 0 || packet.transportSequence > 0xffffffff) throw new RangeError("Protected packet transportSequence is invalid.");
        const originalPayload = normalizePayload(packet.payload);
        const maximumOriginalPayloadBytes = VoiceMediaV2Constants.maximumPayloadBytes - SECURITY_ENVELOPE_BYTES;
        if (originalPayload.length > maximumOriginalPayloadBytes) throw new RangeError("Protected media payload exceeds transport MTU policy.");

        const envelope = Buffer.alloc(SECURITY_ENVELOPE_BYTES + originalPayload.length);
        envelope.writeUInt8(SECURITY_ENVELOPE_VERSION, 0);
        originalPayload.copy(envelope, SECURITY_ENVELOPE_BYTES);
        const encoded = encodeVoiceMediaV2Packet({ ...packet, securityContextId: contextId, payload: envelope });
        const tag = calculateTag(integrityKey, encoded);
        tag.copy(encoded, VoiceMediaV2Constants.headerBytes + 1);
        return encoded;
    }

    function verifyAndUnwrap(input) {
        let raw;
        let packet;
        try {
            raw = normalizePayload(input);
            packet = decodeVoiceMediaV2Packet(raw);
        } catch {
            invalidPackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaPacketIntegrityReason.INVALID_PACKET, packet: null });
        }

        if (!isProtectedPacketKind(packet.kind) || packet.payload.length < SECURITY_ENVELOPE_BYTES || packet.payload.readUInt8(0) !== SECURITY_ENVELOPE_VERSION) {
            invalidPackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaPacketIntegrityReason.UNSUPPORTED_KIND, packet: null });
        }
        if (packet.securityContextId !== contextId) {
            invalidContextPackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaPacketIntegrityReason.INVALID_CONTEXT, packet: null });
        }

        const suppliedTag = packet.payload.subarray(1, SECURITY_ENVELOPE_BYTES);
        const unsigned = Buffer.from(raw);
        unsigned.fill(0, VoiceMediaV2Constants.headerBytes + 1, VoiceMediaV2Constants.headerBytes + SECURITY_ENVELOPE_BYTES);
        const expectedTag = calculateTag(integrityKey, unsigned);
        if (!timingSafeEqual(suppliedTag, expectedTag)) {
            invalidTagPackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaPacketIntegrityReason.INVALID_TAG, packet: null });
        }

        const replay = replayWindow.accept(packet.transportSequence);
        if (!replay.accepted) {
            replayRejectedPackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaPacketIntegrityReason.REPLAY_REJECTED, replayReason: replay.reason, packet: null });
        }

        authenticatedPackets += 1;
        const payload = Buffer.from(packet.payload.subarray(SECURITY_ENVELOPE_BYTES));
        const unwrapped = Object.freeze({ ...packet, payloadBytes: payload.length, payload });
        return Object.freeze({ accepted: true, reason: VoiceMediaPacketIntegrityReason.ACCEPTED, packet: unwrapped });
    }

    function getStats() {
        return Object.freeze({ securityContextId: contextId, authenticatedPackets, invalidPackets, invalidContextPackets, invalidTagPackets, replayRejectedPackets, replay: replayWindow.getStats?.() ?? null });
    }

    function dispose() {
        integrityKey.fill(0);
        replayWindow.reset?.();
    }

    return Object.freeze({ protect, verifyAndUnwrap, getStats, dispose });
}

export {
    AUTHENTICATION_TAG_BYTES,
    SECURITY_ENVELOPE_BYTES,
    SECURITY_ENVELOPE_VERSION,
    VoiceMediaPacketIntegrityReason,
    createVoiceMediaPacketIntegrityPolicy
};
