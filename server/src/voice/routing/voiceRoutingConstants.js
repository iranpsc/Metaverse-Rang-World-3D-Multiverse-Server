const VoiceRoutingDropReason = Object.freeze({
    DUPLICATE: "duplicate",
    LATE: "late",
    EXPIRED: "expired",
    FUTURE_TIMESTAMP: "future_timestamp",
    PACKET_RATE: "packet_rate",
    BYTE_RATE: "byte_rate",
    BITRATE: "bitrate",
    BURST: "burst",
    FAN_OUT_LIMIT: "fan_out_limit",
    LISTENER_MUTED: "listener_muted",
    LISTENER_OFFLINE: "listener_offline",
    LISTENER_BACKPRESSURE: "listener_backpressure"
});

const VoiceRoutingDefaultPolicy = Object.freeze({
    maxOpusFrameBytes: 4096,
    maxPacketAgeMs: 1000,
    maxFutureClockSkewMs: 250,
    maxPacketsPerSecond: 100,
    maxBytesPerSecond: 128 * 1024,
    maxBitsPerSecond: 1024 * 1024,
    maxBurstPackets: 25,
    maxFanOutPerFrame: 32,
    reconnectRetentionMs: 210000
});

//* این تابع سیاست مسیر زنده صوت را ادغام و تمام محدودیت‌های سخت را بررسی می‌کند.
function createVoiceRoutingPolicy(overrides = {}) {
    if (
        !overrides ||
        typeof overrides !== "object" ||
        Array.isArray(overrides)
    ) {
        throw new TypeError(
            "Voice routing policy overrides must be an object."
        );
    }

    const policy = {
        ...VoiceRoutingDefaultPolicy,
        ...overrides
    };

    for (
        const fieldName of [
            "maxOpusFrameBytes",
            "maxPacketAgeMs",
            "maxFutureClockSkewMs",
            "maxPacketsPerSecond",
            "maxBytesPerSecond",
            "maxBitsPerSecond",
            "maxBurstPackets",
            "maxFanOutPerFrame",
            "reconnectRetentionMs"
        ]
    ) {
        if (
            !Number.isSafeInteger(policy[fieldName]) ||
            policy[fieldName] <= 0
        ) {
            throw new RangeError(
                `${fieldName} must be a positive safe integer.`
            );
        }
    }

    if (
        policy.maxBitsPerSecond <
        policy.maxBytesPerSecond * 8
    ) {
        throw new RangeError(
            "maxBitsPerSecond cannot be lower than maxBytesPerSecond multiplied by eight."
        );
    }

    if (
        policy.maxBurstPackets >
        policy.maxPacketsPerSecond
    ) {
        throw new RangeError(
            "maxBurstPackets cannot exceed maxPacketsPerSecond."
        );
    }

    return Object.freeze(policy);
}

export {
    VoiceRoutingDefaultPolicy,
    VoiceRoutingDropReason,
    createVoiceRoutingPolicy
};

/*
توضیح فایل:
این فایل محدودیت‌های قطعی مسیر زنده صوت را برای اندازه فریم، عمر بسته، اختلاف ساعت، نرخ بسته و بایت، بیت‌ریت، جهش لحظه‌ای، تعداد شنونده و نگهداری بازیابی اتصال مشخص می‌کند.
*/
