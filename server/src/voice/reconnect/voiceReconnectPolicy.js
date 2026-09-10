// مسیر فایل: src/voice/reconnect/voiceReconnectPolicy.js

import {
    VoiceSessionReason,
    assertVoiceSessionReason
} from "../session/voiceSessionConstants.js";

import {
    VoiceCleanupAction,
    VoiceReconnectWindowState,
    assertVoiceReconnectWindowState
} from "./voiceReconnectConstants.js";

//* این ثابت قوانین زمانی و امنیتی بازیابی اتصال صوتی را نگه می‌دارد.
const VoiceReconnectPolicy = Object.freeze({
    firstRetryDelayMs: 0,
    clientDeadlineMs: 180000,
    serverRetentionMs: 210000,

    preserveVoiceConnectionIdOnResume: true,
    suspendSessionsWhileDisconnected: true,
    routeAudioWhileSuspended: false,
    acceptClientProvidedUserId: false,

    revalidationChecks: Object.freeze([
        "access_token_valid",
        "user_id_present_in_verified_token",
        "realtime_connection_ready",
        "room_joined_by_verified_user",
        "avatar_owned_by_verified_user",
        "dedicated_connection_authenticated",
        "voice_access_allowed",
        "authoritative_distance_allowed"
    ])
});

//* این تابع زمان ورودی را به عدد صحیح و نامنفی تبدیل می‌کند.
function normalizeVoiceReconnectTime(value, fieldName) {
    if (typeof value === "bigint") {
        if (value < 0n) {
            throw new RangeError(
                `${fieldName} must be non-negative.`
            );
        }

        return value;
    }

    if (
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new RangeError(
            `${fieldName} must be a non-negative safe integer or bigint.`
        );
    }

    return BigInt(value);
}

//* این تابع مشخص می‌کند بازیابی اتصال هنوز مجاز است یا مهلت آن پایان یافته است.
function evaluateVoiceReconnectWindow({
    disconnectedAtMs,
    nowMs = Date.now()
} = {}) {
    const disconnectedAt =
        normalizeVoiceReconnectTime(
            disconnectedAtMs,
            "disconnectedAtMs"
        );

    const now =
        normalizeVoiceReconnectTime(
            nowMs,
            "nowMs"
        );

    if (now < disconnectedAt) {
        throw new RangeError(
            "nowMs cannot be earlier than disconnectedAtMs."
        );
    }

    const elapsedMs = now - disconnectedAt;
    const clientDeadlineMs =
        BigInt(VoiceReconnectPolicy.clientDeadlineMs);
    const serverRetentionMs =
        BigInt(VoiceReconnectPolicy.serverRetentionMs);

    if (elapsedMs <= clientDeadlineMs) {
        return Object.freeze({
            state: VoiceReconnectWindowState.RETRY_ALLOWED,
            elapsedMs,
            automaticRetryAllowed: true,
            connectionRetainedByServer: true
        });
    }

    if (elapsedMs <= serverRetentionMs) {
        return Object.freeze({
            state:
                VoiceReconnectWindowState
                    .CLIENT_DEADLINE_EXPIRED,
            elapsedMs,
            automaticRetryAllowed: false,
            connectionRetainedByServer: true
        });
    }

    return Object.freeze({
        state:
            VoiceReconnectWindowState
                .SERVER_RETENTION_EXPIRED,
        elapsedMs,
        automaticRetryAllowed: false,
        connectionRetainedByServer: false
    });
}

//* این تابع فهرست بررسی‌های لازم پیش از ادامه اتصال صوتی را برمی‌گرداند.
function createVoiceReconnectRevalidationPlan() {
    return Object.freeze([
        ...VoiceReconnectPolicy.revalidationChecks
    ]);
}

//* این تابع بر اساس علت قطع و وضعیت زمانی، نوع پاک‌سازی موردنیاز را تعیین می‌کند.
function resolveVoiceCleanupAction({
    reason,
    reconnectWindowState =
        VoiceReconnectWindowState.RETRY_ALLOWED
} = {}) {
    assertVoiceSessionReason(reason);
    assertVoiceReconnectWindowState(
        reconnectWindowState
    );

    if (
        reason === VoiceSessionReason.NONE ||
        reason === VoiceSessionReason.PROXIMITY_ENTER
    ) {
        return VoiceCleanupAction.NONE;
    }

    if (
        reason === VoiceSessionReason.PROXIMITY_EXIT ||
        reason === VoiceSessionReason.SESSION_CLOSED
    ) {
        return VoiceCleanupAction.CLOSE_AFFECTED_SESSION;
    }

    if (
        reason === VoiceSessionReason.VOICE_DISCONNECTED
    ) {
        if (
            reconnectWindowState ===
            VoiceReconnectWindowState
                .SERVER_RETENTION_EXPIRED
        ) {
            return VoiceCleanupAction
                .CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION;
        }

        return VoiceCleanupAction.SUSPEND_AUDIO_ROUTING;
    }

    if (
        reason === VoiceSessionReason.ROOM_LEFT ||
        reason === VoiceSessionReason.AVATAR_DESPAWNED ||
        reason ===
            VoiceSessionReason.DEDICATED_DISCONNECTED ||
        reason === VoiceSessionReason.RECONNECT_EXPIRED ||
        reason === VoiceSessionReason.ACCESS_REVOKED
    ) {
        return VoiceCleanupAction
            .CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION;
    }

    return VoiceCleanupAction.NONE;
}

export {
    VoiceReconnectPolicy,
    createVoiceReconnectRevalidationPlan,
    evaluateVoiceReconnectWindow,
    normalizeVoiceReconnectTime,
    resolveVoiceCleanupAction
};

/*
توضیح فایل:
این فایل مهلت بازیابی اتصال، نگهداری موقت اتصال در سرور، بررسی‌های امنیتی لازم و نوع پاک‌سازی نشست‌های صوتی را تعیین می‌کند.
*/
