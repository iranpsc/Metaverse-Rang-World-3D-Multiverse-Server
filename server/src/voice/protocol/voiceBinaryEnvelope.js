// File: src/voice/protocol/voiceBinaryEnvelope.js

import {
    VoiceBinaryProtocolConstants
} from "./voiceBinaryProtocolConstants.js";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_UINT8 = 0xff;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT64 = 0xffffffffffffffffn;
const MAGIC_BYTES = Buffer.from(VoiceBinaryProtocolConstants.magicText, "ascii");

//* این تابع یک مقدار عددی صحیح را در محدوده مورد انتظار بررسی می‌کند.
function assertUnsignedInteger(value, fieldName, maxValue) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxValue) {
        throw new RangeError(`${fieldName} must be an unsigned integer between 0 and ${maxValue}.`);
    }

    return value;
}

//* این تابع Timestamp را به عدد صحیح ۶۴ بیتی تبدیل می‌کند.
function normalizeTimestampMs(value) {
    if (typeof value === "bigint") {
        if (value < 0n || value > MAX_UINT64) {
            throw new RangeError("timestampMs is outside the unsigned 64-bit range.");
        }

        return value;
    }

    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError("timestampMs must be a non-negative safe integer or bigint.");
    }

    return BigInt(value);
}

//* این تابع Payload ورودی را به Buffer باینری تبدیل می‌کند.
function normalizePayload(payload) {
    if (payload === undefined || payload === null) return Buffer.alloc(0);
    if (Buffer.isBuffer(payload)) return payload;

    if (payload instanceof Uint8Array) {
        return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    }

    if (payload instanceof ArrayBuffer) {
        return Buffer.from(payload);
    }

    throw new TypeError("payload must be Buffer, Uint8Array or ArrayBuffer.");
}

//* این تابع UUID متنی را به ۱۶ بایت تبدیل می‌کند.
function voiceUuidToBytes(uuid) {
    if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) {
        throw new TypeError(`Invalid UUID: ${String(uuid)}`);
    }

    return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

//* این تابع ۱۶ بایت UUID را دوباره به رشته استاندارد UUID تبدیل می‌کند.
function voiceBytesToUuid(bytes) {
    const buffer = normalizePayload(bytes);

    if (buffer.length !== 16) {
        throw new RangeError("UUID binary value must contain exactly 16 bytes.");
    }

    const hex = buffer.toString("hex");

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32)
    ].join("-");
}

//* این تابع Envelope باینری Voice را از Header و Payload می‌سازد.
function encodeVoiceBinaryEnvelope({
    version = VoiceBinaryProtocolConstants.version,
    messageType,
    flags = 0,
    sequence = 0,
    timestampMs = Date.now(),
    sessionId = VoiceBinaryProtocolConstants.emptyUuid,
    senderId = VoiceBinaryProtocolConstants.emptyUuid,
    payload = Buffer.alloc(0)
} = {}) {
    assertUnsignedInteger(version, "version", MAX_UINT8);
    assertUnsignedInteger(messageType, "messageType", MAX_UINT8);
    assertUnsignedInteger(flags, "flags", MAX_UINT16);
    assertUnsignedInteger(sequence, "sequence", MAX_UINT32);

    const normalizedTimestampMs = normalizeTimestampMs(timestampMs);
    const normalizedPayload = normalizePayload(payload);

    if (normalizedPayload.length > MAX_UINT32) {
        throw new RangeError("payload length exceeds the unsigned 32-bit protocol limit.");
    }

    const sessionIdBytes = voiceUuidToBytes(sessionId);
    const senderIdBytes = voiceUuidToBytes(senderId);
    const headerLength = VoiceBinaryProtocolConstants.fixedHeaderBytes;
    const envelope = Buffer.allocUnsafe(headerLength + normalizedPayload.length);
    const offsets = VoiceBinaryProtocolConstants.offsets;

    MAGIC_BYTES.copy(envelope, offsets.magic);
    envelope.writeUInt8(version, offsets.version);
    envelope.writeUInt8(messageType, offsets.messageType);
    envelope.writeUInt16BE(flags, offsets.flags);
    envelope.writeUInt16BE(headerLength, offsets.headerLength);
    envelope.writeUInt16BE(0, offsets.reserved);
    envelope.writeUInt32BE(normalizedPayload.length, offsets.payloadLength);
    envelope.writeUInt32BE(sequence, offsets.sequence);
    envelope.writeBigUInt64BE(normalizedTimestampMs, offsets.timestampMs);

    sessionIdBytes.copy(envelope, offsets.sessionId);
    senderIdBytes.copy(envelope, offsets.senderId);
    normalizedPayload.copy(envelope, headerLength);

    return envelope;
}

//* این تابع Envelope باینری Voice را اعتبارسنجی و به اطلاعات Header و Payload تبدیل می‌کند.
function decodeVoiceBinaryEnvelope(
    input,
    {
        expectedVersion = VoiceBinaryProtocolConstants.version
    } = {}
) {
    const envelope = normalizePayload(input);
    const offsets = VoiceBinaryProtocolConstants.offsets;
    const minimumHeaderLength = VoiceBinaryProtocolConstants.fixedHeaderBytes;

    if (envelope.length < minimumHeaderLength) {
        throw new RangeError(`Voice envelope must contain at least ${minimumHeaderLength} bytes.`);
    }

    const receivedMagic = envelope.subarray(
        offsets.magic,
        offsets.magic + VoiceBinaryProtocolConstants.sizes.magic
    );

    if (!receivedMagic.equals(MAGIC_BYTES)) {
        throw new Error("Invalid Voice envelope magic.");
    }

    const version = envelope.readUInt8(offsets.version);

    if (expectedVersion !== null && version !== expectedVersion) {
        throw new Error(`Unsupported Voice protocol version: ${version}.`);
    }

    const messageType = envelope.readUInt8(offsets.messageType);
    const flags = envelope.readUInt16BE(offsets.flags);
    const headerLength = envelope.readUInt16BE(offsets.headerLength);
    const payloadLength = envelope.readUInt32BE(offsets.payloadLength);
    const sequence = envelope.readUInt32BE(offsets.sequence);
    const timestampMs = envelope.readBigUInt64BE(offsets.timestampMs);

    if (headerLength < minimumHeaderLength) {
        throw new RangeError(`Invalid Voice header length: ${headerLength}.`);
    }

    if (headerLength > envelope.length) {
        throw new RangeError("Voice header length exceeds the received envelope length.");
    }

    const expectedEnvelopeLength = headerLength + payloadLength;

    if (envelope.length !== expectedEnvelopeLength) {
        throw new RangeError(
            `Voice envelope length mismatch. Expected ${expectedEnvelopeLength}, received ${envelope.length}.`
        );
    }

    const sessionId = voiceBytesToUuid(
        envelope.subarray(
            offsets.sessionId,
            offsets.sessionId + VoiceBinaryProtocolConstants.sizes.sessionId
        )
    );

    const senderId = voiceBytesToUuid(
        envelope.subarray(
            offsets.senderId,
            offsets.senderId + VoiceBinaryProtocolConstants.sizes.senderId
        )
    );

    const payload = envelope.subarray(
        headerLength,
        headerLength + payloadLength
    );

    return {
        version,
        messageType,
        flags,
        headerLength,
        payloadLength,
        sequence,
        timestampMs,
        sessionId,
        senderId,
        payload
    };
}

export {
    decodeVoiceBinaryEnvelope,
    encodeVoiceBinaryEnvelope,
    voiceBytesToUuid,
    voiceUuidToBytes
};
