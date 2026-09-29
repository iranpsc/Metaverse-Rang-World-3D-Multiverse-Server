import {
    voiceBytesToUuid,
    voiceUuidToBytes
} from "../protocol/voiceBinaryEnvelope.js";

const VoiceMediaV2Constants = Object.freeze({
    magic: "MVMT",
    version: 2,
    headerBytes: 88,
    maximumPacketBytes: 1200,
    maximumPayloadBytes: 1112,
    emptyUuid: "00000000-0000-0000-0000-000000000000"
});

const VoiceMediaV2PacketKind = Object.freeze({
    BIND_REQUEST: 1,
    BIND_RESULT: 2,
    MEDIA: 3,
    PING: 4,
    PONG: 5
});

const VoiceMediaV2Codec = Object.freeze({
    NONE: 0,
    OPUS: 1
});

const VoiceMediaV2Flag = Object.freeze({
    NONE: 0,
    END_OF_STREAM: 1,
    DISCONTINUITY: 2,
    RECOVERY: 4
});

//* این تابع یک عدد صحیح نامنفی را در محدوده چهار بایتی بررسی می کند.
function normalizeUInt32(value, fieldName) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${fieldName} must be an unsigned 32-bit integer.`);
    }
    return value;
}

//* این تابع زمان رسانه را به عدد صحیح شصت و چهار بیتی بدون علامت تبدیل می کند.
function normalizeUInt64(value, fieldName) {
    const normalized = typeof value === "bigint" ? value : BigInt(value ?? 0);
    if (normalized < 0n || normalized > 0xffffffffffffffffn) {
        throw new RangeError(`${fieldName} must be an unsigned 64-bit integer.`);
    }
    return normalized;
}

//* این تابع شناسه یکتا را پاک سازی می کند و مقدار خالی قرارداد را نیز می پذیرد.
function normalizeUuid(value, fieldName) {
    const normalized = String(value ?? VoiceMediaV2Constants.emptyUuid).trim().toLowerCase();
    const bytes = voiceUuidToBytes(normalized);
    if (!bytes || bytes.length !== 16) throw new TypeError(`${fieldName} must be a valid UUID.`);
    return normalized;
}

//* این تابع داده خام را به یک بافر مستقل تبدیل می کند.
function normalizePayload(payload) {
    if (payload == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(payload)) return Buffer.from(payload);
    if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    if (payload instanceof ArrayBuffer) return Buffer.from(payload);
    throw new TypeError("payload must be binary data.");
}

//* این تابع یک بسته رسانه نسل دوم را با سربرگ ثابت و محدودیت اندازه می سازد.
function encodeVoiceMediaV2Packet({
    kind,
    codec = VoiceMediaV2Codec.NONE,
    flags = VoiceMediaV2Flag.NONE,
    transportSequence = 0,
    mediaSequence = 0,
    mediaTimestamp100Ns = 0n,
    ackTransportSequence = 0,
    ackMask = 0,
    sessionId = VoiceMediaV2Constants.emptyUuid,
    streamId = VoiceMediaV2Constants.emptyUuid,
    senderId = VoiceMediaV2Constants.emptyUuid,
    securityContextId = 0,
    payload = null
} = {}) {
    if (!Object.values(VoiceMediaV2PacketKind).includes(kind)) throw new RangeError("Unknown media packet kind.");
    if (!Object.values(VoiceMediaV2Codec).includes(codec)) throw new RangeError("Unknown media codec.");
    if (!Number.isInteger(flags) || flags < 0 || flags > 255) throw new RangeError("flags must fit one byte.");

    const safePayload = normalizePayload(payload);
    if (safePayload.length > VoiceMediaV2Constants.maximumPayloadBytes) throw new RangeError("Media payload exceeds transport MTU policy.");

    const packet = Buffer.alloc(VoiceMediaV2Constants.headerBytes + safePayload.length);
    packet.write(VoiceMediaV2Constants.magic, 0, 4, "ascii");
    packet.writeUInt8(VoiceMediaV2Constants.version, 4);
    packet.writeUInt8(kind, 5);
    packet.writeUInt8(codec, 6);
    packet.writeUInt8(flags, 7);
    packet.writeUInt16BE(VoiceMediaV2Constants.headerBytes, 8);
    packet.writeUInt16BE(safePayload.length, 10);
    packet.writeUInt32BE(normalizeUInt32(transportSequence, "transportSequence"), 12);
    packet.writeUInt32BE(normalizeUInt32(mediaSequence, "mediaSequence"), 16);
    packet.writeBigUInt64BE(normalizeUInt64(mediaTimestamp100Ns, "mediaTimestamp100Ns"), 20);
    packet.writeUInt32BE(normalizeUInt32(ackTransportSequence, "ackTransportSequence"), 28);
    packet.writeUInt32BE(normalizeUInt32(ackMask, "ackMask"), 32);
    voiceUuidToBytes(normalizeUuid(sessionId, "sessionId")).copy(packet, 36);
    voiceUuidToBytes(normalizeUuid(streamId, "streamId")).copy(packet, 52);
    voiceUuidToBytes(normalizeUuid(senderId, "senderId")).copy(packet, 68);
    packet.writeUInt32BE(normalizeUInt32(securityContextId, "securityContextId"), 84);
    safePayload.copy(packet, VoiceMediaV2Constants.headerBytes);
    return packet;
}

//* این تابع یک بسته رسانه نسل دوم را بررسی و همه بخش های سربرگ و بدنه را جدا می کند.
function decodeVoiceMediaV2Packet(input) {
    const packet = normalizePayload(input);
    if (packet.length < VoiceMediaV2Constants.headerBytes) throw new RangeError("Media packet is shorter than the fixed header.");
    if (packet.toString("ascii", 0, 4) !== VoiceMediaV2Constants.magic) throw new Error("Media packet magic is invalid.");
    if (packet.readUInt8(4) !== VoiceMediaV2Constants.version) throw new Error("Media packet version is invalid.");

    const headerBytes = packet.readUInt16BE(8);
    const payloadBytes = packet.readUInt16BE(10);
    if (headerBytes !== VoiceMediaV2Constants.headerBytes) throw new Error("Media header length is invalid.");
    if (payloadBytes > VoiceMediaV2Constants.maximumPayloadBytes) throw new RangeError("Media payload exceeds transport MTU policy.");
    if (packet.length !== headerBytes + payloadBytes) throw new Error("Media packet length is invalid.");

    const kind = packet.readUInt8(5);
    const codec = packet.readUInt8(6);
    if (!Object.values(VoiceMediaV2PacketKind).includes(kind)) throw new RangeError("Unknown media packet kind.");
    if (!Object.values(VoiceMediaV2Codec).includes(codec)) throw new RangeError("Unknown media codec.");

    return Object.freeze({
        kind,
        codec,
        flags: packet.readUInt8(7),
        headerBytes,
        payloadBytes,
        transportSequence: packet.readUInt32BE(12),
        mediaSequence: packet.readUInt32BE(16),
        mediaTimestamp100Ns: packet.readBigUInt64BE(20),
        ackTransportSequence: packet.readUInt32BE(28),
        ackMask: packet.readUInt32BE(32),
        sessionId: voiceBytesToUuid(packet.subarray(36, 52)),
        streamId: voiceBytesToUuid(packet.subarray(52, 68)),
        senderId: voiceBytesToUuid(packet.subarray(68, 84)),
        securityContextId: packet.readUInt32BE(84),
        payload: Buffer.from(packet.subarray(headerBytes))
    });
}

//* این تابع درخواست اتصال مسیر رسانه را با توکن و شناسه اتصال مسیر کنترل می سازد.
function encodeVoiceMediaV2BindRequest({
    accessToken,
    roomId,
    controlConnectionId,
    platform = 1,
    clientBuild = ""
} = {}) {
    const token = Buffer.from(String(accessToken ?? "").trim(), "utf8");
    const room = Buffer.from(String(roomId ?? "").trim(), "utf8");
    const build = Buffer.from(String(clientBuild ?? "").trim(), "utf8");
    if (token.length === 0 || token.length > 16384) throw new RangeError("accessToken length is invalid.");
    if (room.length === 0 || room.length > 512) throw new RangeError("roomId length is invalid.");
    if (build.length > 128) throw new RangeError("clientBuild length is invalid.");
    if (!Number.isInteger(platform) || platform < 0 || platform > 255) throw new RangeError("platform is invalid.");

    const result = Buffer.alloc(26 + token.length + room.length + build.length);
    result.writeUInt8(1, 0);
    result.writeUInt8(platform, 1);
    result.writeUInt16BE(token.length, 2);
    result.writeUInt16BE(room.length, 4);
    result.writeUInt16BE(build.length, 6);
    result.writeUInt16BE(0, 8);
    voiceUuidToBytes(normalizeUuid(controlConnectionId, "controlConnectionId")).copy(result, 10);
    token.copy(result, 26);
    room.copy(result, 26 + token.length);
    build.copy(result, 26 + token.length + room.length);
    return result;
}

//* این تابع درخواست اتصال مسیر رسانه را از داده باینری می خواند.
function decodeVoiceMediaV2BindRequest(input) {
    const payload = normalizePayload(input);
    if (payload.length < 26 || payload.readUInt8(0) !== 1) throw new Error("Media bind request is invalid.");
    const tokenLength = payload.readUInt16BE(2);
    const roomLength = payload.readUInt16BE(4);
    const buildLength = payload.readUInt16BE(6);
    if (payload.readUInt16BE(8) !== 0) throw new Error("Media bind request reserved field is invalid.");
    if (payload.length !== 26 + tokenLength + roomLength + buildLength) throw new Error("Media bind request length is invalid.");
    const cursorToken = 26;
    const cursorRoom = cursorToken + tokenLength;
    const cursorBuild = cursorRoom + roomLength;
    return Object.freeze({
        platform: payload.readUInt8(1),
        controlConnectionId: voiceBytesToUuid(payload.subarray(10, 26)),
        accessToken: payload.toString("utf8", cursorToken, cursorRoom).trim(),
        roomId: payload.toString("utf8", cursorRoom, cursorBuild).trim(),
        clientBuild: payload.toString("utf8", cursorBuild).trim()
    });
}

//* این تابع نتیجه اتصال مسیر رسانه را برای کلاینت به داده باینری تبدیل می کند.
function encodeVoiceMediaV2BindResult({ success, retryable = false, code = 0, controlConnectionId = VoiceMediaV2Constants.emptyUuid, message = "" } = {}) {
    const text = Buffer.from(String(message ?? "").trim(), "utf8");
    if (text.length > 512) throw new RangeError("bind result message is too long.");
    const result = Buffer.alloc(22 + text.length);
    result.writeUInt8(success === true ? 1 : 0, 0);
    result.writeUInt8(retryable === true ? 1 : 0, 1);
    result.writeUInt16BE(Number(code) & 0xffff, 2);
    voiceUuidToBytes(normalizeUuid(controlConnectionId, "controlConnectionId")).copy(result, 4);
    result.writeUInt16BE(text.length, 20);
    text.copy(result, 22);
    return result;
}

//* این تابع نتیجه اتصال مسیر رسانه را از داده باینری می خواند.
function decodeVoiceMediaV2BindResult(input) {
    const payload = normalizePayload(input);
    if (payload.length < 22) throw new Error("Media bind result is invalid.");
    const textLength = payload.readUInt16BE(20);
    if (payload.length !== 22 + textLength) throw new Error("Media bind result length is invalid.");
    return Object.freeze({
        success: payload.readUInt8(0) === 1,
        retryable: payload.readUInt8(1) === 1,
        code: payload.readUInt16BE(2),
        controlConnectionId: voiceBytesToUuid(payload.subarray(4, 20)),
        message: payload.toString("utf8", 22).trim()
    });
}

export {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2Flag,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindRequest,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2BindResult,
    encodeVoiceMediaV2Packet
};
