// مسیر فایل: src/voice/reconnect/voiceReconnectConstants.js

//* این ثابت وضعیت زمانی بازیابی اتصال صوتی را مشخص می‌کند.
const VoiceReconnectWindowState = Object.freeze({
    RETRY_ALLOWED: 1,
    CLIENT_DEADLINE_EXPIRED: 2,
    SERVER_RETENTION_EXPIRED: 3
});

//* این ثابت نام هر وضعیت زمانی بازیابی اتصال صوتی را نگه می‌دارد.
const VoiceReconnectWindowStateNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceReconnectWindowState).map(
            ([name, value]) => [value, name]
        )
    )
);

//* این ثابت نتیجه‌های قابل ارسال برای بازیابی اتصال صوتی را مشخص می‌کند.
const VoiceReconnectResultCode = Object.freeze({
    RESUMED: 0,
    INVALID_PAYLOAD: 1,
    CONNECTION_NOT_FOUND: 2,
    ACCESS_TOKEN_INVALID: 3,
    ACCESS_TOKEN_EXPIRED: 4,
    USER_ID_MISSING: 5,
    REALTIME_NOT_READY: 6,
    ROOM_NOT_JOINED: 7,
    AVATAR_NOT_OWNED: 8,
    DEDICATED_NOT_AUTHENTICATED: 9,
    DISTANCE_NOT_ALLOWED: 10,
    CLIENT_DEADLINE_EXPIRED: 11,
    SERVER_RETENTION_EXPIRED: 12,
    VOICE_ACCESS_DENIED: 13,
    INTERNAL_ERROR: 255
});

//* این ثابت نام هر نتیجه بازیابی اتصال صوتی را نگه می‌دارد.
const VoiceReconnectResultCodeNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceReconnectResultCode).map(
            ([name, value]) => [value, name]
        )
    )
);

//* این ثابت نوع پاک‌سازی موردنیاز برای اتصال و نشست‌های صوتی را مشخص می‌کند.
const VoiceCleanupAction = Object.freeze({
    NONE: 0,
    SUSPEND_AUDIO_ROUTING: 1,
    CLOSE_AFFECTED_SESSION: 2,
    CLOSE_ALL_SESSIONS: 3,
    REMOVE_CONNECTION: 4,
    CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION: 5
});

//* این ثابت نام هر نوع پاک‌سازی را نگه می‌دارد.
const VoiceCleanupActionNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceCleanupAction).map(
            ([name, value]) => [value, name]
        )
    )
);

//* این ثابت اندازه مجاز فیلدهای متنی پیام بازیابی اتصال را مشخص می‌کند.
const VoiceReconnectPayloadLimits = Object.freeze({
    accessTokenBytes: 16384,
    roomIdBytes: 512,
    avatarIdBytes: 512,
    resultMessageBytes: 1024
});

//* این ثابت محل فیلدهای درخواست بازیابی اتصال را مشخص می‌کند.
const VoiceReconnectRequestLayout = Object.freeze({
    fixedBytes: 56,

    offsets: Object.freeze({
        previousVoiceConnectionId: 0,
        clientInstanceId: 16,
        lastReceivedSequence: 32,
        lastPublishedSequence: 36,
        disconnectedAtMs: 40,
        accessTokenLength: 48,
        roomIdLength: 50,
        avatarIdLength: 52,
        reserved: 54
    })
});

//* این ثابت محل فیلدهای نتیجه بازیابی اتصال را مشخص می‌کند.
const VoiceReconnectResultLayout = Object.freeze({
    fixedBytes: 36,

    offsets: Object.freeze({
        success: 0,
        retryable: 1,
        code: 2,
        voiceConnectionId: 4,
        resumeFromSequence: 20,
        serverTimeMs: 24,
        retainedSessionCount: 32,
        messageLength: 34
    })
});

//* این تابع وضعیت زمانی بازیابی اتصال را بررسی می‌کند.
function assertVoiceReconnectWindowState(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(
            VoiceReconnectWindowStateNameByValue,
            value
        )
    ) {
        throw new RangeError(
            `Unknown Voice reconnect window state: ${String(value)}.`
        );
    }

    return value;
}

//* این تابع کد نتیجه بازیابی اتصال را بررسی می‌کند.
function assertVoiceReconnectResultCode(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(
            VoiceReconnectResultCodeNameByValue,
            value
        )
    ) {
        throw new RangeError(
            `Unknown Voice reconnect result code: ${String(value)}.`
        );
    }

    return value;
}

//* این تابع نوع پاک‌سازی اتصال و نشست‌های صوتی را بررسی می‌کند.
function assertVoiceCleanupAction(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(
            VoiceCleanupActionNameByValue,
            value
        )
    ) {
        throw new RangeError(
            `Unknown Voice cleanup action: ${String(value)}.`
        );
    }

    return value;
}

export {
    VoiceCleanupAction,
    VoiceCleanupActionNameByValue,
    VoiceReconnectPayloadLimits,
    VoiceReconnectRequestLayout,
    VoiceReconnectResultCode,
    VoiceReconnectResultCodeNameByValue,
    VoiceReconnectResultLayout,
    VoiceReconnectWindowState,
    VoiceReconnectWindowStateNameByValue,
    assertVoiceCleanupAction,
    assertVoiceReconnectResultCode,
    assertVoiceReconnectWindowState
};

/*
توضیح فایل:
این فایل شماره‌ها، وضعیت‌ها، اندازه‌ها و محل فیلدهای مربوط به بازیابی اتصال صوتی و پاک‌سازی نشست‌ها را در یک محل ثابت نگه می‌دارد.
*/
