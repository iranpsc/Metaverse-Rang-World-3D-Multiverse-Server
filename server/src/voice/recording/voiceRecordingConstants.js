const VoiceRecordingState = Object.freeze({
    WAITING_CONSENT: 1,
    RECORDING: 2,
    FINALIZING: 3,
    READY: 4,
    DECLINED: 5,
    FAILED: 6
});

const VoiceRecordingStopReason = Object.freeze({
    SESSION_CLOSED: 1,
    CONSENT_REVOKED: 2,
    SERVER_SHUTDOWN: 3,
    STORAGE_FAILURE: 4
});

const VoiceRecordingDefaultPolicy = Object.freeze({
    maximumSessionDurationMs: 4 * 60 * 60 * 1000,
    maximumPendingFrames: 500,
    maximumOpusFrameBytes: 4096,
    retentionDays: 30
});

//* این تابع سیاست ضبط را با محدودیت‌های صحیح و مثبت می‌سازد.
function createVoiceRecordingPolicy(overrides = {}) {
    if (
        !overrides ||
        typeof overrides !== "object" ||
        Array.isArray(overrides)
    ) {
        throw new TypeError(
            "Voice recording policy overrides must be an object."
        );
    }

    const policy = {
        ...VoiceRecordingDefaultPolicy,
        ...overrides
    };

    for (const fieldName of Object.keys(VoiceRecordingDefaultPolicy)) {
        if (
            !Number.isSafeInteger(policy[fieldName]) ||
            policy[fieldName] <= 0
        ) {
            throw new RangeError(
                `${fieldName} must be a positive safe integer.`
            );
        }
    }

    return Object.freeze(policy);
}

export {
    VoiceRecordingDefaultPolicy,
    VoiceRecordingState,
    VoiceRecordingStopReason,
    createVoiceRecordingPolicy
};

/*
توضیح فایل:
این فایل وضعیت‌ها، علت‌های توقف و محدودیت‌های ثابت ضبط Session صوتی را نگه می‌دارد.
*/
