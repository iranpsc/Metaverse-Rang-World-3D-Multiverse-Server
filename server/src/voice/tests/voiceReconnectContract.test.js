// مسیر فایل: src/voice/tests/voiceReconnectContract.test.js

import assert from "node:assert/strict";

import {
    VoiceMessageDirection,
    VoicePayloadKind,
    getVoiceMessageRule
} from "../protocol/voiceMessageRules.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceSessionReason
} from "../session/voiceSessionConstants.js";

import {
    VoiceCleanupAction,
    VoiceReconnectRequestLayout,
    VoiceReconnectResultCode,
    VoiceReconnectResultLayout,
    VoiceReconnectWindowState
} from "../reconnect/voiceReconnectConstants.js";

import {
    VoiceReconnectPolicy,
    createVoiceReconnectRevalidationPlan,
    evaluateVoiceReconnectWindow,
    resolveVoiceCleanupAction
} from "../reconnect/voiceReconnectPolicy.js";

import {
    decodeVoiceReconnectRequest,
    decodeVoiceReconnectResult,
    encodeVoiceReconnectRequest,
    encodeVoiceReconnectResult
} from "../reconnect/voiceReconnectPayload.js";

const previousVoiceConnectionId =
    "123e4567-e89b-12d3-a456-426614174000";

const clientInstanceId =
    "223e4567-e89b-12d3-a456-426614174000";

const accessToken =
    "header.payload.signature";

const disconnectedAtMs =
    1785300000000n;

assert.equal(
    VoiceReconnectPolicy.firstRetryDelayMs,
    0
);

assert.equal(
    VoiceReconnectPolicy.clientDeadlineMs,
    180000
);

assert.equal(
    VoiceReconnectPolicy.serverRetentionMs,
    210000
);

assert.equal(
    VoiceReconnectPolicy.preserveVoiceConnectionIdOnResume,
    true
);

assert.equal(
    VoiceReconnectPolicy.routeAudioWhileSuspended,
    false
);

const allowedWindow =
    evaluateVoiceReconnectWindow({
        disconnectedAtMs,
        nowMs: disconnectedAtMs + 180000n
    });

assert.equal(
    allowedWindow.state,
    VoiceReconnectWindowState.RETRY_ALLOWED
);

assert.equal(
    allowedWindow.automaticRetryAllowed,
    true
);

assert.equal(
    allowedWindow.connectionRetainedByServer,
    true
);

const clientExpiredWindow =
    evaluateVoiceReconnectWindow({
        disconnectedAtMs,
        nowMs: disconnectedAtMs + 180001n
    });

assert.equal(
    clientExpiredWindow.state,
    VoiceReconnectWindowState.CLIENT_DEADLINE_EXPIRED
);

assert.equal(
    clientExpiredWindow.automaticRetryAllowed,
    false
);

assert.equal(
    clientExpiredWindow.connectionRetainedByServer,
    true
);

const serverExpiredWindow =
    evaluateVoiceReconnectWindow({
        disconnectedAtMs,
        nowMs: disconnectedAtMs + 210001n
    });

assert.equal(
    serverExpiredWindow.state,
    VoiceReconnectWindowState.SERVER_RETENTION_EXPIRED
);

assert.equal(
    serverExpiredWindow.connectionRetainedByServer,
    false
);

const revalidationPlan =
    createVoiceReconnectRevalidationPlan();

assert.equal(
    revalidationPlan.includes(
        "access_token_valid"
    ),
    true
);

assert.equal(
    revalidationPlan.includes(
        "dedicated_connection_authenticated"
    ),
    true
);

assert.equal(
    revalidationPlan.includes(
        "authoritative_distance_allowed"
    ),
    true
);

assert.equal(
    Object.isFrozen(revalidationPlan),
    true
);

assert.equal(
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.VOICE_DISCONNECTED,
        reconnectWindowState:
            VoiceReconnectWindowState.RETRY_ALLOWED
    }),
    VoiceCleanupAction.SUSPEND_AUDIO_ROUTING
);

assert.equal(
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.VOICE_DISCONNECTED,
        reconnectWindowState:
            VoiceReconnectWindowState
                .SERVER_RETENTION_EXPIRED
    }),
    VoiceCleanupAction
        .CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION
);

assert.equal(
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.PROXIMITY_EXIT
    }),
    VoiceCleanupAction.CLOSE_AFFECTED_SESSION
);

assert.equal(
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.ROOM_LEFT
    }),
    VoiceCleanupAction
        .CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION
);

assert.equal(
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.DEDICATED_DISCONNECTED
    }),
    VoiceCleanupAction
        .CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION
);

const requestPayload =
    encodeVoiceReconnectRequest({
        previousVoiceConnectionId,
        clientInstanceId,
        lastReceivedSequence: 120,
        lastPublishedSequence: 150,
        disconnectedAtMs,
        accessToken,
        roomId: "room_test_001",
        avatarId: "avatar_test_001"
    });

assert.equal(
    requestPayload.length >=
        VoiceReconnectRequestLayout.fixedBytes,
    true
);

const decodedRequest =
    decodeVoiceReconnectRequest(
        requestPayload
    );

assert.equal(
    decodedRequest.previousVoiceConnectionId,
    previousVoiceConnectionId
);

assert.equal(
    decodedRequest.clientInstanceId,
    clientInstanceId
);

assert.equal(
    decodedRequest.lastReceivedSequence,
    120
);

assert.equal(
    decodedRequest.lastPublishedSequence,
    150
);

assert.equal(
    decodedRequest.disconnectedAtMs,
    disconnectedAtMs
);

assert.equal(
    decodedRequest.accessToken,
    accessToken
);

assert.equal(
    decodedRequest.roomId,
    "room_test_001"
);

assert.equal(
    decodedRequest.avatarId,
    "avatar_test_001"
);

const successPayload =
    encodeVoiceReconnectResult({
        success: true,
        retryable: false,
        code: VoiceReconnectResultCode.RESUMED,
        voiceConnectionId:
            previousVoiceConnectionId,
        resumeFromSequence: 121,
        serverTimeMs:
            disconnectedAtMs + 5000n,
        retainedSessionCount: 2,
        message: "resumed"
    });

assert.equal(
    successPayload.length >=
        VoiceReconnectResultLayout.fixedBytes,
    true
);

const decodedSuccess =
    decodeVoiceReconnectResult(
        successPayload
    );

assert.equal(decodedSuccess.success, true);
assert.equal(decodedSuccess.retryable, false);

assert.equal(
    decodedSuccess.code,
    VoiceReconnectResultCode.RESUMED
);

assert.equal(
    decodedSuccess.voiceConnectionId,
    previousVoiceConnectionId
);

assert.equal(
    decodedSuccess.resumeFromSequence,
    121
);

assert.equal(
    decodedSuccess.retainedSessionCount,
    2
);

assert.equal(
    decodedSuccess.message,
    "resumed"
);

const failurePayload =
    encodeVoiceReconnectResult({
        success: false,
        retryable: false,
        code:
            VoiceReconnectResultCode
                .CLIENT_DEADLINE_EXPIRED,
        serverTimeMs:
            disconnectedAtMs + 181000n,
        message: "client_deadline_expired"
    });

const decodedFailure =
    decodeVoiceReconnectResult(
        failurePayload
    );

assert.equal(decodedFailure.success, false);
assert.equal(decodedFailure.retryable, false);

assert.equal(
    decodedFailure.code,
    VoiceReconnectResultCode
        .CLIENT_DEADLINE_EXPIRED
);

const reconnectRequestRule =
    getVoiceMessageRule(
        VoiceMessageType.RECONNECT_REQUEST
    );

assert.equal(
    reconnectRequestRule.direction,
    VoiceMessageDirection.CLIENT_TO_SERVER
);

assert.equal(
    reconnectRequestRule.payloadKind,
    VoicePayloadKind.CONTROL_BINARY
);

const reconnectResultRule =
    getVoiceMessageRule(
        VoiceMessageType.RECONNECT_RESULT
    );

assert.equal(
    reconnectResultRule.direction,
    VoiceMessageDirection.SERVER_TO_CLIENT
);

assert.throws(
    () => evaluateVoiceReconnectWindow({
        disconnectedAtMs: 1000,
        nowMs: 999
    }),
    /cannot be earlier/
);

assert.throws(
    () => decodeVoiceReconnectRequest(
        requestPayload.subarray(
            0,
            requestPayload.length - 1
        )
    ),
    /length mismatch/
);

assert.throws(
    () => encodeVoiceReconnectResult({
        success: true,
        retryable: false,
        code:
            VoiceReconnectResultCode
                .CONNECTION_NOT_FOUND,
        voiceConnectionId:
            previousVoiceConnectionId
    }),
    /must use the RESUMED/
);

assert.throws(
    () => encodeVoiceReconnectResult({
        success: true,
        retryable: false,
        code:
            VoiceReconnectResultCode.RESUMED
    }),
    /requires a connection identifier/
);

console.log(
    "VOICE_V1_6_RECONNECT_CONTRACT_TEST=OK"
);

/*
توضیح فایل:
این فایل درستی مهلت‌های بازیابی، تعلیق صدا، پاک‌سازی نشست‌ها و تبدیل رفت‌وبرگشتی پیام‌های بازیابی اتصال را بررسی می‌کند.
*/
