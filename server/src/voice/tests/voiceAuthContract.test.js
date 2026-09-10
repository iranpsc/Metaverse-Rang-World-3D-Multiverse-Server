// File: src/voice/tests/voiceAuthContract.test.js

import assert from "node:assert/strict";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    validateVoiceMessageContract
} from "../protocol/voiceMessageRules.js";

import {
    VoiceAuthPayloadLimits,
    VoiceAuthRequestLayout,
    VoiceAuthResultCode,
    VoiceAuthResultLayout,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    decodeVoiceAuthRequest,
    decodeVoiceAuthResult,
    encodeVoiceAuthRequest,
    encodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    VoiceAuthVerificationPolicy,
    createVoiceAuthenticatedSubject
} from "../auth/voiceAuthPolicy.js";

const accessToken = "header.payload.signature";
const roomId = "room_4d40288e-4318-4043-ae94-e1a65a03e6d5";
const clientInstanceId = "123e4567-e89b-12d3-a456-426614174000";
const voiceConnectionId = "2a123456-e89b-12d3-a456-426614174111";
const userId = "507f1f77bcf86cd799439011";
const avatarId = userId;

const authRequestPayload = encodeVoiceAuthRequest({
    platform: VoiceClientPlatform.WINDOWS,
    accessToken,
    roomId,
    avatarId,
    clientInstanceId,
    clientBuild: "unity-6000.2.6f2"
});

assert.equal(
    authRequestPayload.length >= VoiceAuthRequestLayout.fixedBytes,
    true
);

const decodedRequest = decodeVoiceAuthRequest(authRequestPayload);

assert.equal(decodedRequest.platform, VoiceClientPlatform.WINDOWS);
assert.equal(decodedRequest.accessToken, accessToken);
assert.equal(decodedRequest.roomId, roomId);
assert.equal(decodedRequest.avatarId, avatarId);
assert.equal(decodedRequest.clientInstanceId, clientInstanceId);
assert.equal(decodedRequest.clientBuild, "unity-6000.2.6f2");

const authenticatedSubject = createVoiceAuthenticatedSubject({
    verifiedTokenPayload: {
        sub: userId,
        email: "voice-test@example.test"
    },
    request: decodedRequest
});

assert.equal(authenticatedSubject.userId, userId);
assert.equal(authenticatedSubject.roomId, roomId);
assert.equal(authenticatedSubject.avatarId, avatarId);
assert.equal(authenticatedSubject.platform, VoiceClientPlatform.WINDOWS);
assert.equal(Object.isFrozen(authenticatedSubject), true);

assert.throws(
    () => createVoiceAuthenticatedSubject({
        verifiedTokenPayload: {
            sub: userId
        },
        request: {
            ...decodedRequest,
            avatarId: "different-avatar-id"
        }
    }),
    /avatarId must equal the verified userId/
);

assert.equal(
    VoiceAuthVerificationPolicy.accessTokenVerifier,
    "tokenService.verifyAccessToken"
);

assert.equal(
    VoiceAuthVerificationPolicy.acceptClientProvidedUserId,
    false
);

assert.equal(
    VoiceAuthVerificationPolicy.requiredChecks.includes(
        "dedicated_connection_authenticated"
    ),
    true
);

const successPayload = encodeVoiceAuthResult({
    success: true,
    retryable: false,
    code: VoiceAuthResultCode.AUTHENTICATED,
    voiceConnectionId,
    userId,
    message: "authenticated"
});

assert.equal(
    successPayload.length,
    VoiceAuthResultLayout.fixedBytes +
    Buffer.byteLength(userId, "utf8") +
    Buffer.byteLength("authenticated", "utf8")
);

assert.equal(
    successPayload.readUInt16BE(
        VoiceAuthResultLayout.offsets.userIdLength
    ),
    Buffer.byteLength(userId, "utf8")
);

const decodedSuccess = decodeVoiceAuthResult(successPayload);

assert.equal(decodedSuccess.success, true);
assert.equal(decodedSuccess.retryable, false);
assert.equal(decodedSuccess.code, VoiceAuthResultCode.AUTHENTICATED);
assert.equal(decodedSuccess.voiceConnectionId, voiceConnectionId);
assert.equal(decodedSuccess.userId, userId);
assert.equal(decodedSuccess.message, "authenticated");

const failurePayload = encodeVoiceAuthResult({
    success: false,
    retryable: true,
    code: VoiceAuthResultCode.REALTIME_NOT_READY,
    message: "realtime_not_ready"
});

const decodedFailure = decodeVoiceAuthResult(failurePayload);

assert.equal(decodedFailure.success, false);
assert.equal(decodedFailure.retryable, true);
assert.equal(
    decodedFailure.code,
    VoiceAuthResultCode.REALTIME_NOT_READY
);
assert.equal(decodedFailure.userId, "");
assert.equal(decodedFailure.message, "realtime_not_ready");

validateVoiceMessageContract({
    messageType: VoiceMessageType.AUTH_REQUEST,
    flags: VoiceMessageFlag.ACK_REQUIRED
});

validateVoiceMessageContract({
    messageType: VoiceMessageType.AUTH_RESULT,
    flags: VoiceMessageFlag.NONE
});

assert.throws(
    () => encodeVoiceAuthRequest({
        platform: 99,
        accessToken,
        roomId,
        avatarId,
        clientInstanceId
    }),
    /Unknown Voice client platform/
);

assert.throws(
    () => encodeVoiceAuthRequest({
        platform: VoiceClientPlatform.WEBGL,
        accessToken: "",
        roomId,
        avatarId,
        clientInstanceId
    }),
    /accessToken is required/
);

assert.throws(
    () => encodeVoiceAuthRequest({
        platform: VoiceClientPlatform.WEBGL,
        accessToken: "x".repeat(
            VoiceAuthPayloadLimits.accessTokenBytes + 1
        ),
        roomId,
        avatarId,
        clientInstanceId
    }),
    /accessToken exceeds/
);

assert.throws(
    () => decodeVoiceAuthRequest(
        authRequestPayload.subarray(
            0,
            authRequestPayload.length - 1
        )
    ),
    /length mismatch/
);

assert.throws(
    () => createVoiceAuthenticatedSubject({
        verifiedTokenPayload: {},
        request: decodedRequest
    }),
    /does not contain a user identifier/
);

assert.throws(
    () => encodeVoiceAuthResult({
        success: true,
        retryable: false,
        code: VoiceAuthResultCode.ACCESS_TOKEN_INVALID,
        voiceConnectionId,
        userId
    }),
    /must use the AUTHENTICATED result code/
);

assert.throws(
    () => encodeVoiceAuthResult({
        success: true,
        retryable: false,
        code: VoiceAuthResultCode.AUTHENTICATED
    }),
    /requires a connection identifier/
);

assert.throws(
    () => encodeVoiceAuthResult({
        success: true,
        retryable: false,
        code: VoiceAuthResultCode.AUTHENTICATED,
        voiceConnectionId,
        userId: ""
    }),
    /userId is required/
);

assert.throws(
    () => encodeVoiceAuthResult({
        success: true,
        retryable: false,
        code: VoiceAuthResultCode.AUTHENTICATED,
        voiceConnectionId,
        userId: "x".repeat(
            VoiceAuthPayloadLimits.resultUserIdBytes + 1
        )
    }),
    /userId exceeds/
);

console.log("VOICE_V1_4_AUTH_CONTRACT_TEST=OK");
