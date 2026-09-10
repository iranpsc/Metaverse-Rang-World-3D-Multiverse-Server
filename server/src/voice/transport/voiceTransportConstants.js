// مسیر فایل: src/voice/transport/voiceTransportConstants.js

//* این ثابت نام راه‌های انتقال آزمایشی پایه ارتباط صوتی را مشخص می‌کند.
const VoiceTransportName = Object.freeze({
    WEBSOCKET:
        "websocket",

    GRPC:
        "grpc",

    WEBSOCKET_BINARY_TEST:
        "websocket_binary_test",

    GRPC_BIDIRECTIONAL_TEST:
        "grpc_bidirectional_test"
});

//* این ثابت وضعیت‌های پردازش یک اتصال در هسته انتقال را مشخص می‌کند.
const VoiceTransportConnectionState = Object.freeze({
    WAITING_AUTH: "waiting_auth",
    ACTIVE: "active",
    CLOSING: "closing",
    CLOSED: "closed"
});

//* این ثابت کدهای بستن اتصال در آداپتورهای انتقال را مشخص می‌کند.
const VoiceTransportCloseCode = Object.freeze({
    NORMAL: 1000,
    PROTOCOL_ERROR: 4400,
    AUTH_TIMEOUT: 4401,
    AUTH_FAILED: 4403,
    HEARTBEAT_TIMEOUT: 4408,
    PACKET_TOO_LARGE: 4409,
    BACKPRESSURE: 4410,
    INTERNAL_ERROR: 4500
});

//* این ثابت مقادیر پایه محدودیت‌ها و زمان‌سنج‌های هسته انتقال را نگه می‌دارد.
const VoiceTransportDefaultPolicy = Object.freeze({
    maxPacketBytes: 64 * 1024,
    maxBufferedBytes: 512 * 1024,
    authTimeoutMs: 10_000,
    heartbeatIntervalMs: 5_000,
    heartbeatTimeoutMs: 15_000,
    sendTimeoutMs: 5_000,
    firstIncomingSequence: 1,
    maximumSequence: 0xffffffff
});

//* این تابع سیاست انتقال را با مقادیر سفارشی ادغام و تمام محدوده‌ها را بررسی می‌کند.
function createVoiceTransportPolicy(overrides = {}) {
    if (
        !overrides ||
        typeof overrides !== "object" ||
        Array.isArray(overrides)
    ) {
        throw new TypeError(
            "Voice transport policy overrides must be an object."
        );
    }

    const policy = {
        ...VoiceTransportDefaultPolicy,
        ...overrides
    };

    for (
        const fieldName of [
            "maxPacketBytes",
            "maxBufferedBytes",
            "authTimeoutMs",
            "heartbeatIntervalMs",
            "heartbeatTimeoutMs",
            "sendTimeoutMs",
            "firstIncomingSequence",
            "maximumSequence"
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
        policy.firstIncomingSequence >
        policy.maximumSequence
    ) {
        throw new RangeError(
            "firstIncomingSequence cannot exceed maximumSequence."
        );
    }

    if (
        policy.heartbeatTimeoutMs <=
        policy.heartbeatIntervalMs
    ) {
        throw new RangeError(
            "heartbeatTimeoutMs must be greater than heartbeatIntervalMs."
        );
    }

    return Object.freeze(policy);
}

export {
    VoiceTransportCloseCode,
    VoiceTransportConnectionState,
    VoiceTransportDefaultPolicy,
    VoiceTransportName,
    createVoiceTransportPolicy
};

/*
توضیح فایل:
این فایل نام راه‌های انتقال آزمایشی، وضعیت اتصال، کدهای بستن و محدودیت‌های پایه هسته انتقال را نگه می‌دارد. این مقادیر هیچ شنونده ثابت یا اتصال به اجرای اصلی سرور ایجاد نمی‌کنند.
*/
