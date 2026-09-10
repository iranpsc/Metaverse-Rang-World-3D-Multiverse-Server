// مسیر فایل: src/voice/tests/voiceDedicatedConnectionIdentity.test.js

import assert from "node:assert/strict";

import {
    VoiceAuthResultCode,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionPreparationService,
    VoiceConnectionPreparationStage
} from "../core/voiceConnectionPreparationService.js";

import {
    VoiceConnectionRecord
} from "../core/voiceConnectionRecord.js";

const userId =
    "66a123456789abcdef123456";

const roomId =
    "room_voice_dedicated_identity";

const dedicatedConnectionId =
    "65adc593c1b946778c79a0b1f16393ab";

const expectedVoiceConnectionId =
    "65adc593-c1b9-4677-8c79-a0b1f16393ab";

class FakeAccessTokenVerifier {
    //* این تابع شناسه کاربر تأییدشده را برای آزمون برمی‌گرداند.
    verify() {
        return Object.freeze({
            success: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            userId,
            tokenPayload:
                Object.freeze({
                    sub: userId
                })
        });
    }
}

class FakeRealtimeMembershipAdapter {
    //* این تابع عضویت آزمایشی کاربر در روم را تأیید می‌کند.
    verify() {
        return Object.freeze({
            success: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            userId,
            roomId,
            realtimeConnectionId:
                "realtime_voice_identity",
            realtimeConnection:
                Object.freeze({
                    id:
                        "realtime_voice_identity"
                })
        });
    }
}

class FakeDedicatedPlayerAdapter {
    //* این تابع اطلاعات همان بازیکن داخل سرور اختصاصی را برمی‌گرداند.
    verify() {
        return Object.freeze({
            success: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            userId,
            roomId,
            sessionId:
                "session_voice_identity",
            serverId:
                "server_voice_identity",
            connectionId:
                dedicatedConnectionId,
            playerId:
                userId
        });
    }
}

const preparationService =
    new VoiceConnectionPreparationService({
        accessTokenVerifier:
            new FakeAccessTokenVerifier(),
        realtimeMembershipAdapter:
            new FakeRealtimeMembershipAdapter(),
        dedicatedPlayerAdapter:
            new FakeDedicatedPlayerAdapter()
    });

const preparedResult =
    preparationService.prepare({
        accessToken:
            "valid.access.token",
        roomId,
        avatarId:
            userId,
        platform:
            VoiceClientPlatform.WEBGL,
        clientInstanceId:
            "123e4567-e89b-12d3-a456-426614174000",
        transportName:
            "websocket",
        transportConnectionKey:
            "voice_transport_identity",
        createdAtMs:
            1785300000000
    });

assert.equal(
    preparedResult.ready,
    true
);

assert.equal(
    preparedResult.stage,
    VoiceConnectionPreparationStage
        .READY_FOR_REGISTRATION
);

assert.equal(
    preparedResult.dedicatedConnectionId,
    dedicatedConnectionId
);

assert.equal(
    preparedResult
        .registrationInput
        .connectionId,
    expectedVoiceConnectionId
);

const connectionRecord =
    new VoiceConnectionRecord({
        ...preparedResult.registrationInput
    });

assert.equal(
    connectionRecord.connectionId,
    expectedVoiceConnectionId
);

assert.equal(
    connectionRecord.userId,
    userId
);

assert.notEqual(
    connectionRecord.connectionId,
    connectionRecord.clientInstanceId
);

const recordConnectionHex =
    connectionRecord
        .connectionId
        .replaceAll("-", "");

assert.equal(
    recordConnectionHex,
    dedicatedConnectionId
);

const mismatchedLegacyAvatarResult =
    preparationService.prepare({
        accessToken:
            "valid.access.token",
        roomId,
        avatarId:
            "different-avatar-id",
        platform:
            VoiceClientPlatform.WEBGL,
        clientInstanceId:
            "223e4567-e89b-12d3-a456-426614174000",
        transportName:
            "websocket",
        transportConnectionKey:
            "voice_transport_identity_mismatch",
        createdAtMs:
            1785300000000
    });

assert.equal(
    mismatchedLegacyAvatarResult.ready,
    false
);

assert.equal(
    mismatchedLegacyAvatarResult.stage,
    VoiceConnectionPreparationStage
        .REQUEST_FIELDS
);

console.log(
    "VOICE_V2_4_5_DEDICATED_CONNECTION_ID_TEST=OK"
);

/*
توضیح فایل:
این فایل بررسی می‌کند که شناسه اتصال صوتی از همان شناسه اتصال بازیکن داخل سرور اختصاصی گرفته شود و هیچ شناسه تصادفی تازه‌ای ساخته نشود.
*/
