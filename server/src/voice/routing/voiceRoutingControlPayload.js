import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    voiceBytesToUuid,
    voiceUuidToBytes
} from "../protocol/voiceBinaryEnvelope.js";

const VOICE_ROUTING_CONTROL_VERSION = 1;
const VOICE_OPUS_CODEC = 1;
const VOICE_PUBLISH_START_BYTES = 12;
const VOICE_PUBLISH_STOP_BYTES = 4;
const VOICE_LISTENER_MUTE_CHANGED_BYTES = 20;
const VOICE_CONTROL_ACK_BYTES = 8;

const VoiceListenerMuteKind = Object.freeze({
    SPEAKER_OFF: 1,
    MUTE_ALL: 2,
    PER_USER: 3
});

const VoicePublishStopReason = Object.freeze({
    MIC_MUTED: 1,
    DEVICE_LOST: 2,
    CLIENT_REQUESTED: 3,
    LIFECYCLE_STOPPED: 4
});

const VoiceControlAckCode = Object.freeze({
    ACCEPTED: 0,
    IDEMPOTENT: 1,
    DROPPED: 2
});

//* این تابع ورودی دودویی کنترل مسیر را به بافر تبدیل می‌کند.
function normalizeVoiceRoutingBinary(input, fieldName) {
    if (Buffer.isBuffer(input)) return input;

    if (input instanceof Uint8Array) {
        return Buffer.from(
            input.buffer,
            input.byteOffset,
            input.byteLength
        );
    }

    if (input instanceof ArrayBuffer) {
        return Buffer.from(input);
    }

    throw new TypeError(
        `${fieldName} must be binary.`
    );
}

//* این تابع قرارداد شروع انتشار یک استریم مرجع اوپوس را می‌سازد.
function encodeVoicePublishStartPayload({
    sampleRate = 48000,
    frameDurationMs = 20,
    channels = 1,
    bitrateKbps,
    vbr = true,
    dtx = true
} = {}) {
    if (sampleRate !== 48000) {
        throw new RangeError("Voice sampleRate must be 48000 Hz.");
    }

    if (frameDurationMs !== 20) {
        throw new RangeError("Voice frameDurationMs must be 20 ms.");
    }

    if (channels !== 1) {
        throw new RangeError("Voice channels must be mono.");
    }

    if (![28, 32, 40].includes(bitrateKbps)) {
        throw new RangeError("Voice bitrateKbps must be 28, 32 or 40.");
    }

    const payload = Buffer.alloc(VOICE_PUBLISH_START_BYTES);
    let featureFlags = 0;

    if (vbr === true) featureFlags |= 1;
    if (dtx === true) featureFlags |= 2;

    payload.writeUInt8(VOICE_ROUTING_CONTROL_VERSION, 0);
    payload.writeUInt8(VOICE_OPUS_CODEC, 1);
    payload.writeUInt8(channels, 2);
    payload.writeUInt8(featureFlags, 3);
    payload.writeUInt32BE(sampleRate, 4);
    payload.writeUInt16BE(frameDurationMs, 8);
    payload.writeUInt16BE(bitrateKbps, 10);

    return payload;
}

//* این تابع قرارداد شروع انتشار را می‌خواند و تنظیمات پایه اوپوس را تأیید می‌کند.
function decodeVoicePublishStartPayload(input) {
    const payload = normalizeVoiceRoutingBinary(
        input,
        "Voice publish start payload"
    );

    if (payload.length !== VOICE_PUBLISH_START_BYTES) {
        throw new RangeError(
            `Voice publish start payload must contain ${VOICE_PUBLISH_START_BYTES} bytes.`
        );
    }

    const version = payload.readUInt8(0);
    const codec = payload.readUInt8(1);
    const channels = payload.readUInt8(2);
    const featureFlags = payload.readUInt8(3);
    const sampleRate = payload.readUInt32BE(4);
    const frameDurationMs = payload.readUInt16BE(8);
    const bitrateKbps = payload.readUInt16BE(10);

    if (version !== VOICE_ROUTING_CONTROL_VERSION) {
        throw new Error("Unsupported Voice routing control version.");
    }

    if (codec !== VOICE_OPUS_CODEC) {
        throw new Error("Only Opus is allowed for Voice publishing.");
    }

    if ((featureFlags & ~3) !== 0) {
        throw new Error("Voice publish start payload contains unknown feature flags.");
    }

    encodeVoicePublishStartPayload({
        sampleRate,
        frameDurationMs,
        channels,
        bitrateKbps,
        vbr: (featureFlags & 1) === 1,
        dtx: (featureFlags & 2) === 2
    });

    return Object.freeze({
        version,
        codec,
        channels,
        sampleRate,
        frameDurationMs,
        bitrateKbps,
        vbr: (featureFlags & 1) === 1,
        dtx: (featureFlags & 2) === 2
    });
}

//* این تابع علت توقف انتشار را به قرارداد چهار بایتی تبدیل می‌کند.
function encodeVoicePublishStopPayload({ reason } = {}) {
    if (!Object.values(VoicePublishStopReason).includes(reason)) {
        throw new RangeError("Unknown Voice publish stop reason.");
    }

    const payload = Buffer.alloc(VOICE_PUBLISH_STOP_BYTES);
    payload.writeUInt8(VOICE_ROUTING_CONTROL_VERSION, 0);
    payload.writeUInt8(reason, 1);
    payload.writeUInt16BE(0, 2);
    return payload;
}

//* این تابع علت توقف انتشار را از قرارداد چهار بایتی می‌خواند.
function decodeVoicePublishStopPayload(input) {
    const payload = normalizeVoiceRoutingBinary(
        input,
        "Voice publish stop payload"
    );

    if (payload.length !== VOICE_PUBLISH_STOP_BYTES) {
        throw new RangeError(
            `Voice publish stop payload must contain ${VOICE_PUBLISH_STOP_BYTES} bytes.`
        );
    }

    if (
        payload.readUInt8(0) !== VOICE_ROUTING_CONTROL_VERSION ||
        payload.readUInt16BE(2) !== 0
    ) {
        throw new Error("Voice publish stop payload header is invalid.");
    }

    const reason = payload.readUInt8(1);

    if (!Object.values(VoicePublishStopReason).includes(reason)) {
        throw new RangeError("Unknown Voice publish stop reason.");
    }

    return Object.freeze({ reason });
}

//* این تابع تغییر وضعیت شنونده را همراه هدف اختیاری به داده دودویی تبدیل می‌کند.
function encodeVoiceListenerMuteChangedPayload({
    kind,
    muted,
    targetConnectionId = VoiceBinaryProtocolConstants.emptyUuid
} = {}) {
    if (!Object.values(VoiceListenerMuteKind).includes(kind)) {
        throw new RangeError("Unknown Voice listener mute kind.");
    }

    if (typeof muted !== "boolean") {
        throw new TypeError("muted must be a boolean.");
    }

    const normalizedTargetConnectionId =
        kind === VoiceListenerMuteKind.PER_USER
            ? targetConnectionId
            : VoiceBinaryProtocolConstants.emptyUuid;

    if (
        kind === VoiceListenerMuteKind.PER_USER &&
        normalizedTargetConnectionId === VoiceBinaryProtocolConstants.emptyUuid
    ) {
        throw new Error("Per-user mute requires a target connection id.");
    }

    const payload = Buffer.alloc(VOICE_LISTENER_MUTE_CHANGED_BYTES);
    payload.writeUInt8(VOICE_ROUTING_CONTROL_VERSION, 0);
    payload.writeUInt8(kind, 1);
    payload.writeUInt8(muted ? 1 : 0, 2);
    payload.writeUInt8(0, 3);
    voiceUuidToBytes(normalizedTargetConnectionId).copy(payload, 4);
    return payload;
}

//* این تابع تغییر وضعیت شنونده را از داده دودویی معتبر می‌خواند.
function decodeVoiceListenerMuteChangedPayload(input) {
    const payload = normalizeVoiceRoutingBinary(
        input,
        "Voice listener mute changed payload"
    );

    if (payload.length !== VOICE_LISTENER_MUTE_CHANGED_BYTES) {
        throw new RangeError(
            `Voice listener mute changed payload must contain ${VOICE_LISTENER_MUTE_CHANGED_BYTES} bytes.`
        );
    }

    if (
        payload.readUInt8(0) !== VOICE_ROUTING_CONTROL_VERSION ||
        payload.readUInt8(3) !== 0
    ) {
        throw new Error("Voice listener mute changed payload header is invalid.");
    }

    const kind = payload.readUInt8(1);
    const mutedValue = payload.readUInt8(2);

    if (!Object.values(VoiceListenerMuteKind).includes(kind)) {
        throw new RangeError("Unknown Voice listener mute kind.");
    }

    if (mutedValue !== 0 && mutedValue !== 1) {
        throw new RangeError("Voice listener mute value must be zero or one.");
    }

    const targetConnectionId = voiceBytesToUuid(
        payload.subarray(4, 20)
    );

    if (
        kind === VoiceListenerMuteKind.PER_USER &&
        targetConnectionId === VoiceBinaryProtocolConstants.emptyUuid
    ) {
        throw new Error("Per-user mute requires a target connection id.");
    }

    return Object.freeze({
        kind,
        muted: mutedValue === 1,
        targetConnectionId:
            kind === VoiceListenerMuteKind.PER_USER
                ? targetConnectionId
                : VoiceBinaryProtocolConstants.emptyUuid
    });
}

//* این تابع تأیید یک فرمان کنترل را همراه شماره پیام و کد نتیجه می‌سازد.
function encodeVoiceControlAckPayload({ sequence, code } = {}) {
    if (
        !Number.isSafeInteger(sequence) ||
        sequence <= 0 ||
        sequence > 0xffffffff
    ) {
        throw new RangeError("Voice control ACK sequence is invalid.");
    }

    if (!Object.values(VoiceControlAckCode).includes(code)) {
        throw new RangeError("Unknown Voice control ACK code.");
    }

    const payload = Buffer.alloc(VOICE_CONTROL_ACK_BYTES);
    payload.writeUInt32BE(sequence, 0);
    payload.writeUInt16BE(code, 4);
    payload.writeUInt16BE(0, 6);
    return payload;
}

//* این تابع تأیید فرمان کنترل را از داده هشت بایتی می‌خواند.
function decodeVoiceControlAckPayload(input) {
    const payload = normalizeVoiceRoutingBinary(
        input,
        "Voice control ACK payload"
    );

    if (payload.length !== VOICE_CONTROL_ACK_BYTES) {
        throw new RangeError(
            `Voice control ACK payload must contain ${VOICE_CONTROL_ACK_BYTES} bytes.`
        );
    }

    const sequence = payload.readUInt32BE(0);
    const code = payload.readUInt16BE(4);

    if (sequence <= 0 || payload.readUInt16BE(6) !== 0) {
        throw new Error("Voice control ACK payload header is invalid.");
    }

    if (!Object.values(VoiceControlAckCode).includes(code)) {
        throw new RangeError("Unknown Voice control ACK code.");
    }

    return Object.freeze({ sequence, code });
}

export {
    VOICE_CONTROL_ACK_BYTES,
    VOICE_LISTENER_MUTE_CHANGED_BYTES,
    VOICE_PUBLISH_START_BYTES,
    VOICE_PUBLISH_STOP_BYTES,
    VoiceControlAckCode,
    VoiceListenerMuteKind,
    VoicePublishStopReason,
    decodeVoiceControlAckPayload,
    decodeVoiceListenerMuteChangedPayload,
    decodeVoicePublishStartPayload,
    decodeVoicePublishStopPayload,
    encodeVoiceControlAckPayload,
    encodeVoiceListenerMuteChangedPayload,
    encodeVoicePublishStartPayload,
    encodeVoicePublishStopPayload
};

/*
توضیح فایل:
این فایل قراردادهای دودویی شروع و توقف انتشار، تغییر وضعیت شنونده و تأیید فرمان را تعریف می‌کند و تنظیمات پایه اوپوس تک‌کاناله چهل‌وهشت کیلوهرتز با فریم بیست میلی‌ثانیه‌ای را اجباری نگه می‌دارد.
*/
