// File: src/voice/protocol/voiceMessageTypes.js

//* این ثابت شماره یکتای هر نوع پیام Voice را مشخص می‌کند.
const VoiceMessageType = Object.freeze({
    AUTH_REQUEST: 1,
    AUTH_RESULT: 2,
    HEARTBEAT: 3,
    HEARTBEAT_ACK: 4,
    DISCONNECT: 5,
    ACK: 6,

    SESSION_SNAPSHOT: 16,
    SESSION_JOINED: 17,
    SESSION_LEFT: 18,
    SESSION_CLOSED: 19,

    PUBLISH_START: 32,
    VOICE_FRAME: 33,
    PUBLISH_STOP: 34,

    LISTENER_MUTE_CHANGED: 48,
    RECORDING_CONSENT_CHANGED: 49,
    RECORDING_STATE_CHANGED: 50,

    RECONNECT_REQUEST: 64,
    RECONNECT_RESULT: 65,

    ERROR: 255
});

//* این ثابت نام هر شماره پیام را نگه می‌دارد.
const VoiceMessageTypeNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceMessageType).map(([name, value]) => [value, name])
    )
);

//* این تابع بررسی می‌کند شماره پیام در قرارداد تعریف شده است.
function isKnownVoiceMessageType(value) {
    return Number.isInteger(value) &&
        value >= 0 &&
        value <= 255 &&
        Object.hasOwn(VoiceMessageTypeNameByValue, value);
}

//* این تابع شماره پیام را بررسی و در صورت نامعتبر بودن خطا ایجاد می‌کند.
function assertKnownVoiceMessageType(value) {
    if (!isKnownVoiceMessageType(value)) {
        throw new RangeError(`Unknown Voice message type: ${String(value)}.`);
    }

    return value;
}

//* این تابع نام نوع پیام را از روی شماره آن برمی‌گرداند.
function getVoiceMessageTypeName(value) {
    assertKnownVoiceMessageType(value);
    return VoiceMessageTypeNameByValue[value];
}

export {
    VoiceMessageType,
    VoiceMessageTypeNameByValue,
    assertKnownVoiceMessageType,
    getVoiceMessageTypeName,
    isKnownVoiceMessageType
};
