// File: src/voice/session/voiceSessionConstants.js

//* این ثابت وضعیت‌های قابل استفاده برای Session صوتی را مشخص می‌کند.
const VoiceSessionState = Object.freeze({
    CREATED: 1,
    ACTIVE: 2,
    SUSPENDED: 3,
    CLOSING: 4,
    FINALIZING: 5,
    CLOSED: 6
});

//* این ثابت نام هر شماره وضعیت Session را نگه می‌دارد.
const VoiceSessionStateNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceSessionState).map(([name, value]) => [value, name])
    )
);

//* این ثابت علت ایجاد یا تغییر عضویت Session را مشخص می‌کند.
const VoiceSessionReason = Object.freeze({
    NONE: 0,
    PROXIMITY_ENTER: 1,
    PROXIMITY_EXIT: 2,
    ROOM_LEFT: 3,
    AVATAR_DESPAWNED: 4,
    DEDICATED_DISCONNECTED: 5,
    VOICE_DISCONNECTED: 6,
    RECONNECT_EXPIRED: 7,
    SESSION_CLOSED: 8,
    ACCESS_REVOKED: 9
});

//* این ثابت نام هر شماره علت Session را نگه می‌دارد.
const VoiceSessionReasonNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceSessionReason).map(([name, value]) => [value, name])
    )
);

//* این ثابت نتیجه بررسی فاصله دو آواتار را مشخص می‌کند.
const VoiceProximityDecision = Object.freeze({
    KEEP_CURRENT_STATE: 0,
    ENTER_CANDIDATE: 1,
    EXIT_CANDIDATE: 2
});

//* این ثابت نام هر نتیجه بررسی فاصله را نگه می‌دارد.
const VoiceProximityDecisionNameByValue = Object.freeze(
    Object.fromEntries(
        Object.entries(VoiceProximityDecision).map(([name, value]) => [value, name])
    )
);

//* این ثابت محدودیت‌های Payload مربوط به Session را مشخص می‌کند.
const VoiceSessionPayloadLimits = Object.freeze({
    peerAvatarIdBytes: 512,
    snapshotEntries: 1024,
    snapshotBytes: 4 * 1024 * 1024
});

//* این مقدار برای فاصله نامشخص داخل پروتکل استفاده می‌شود.
const VOICE_UNKNOWN_DISTANCE_MILLIMETERS = 0xffffffff;

//* این ثابت محل فیلدهای Descriptor یک Session را مشخص می‌کند.
const VoiceSessionDescriptorLayout = Object.freeze({
    fixedBytes: 48,

    offsets: Object.freeze({
        sessionId: 0,
        state: 16,
        reason: 17,
        distanceMillimeters: 18,
        effectiveAtMs: 22,
        peerUserId: 30,
        peerAvatarIdLength: 46
    })
});

//* این ثابت محل فیلدهای Snapshot مربوط به Sessionها را مشخص می‌کند.
const VoiceSessionSnapshotLayout = Object.freeze({
    fixedBytes: 4,

    offsets: Object.freeze({
        entryCount: 0,
        reserved: 2
    })
});

//* این تابع وضعیت Session را بررسی می‌کند.
function assertVoiceSessionState(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(VoiceSessionStateNameByValue, value)
    ) {
        throw new RangeError(`Unknown Voice session state: ${String(value)}.`);
    }

    return value;
}

//* این تابع علت Session را بررسی می‌کند.
function assertVoiceSessionReason(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(VoiceSessionReasonNameByValue, value)
    ) {
        throw new RangeError(`Unknown Voice session reason: ${String(value)}.`);
    }

    return value;
}

//* این تابع نتیجه بررسی فاصله را بررسی می‌کند.
function assertVoiceProximityDecision(value) {
    if (
        !Number.isInteger(value) ||
        !Object.hasOwn(VoiceProximityDecisionNameByValue, value)
    ) {
        throw new RangeError(`Unknown Voice proximity decision: ${String(value)}.`);
    }

    return value;
}

export {
    VOICE_UNKNOWN_DISTANCE_MILLIMETERS,
    VoiceProximityDecision,
    VoiceProximityDecisionNameByValue,
    VoiceSessionDescriptorLayout,
    VoiceSessionPayloadLimits,
    VoiceSessionReason,
    VoiceSessionReasonNameByValue,
    VoiceSessionSnapshotLayout,
    VoiceSessionState,
    VoiceSessionStateNameByValue,
    assertVoiceProximityDecision,
    assertVoiceSessionReason,
    assertVoiceSessionState
};
