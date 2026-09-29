import { Buffer } from "node:buffer";

const VoiceMediaNodeBridgeConstants = Object.freeze({
    magic: Buffer.from([0x56, 0x4d, 0x31, 0x30]),
    version: 1,
    headerBytes: 20,
    maximumMetadataBytes: 64 * 1024,
    maximumPayloadBytes: 256 * 1024
});

const VoiceMediaNodeBridgeMessageType = Object.freeze({
    AUTHORIZE_BIND_REQUEST: 1,
    AUTHORIZE_BIND_RESULT: 2,
    ROUTE_FRAME_REQUEST: 3,
    ROUTE_FRAME_RESULT: 4,
    DELIVER_MEDIA_REQUEST: 5,
    DELIVER_MEDIA_RESULT: 6,
    CLOSE_MEDIA_REQUEST: 7,
    CLOSE_MEDIA_RESULT: 8,
    ERROR: 9
});

//* این تابع فراداده را به یک شیء ساده و قابل تبدیل محدود می کند.
function normalizeMetadata(metadata) {
    if (metadata === null || metadata === undefined) return {};
    if (typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError("Bridge metadata must be an object.");
    return metadata;
}

//* این تابع داده باینری اختیاری را به بافر مستقل تبدیل می کند.
function normalizePayload(payload) {
    if (payload === null || payload === undefined) return Buffer.alloc(0);
    if (Buffer.isBuffer(payload)) return Buffer.from(payload);
    if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    throw new TypeError("Bridge payload must be binary.");
}

//* این تابع یک پیام داخلی نسخه دار را همراه فراداده و داده باینری می سازد.
function encodeVoiceMediaNodeBridgeMessage({ type, requestId = 0, metadata = {}, payload = null } = {}) {
    if (!Object.values(VoiceMediaNodeBridgeMessageType).includes(type)) throw new RangeError("Bridge message type is invalid.");
    if (!Number.isInteger(requestId) || requestId < 0 || requestId > 0xffffffff) throw new RangeError("Bridge request id is invalid.");

    const metadataBytes = Buffer.from(JSON.stringify(normalizeMetadata(metadata)), "utf8");
    const payloadBytes = normalizePayload(payload);
    if (metadataBytes.length > VoiceMediaNodeBridgeConstants.maximumMetadataBytes) throw new RangeError("Bridge metadata is too large.");
    if (payloadBytes.length > VoiceMediaNodeBridgeConstants.maximumPayloadBytes) throw new RangeError("Bridge payload is too large.");

    const packet = Buffer.alloc(VoiceMediaNodeBridgeConstants.headerBytes + metadataBytes.length + payloadBytes.length);
    VoiceMediaNodeBridgeConstants.magic.copy(packet, 0);
    packet.writeUInt8(VoiceMediaNodeBridgeConstants.version, 4);
    packet.writeUInt8(type, 5);
    packet.writeUInt16BE(0, 6);
    packet.writeUInt32BE(requestId >>> 0, 8);
    packet.writeUInt32BE(metadataBytes.length >>> 0, 12);
    packet.writeUInt32BE(payloadBytes.length >>> 0, 16);
    metadataBytes.copy(packet, VoiceMediaNodeBridgeConstants.headerBytes);
    payloadBytes.copy(packet, VoiceMediaNodeBridgeConstants.headerBytes + metadataBytes.length);
    return packet;
}

//* این تابع یک پیام داخلی را با کنترل کامل طول و نسخه باز می کند.
function decodeVoiceMediaNodeBridgeMessage(input) {
    const packet = normalizePayload(input);
    if (packet.length < VoiceMediaNodeBridgeConstants.headerBytes) throw new Error("Bridge packet is too short.");
    if (!packet.subarray(0, 4).equals(VoiceMediaNodeBridgeConstants.magic)) throw new Error("Bridge packet magic is invalid.");
    if (packet.readUInt8(4) !== VoiceMediaNodeBridgeConstants.version) throw new Error("Bridge protocol version is invalid.");
    if (packet.readUInt16BE(6) !== 0) throw new Error("Bridge reserved field is invalid.");

    const type = packet.readUInt8(5);
    if (!Object.values(VoiceMediaNodeBridgeMessageType).includes(type)) throw new RangeError("Bridge message type is unknown.");
    const requestId = packet.readUInt32BE(8);
    const metadataLength = packet.readUInt32BE(12);
    const payloadLength = packet.readUInt32BE(16);
    if (metadataLength > VoiceMediaNodeBridgeConstants.maximumMetadataBytes) throw new RangeError("Bridge metadata is too large.");
    if (payloadLength > VoiceMediaNodeBridgeConstants.maximumPayloadBytes) throw new RangeError("Bridge payload is too large.");
    if (packet.length !== VoiceMediaNodeBridgeConstants.headerBytes + metadataLength + payloadLength) throw new Error("Bridge packet length is invalid.");

    const metadataStart = VoiceMediaNodeBridgeConstants.headerBytes;
    const payloadStart = metadataStart + metadataLength;
    let metadata = {};
    if (metadataLength > 0) {
        metadata = JSON.parse(packet.toString("utf8", metadataStart, payloadStart));
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError("Bridge metadata is invalid.");
    }

    return Object.freeze({
        type,
        requestId,
        metadata: Object.freeze({ ...metadata }),
        payload: Buffer.from(packet.subarray(payloadStart))
    });
}

export {
    VoiceMediaNodeBridgeConstants,
    VoiceMediaNodeBridgeMessageType,
    decodeVoiceMediaNodeBridgeMessage,
    encodeVoiceMediaNodeBridgeMessage
};
