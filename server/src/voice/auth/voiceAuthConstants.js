// File: src/voice/auth/voiceAuthConstants.js

//* این ثابت شماره هر پلتفرم کلاینت Voice را مشخص می‌کند.
const VoiceClientPlatform = Object.freeze({
    WEBGL: 1,
    WINDOWS: 2,
    QUEST: 3
});

//* این ثابت نام هر شماره پلتفرم را نگه می‌دارد.
const VoiceClientPlatformNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceClientPlatform).map(([name, value]) => [value, name])
    )
);

//* این ثابت نتیجه‌های قابل ارسال برای احراز هویت Voice را مشخص می‌کند.
const VoiceAuthResultCode = Object.freeze({
    AUTHENTICATED: 0,
    INVALID_PAYLOAD: 1,
    ACCESS_TOKEN_MISSING: 2,
    ACCESS_TOKEN_INVALID: 3,
    ACCESS_TOKEN_EXPIRED: 4,
    USER_ID_MISSING: 5,
    REALTIME_NOT_READY: 6,
    ROOM_NOT_JOINED: 7,
    AVATAR_NOT_OWNED: 8,
    DEDICATED_NOT_AUTHENTICATED: 9,
    VOICE_ACCESS_DENIED: 10,
    INTERNAL_ERROR: 255
});

//* این ثابت نام هر کد نتیجه احراز هویت را نگه می‌دارد.
const VoiceAuthResultCodeNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceAuthResultCode).map(([name, value]) => [value, name])
    )
);

//* این ثابت حداکثر اندازه فیلدهای متنی Payload احراز هویت را مشخص می‌کند.
const VoiceAuthPayloadLimits = Object.freeze({
    accessTokenBytes: 16384,
    roomIdBytes: 512,
    avatarIdBytes: 512,
    clientBuildBytes: 128,
    resultUserIdBytes: 512,
    resultMessageBytes: 1024
});

//* این ثابت محل فیلدهای Payload درخواست احراز هویت را مشخص می‌کند.
const VoiceAuthRequestLayout = Object.freeze({
    fixedBytes: 26,

    offsets: Object.freeze({
        platform: 0,
        reserved: 1,
        accessTokenLength: 2,
        roomIdLength: 4,
        avatarIdLength: 6,
        clientBuildLength: 8,
        clientInstanceId: 10
    })
});

//* این ثابت محل فیلدهای Payload نتیجه احراز هویت را مشخص می‌کند.
const VoiceAuthResultLayout = Object.freeze({
    fixedBytes: 24,

    offsets: Object.freeze({
        success: 0,
        retryable: 1,
        code: 2,
        voiceConnectionId: 4,
        userIdLength: 20,
        messageLength: 22
    })
});

//* این تابع شماره پلتفرم را بررسی می‌کند.
function assertVoiceClientPlatform(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(VoiceClientPlatformNameByValue, value)
    ) {
        throw new RangeError(`Unknown Voice client platform: ${String(value)}.`);
    }

    return value;
}

//* این تابع کد نتیجه احراز هویت را بررسی می‌کند.
function assertVoiceAuthResultCode(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(VoiceAuthResultCodeNameByValue, value)
    ) {
        throw new RangeError(`Unknown Voice authentication result code: ${String(value)}.`);
    }

    return value;
}

export {
    VoiceAuthPayloadLimits,
    VoiceAuthRequestLayout,
    VoiceAuthResultCode,
    VoiceAuthResultCodeNameByValue,
    VoiceAuthResultLayout,
    VoiceClientPlatform,
    VoiceClientPlatformNameByValue,
    assertVoiceAuthResultCode,
    assertVoiceClientPlatform
};
