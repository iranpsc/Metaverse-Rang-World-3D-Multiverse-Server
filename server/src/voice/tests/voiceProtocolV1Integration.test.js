// مسیر فایل: src/voice/tests/voiceProtocolV1Integration.test.js

import assert from "node:assert/strict";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    decodeVoiceBinaryEnvelope,
    encodeVoiceBinaryEnvelope
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceMessageDirection,
    VoicePayloadKind,
    validateVoiceMessageContract
} from "../protocol/voiceMessageRules.js";

import {
    VoiceProtocolV1Manifest
} from "../protocol/voiceProtocolV1Manifest.js";

import {
    VoiceAuthResultCode,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    decodeVoiceAuthRequest,
    decodeVoiceAuthResult,
    encodeVoiceAuthRequest,
    encodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    createVoiceAuthenticatedSubject
} from "../auth/voiceAuthPolicy.js";

import {
    VoiceProximityDecision,
    VoiceSessionReason,
    VoiceSessionState
} from "../session/voiceSessionConstants.js";

import {
    createCanonicalVoiceParticipantPairKey,
    evaluateVoiceProximityCandidate
} from "../session/voiceSessionPolicy.js";

import {
    decodeVoiceSessionSnapshot,
    encodeVoiceSessionSnapshot
} from "../session/voiceSessionPayload.js";

import {
    VoiceCleanupAction,
    VoiceReconnectResultCode,
    VoiceReconnectWindowState
} from "../reconnect/voiceReconnectConstants.js";

import {
    evaluateVoiceReconnectWindow,
    resolveVoiceCleanupAction
} from "../reconnect/voiceReconnectPolicy.js";

import {
    decodeVoiceReconnectRequest,
    decodeVoiceReconnectResult,
    encodeVoiceReconnectRequest,
    encodeVoiceReconnectResult
} from "../reconnect/voiceReconnectPayload.js";

const userId =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const peerUserIdA =
    "80c686cf-d8ca-4c15-9f85-5f503a14f21a";

const peerUserIdB =
    "90c686cf-d8ca-4c15-9f85-5f503a14f21a";

const clientInstanceId =
    "123e4567-e89b-12d3-a456-426614174000";

const voiceConnectionId =
    "223e4567-e89b-12d3-a456-426614174000";

const sessionIdA =
    "323e4567-e89b-12d3-a456-426614174000";

const sessionIdB =
    "423e4567-e89b-12d3-a456-426614174000";

const roomId = "room_voice_test";
const avatarId = userId;
const accessToken = "header.payload.signature";
const baseTimeMs = 1785300000000n;

assert.equal(
    VoiceProtocolV1Manifest.version,
    1
);

assert.equal(
    VoiceProtocolV1Manifest.envelope.magicText,
    "MVVC"
);

assert.equal(
    VoiceProtocolV1Manifest.envelope.fixedHeaderBytes,
    60
);

assert.equal(
    VoiceProtocolV1Manifest.authentication.requestFixedBytes,
    26
);

assert.equal(
    VoiceProtocolV1Manifest.authentication.resultFixedBytes,
    24
);

assert.equal(
    VoiceProtocolV1Manifest.session.enterDistanceMeters,
    3
);

assert.equal(
    VoiceProtocolV1Manifest.session.exitDistanceMeters,
    3.5
);

assert.equal(
    VoiceProtocolV1Manifest.session.nonTransitiveAudibility,
    true
);

assert.equal(
    VoiceProtocolV1Manifest.reconnect.firstRetryDelayMs,
    0
);

assert.equal(
    VoiceProtocolV1Manifest.reconnect.clientDeadlineMs,
    180000
);

assert.equal(
    VoiceProtocolV1Manifest.reconnect.serverRetentionMs,
    210000
);

assert.equal(
    Object.isFrozen(VoiceProtocolV1Manifest),
    true
);

assert.equal(
    Object.isFrozen(
        VoiceProtocolV1Manifest.session
    ),
    true
);

const authenticationRequestPayload =
    encodeVoiceAuthRequest({
        platform: VoiceClientPlatform.WINDOWS,
        accessToken,
        roomId,
        avatarId,
        clientInstanceId,
        clientBuild: "unity-test"
    });

const authenticationRequestPacket =
    encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.AUTH_REQUEST,

        flags:
            VoiceMessageFlag.ACK_REQUIRED,

        sequence: 1,
        timestampMs: baseTimeMs,
        payload: authenticationRequestPayload
    });

const decodedAuthenticationEnvelope =
    decodeVoiceBinaryEnvelope(
        authenticationRequestPacket
    );

const authenticationRequestRule =
    validateVoiceMessageContract({
        messageType:
            decodedAuthenticationEnvelope.messageType,

        flags:
            decodedAuthenticationEnvelope.flags
    });

assert.equal(
    authenticationRequestRule.direction,
    VoiceMessageDirection.CLIENT_TO_SERVER
);

assert.equal(
    authenticationRequestRule.payloadKind,
    VoicePayloadKind.CONTROL_BINARY
);

const decodedAuthenticationRequest =
    decodeVoiceAuthRequest(
        decodedAuthenticationEnvelope.payload
    );

assert.equal(
    decodedAuthenticationRequest.platform,
    VoiceClientPlatform.WINDOWS
);

assert.equal(
    decodedAuthenticationRequest.accessToken,
    accessToken
);

assert.equal(
    decodedAuthenticationRequest.roomId,
    roomId
);

assert.equal(
    decodedAuthenticationRequest.avatarId,
    avatarId
);

const authenticatedSubject =
    createVoiceAuthenticatedSubject({
        verifiedTokenPayload: {
            sub: userId
        },

        request:
            decodedAuthenticationRequest
    });

assert.equal(
    authenticatedSubject.userId,
    userId
);

assert.equal(
    authenticatedSubject.roomId,
    roomId
);

assert.equal(
    authenticatedSubject.avatarId,
    avatarId
);

const authenticationResultPayload =
    encodeVoiceAuthResult({
        success: true,
        retryable: false,
        code:
            VoiceAuthResultCode.AUTHENTICATED,

        voiceConnectionId,
        userId,
        message: "authenticated"
    });

const authenticationResultPacket =
    encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.AUTH_RESULT,

        sequence: 2,
        timestampMs: baseTimeMs + 1n,
        senderId: userId,
        payload: authenticationResultPayload
    });

const decodedAuthenticationResultEnvelope =
    decodeVoiceBinaryEnvelope(
        authenticationResultPacket
    );

const decodedAuthenticationResult =
    decodeVoiceAuthResult(
        decodedAuthenticationResultEnvelope.payload
    );

assert.equal(
    decodedAuthenticationResult.success,
    true
);

assert.equal(
    decodedAuthenticationResult.voiceConnectionId,
    voiceConnectionId
);

assert.equal(
    decodedAuthenticationResult.userId,
    userId
);

const pairKeyAB =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_a",
        "connection_a",
        "user_b",
        "connection_b"
    );

const pairKeyBA =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_b",
        "connection_b",
        "user_a",
        "connection_a"
    );

const pairKeyBC =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_b",
        "connection_b",
        "user_c",
        "connection_c"
    );

assert.equal(pairKeyAB, pairKeyBA);
assert.notEqual(pairKeyAB, pairKeyBC);

const proximityAB =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: false,
        distanceMeters: 2.5
    });

const proximityBC =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: false,
        distanceMeters: 2.8
    });

const proximityAC =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: false,
        distanceMeters: 4.2
    });

assert.equal(
    proximityAB.decision,
    VoiceProximityDecision.ENTER_CANDIDATE
);

assert.equal(
    proximityBC.decision,
    VoiceProximityDecision.ENTER_CANDIDATE
);

assert.equal(
    proximityAC.decision,
    VoiceProximityDecision.KEEP_CURRENT_STATE
);

const sessionSnapshotPayload =
    encodeVoiceSessionSnapshot({
        sessions: [
            {
                sessionId: sessionIdA,
                state: VoiceSessionState.ACTIVE,
                reason:
                    VoiceSessionReason.PROXIMITY_ENTER,

                distanceMeters: 2.5,
                effectiveAtMs: baseTimeMs + 100n,
                peerUserId: peerUserIdA,
                peerAvatarId: "avatar_b"
            },
            {
                sessionId: sessionIdB,
                state: VoiceSessionState.ACTIVE,
                reason:
                    VoiceSessionReason.PROXIMITY_ENTER,

                distanceMeters: 2.8,
                effectiveAtMs: baseTimeMs + 200n,
                peerUserId: peerUserIdB,
                peerAvatarId: "avatar_c"
            }
        ]
    });

const sessionSnapshotPacket =
    encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.SESSION_SNAPSHOT,

        sequence: 3,
        timestampMs: baseTimeMs + 200n,
        senderId: userId,
        payload: sessionSnapshotPayload
    });

const decodedSessionSnapshotEnvelope =
    decodeVoiceBinaryEnvelope(
        sessionSnapshotPacket
    );

const sessionSnapshotRule =
    validateVoiceMessageContract({
        messageType:
            decodedSessionSnapshotEnvelope.messageType,

        flags:
            decodedSessionSnapshotEnvelope.flags
    });

assert.equal(
    sessionSnapshotRule.direction,
    VoiceMessageDirection.SERVER_TO_CLIENT
);

const decodedSessionSnapshot =
    decodeVoiceSessionSnapshot(
        decodedSessionSnapshotEnvelope.payload
    );

assert.equal(
    decodedSessionSnapshot.entryCount,
    2
);

assert.equal(
    decodedSessionSnapshot.sessions[0].sessionId,
    sessionIdA
);

assert.equal(
    decodedSessionSnapshot.sessions[1].sessionId,
    sessionIdB
);

const reconnectRequestPayload =
    encodeVoiceReconnectRequest({
        previousVoiceConnectionId:
            voiceConnectionId,

        clientInstanceId,
        lastReceivedSequence: 3,
        lastPublishedSequence: 10,
        disconnectedAtMs: baseTimeMs + 1000n,
        accessToken,
        roomId,
        avatarId
    });

const reconnectRequestPacket =
    encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.RECONNECT_REQUEST,

        flags:
            VoiceMessageFlag.ACK_REQUIRED,

        sequence: 11,
        timestampMs: baseTimeMs + 2000n,
        senderId: userId,
        payload: reconnectRequestPayload
    });

const decodedReconnectRequestEnvelope =
    decodeVoiceBinaryEnvelope(
        reconnectRequestPacket
    );

const decodedReconnectRequest =
    decodeVoiceReconnectRequest(
        decodedReconnectRequestEnvelope.payload
    );

assert.equal(
    decodedReconnectRequest.previousVoiceConnectionId,
    voiceConnectionId
);

assert.equal(
    decodedReconnectRequest.lastReceivedSequence,
    3
);

assert.equal(
    decodedReconnectRequest.lastPublishedSequence,
    10
);

const reconnectWindow =
    evaluateVoiceReconnectWindow({
        disconnectedAtMs:
            decodedReconnectRequest.disconnectedAtMs,

        nowMs: baseTimeMs + 6000n
    });

assert.equal(
    reconnectWindow.state,
    VoiceReconnectWindowState.RETRY_ALLOWED
);

assert.equal(
    reconnectWindow.automaticRetryAllowed,
    true
);

const reconnectResultPayload =
    encodeVoiceReconnectResult({
        success: true,
        retryable: false,
        code:
            VoiceReconnectResultCode.RESUMED,

        voiceConnectionId,
        resumeFromSequence: 4,
        serverTimeMs: baseTimeMs + 6000n,
        retainedSessionCount: 2,
        message: "resumed"
    });

const reconnectResultPacket =
    encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.RECONNECT_RESULT,

        sequence: 12,
        timestampMs: baseTimeMs + 6000n,
        senderId: userId,
        payload: reconnectResultPayload
    });

const decodedReconnectResultEnvelope =
    decodeVoiceBinaryEnvelope(
        reconnectResultPacket
    );

const decodedReconnectResult =
    decodeVoiceReconnectResult(
        decodedReconnectResultEnvelope.payload
    );

assert.equal(
    decodedReconnectResult.success,
    true
);

assert.equal(
    decodedReconnectResult.retainedSessionCount,
    2
);

assert.equal(
    decodedReconnectResult.resumeFromSequence,
    4
);

const temporaryDisconnectCleanup =
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.VOICE_DISCONNECTED,

        reconnectWindowState:
            VoiceReconnectWindowState.RETRY_ALLOWED
    });

assert.equal(
    temporaryDisconnectCleanup,
    VoiceCleanupAction.SUSPEND_AUDIO_ROUTING
);

const expiredDisconnectCleanup =
    resolveVoiceCleanupAction({
        reason:
            VoiceSessionReason.VOICE_DISCONNECTED,

        reconnectWindowState:
            VoiceReconnectWindowState
                .SERVER_RETENTION_EXPIRED
    });

assert.equal(
    expiredDisconnectCleanup,
    VoiceCleanupAction
        .CLOSE_ALL_SESSIONS_AND_REMOVE_CONNECTION
);

assert.equal(
    decodedReconnectResultEnvelope.version,
    VoiceBinaryProtocolConstants.version
);

console.log(
    "VOICE_V1_7_INTEGRATION_TEST=OK"
);

/*
توضیح فایل:
این فایل مسیر کامل ساخت و خواندن پیام احراز هویت، نشست‌های فاصله‌ای و بازیابی اتصال را روی پوشش دودویی مشترک بررسی می‌کند و ارتباط غیرانتقالی میان آواتارها را نیز می‌آزماید.
*/
