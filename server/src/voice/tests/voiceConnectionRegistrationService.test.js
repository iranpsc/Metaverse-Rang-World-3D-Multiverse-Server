// مسیر فایل: src/voice/tests/voiceConnectionRegistrationService.test.js

import assert from "node:assert/strict";

import {
    ClientsRegistry
} from "../../realTime/clientsRegistry.js";

import {
    RoomManager
} from "../../realTime/roomManager.js";

import {
    RealtimeContextState
} from "../../realTime/core/realtimeContext.js";

import {
    createGameSessionRegistry
} from "../../gameServerControl/sessions/gameSessionRegistry.js";

import {
    VoiceAuthResultCode,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    createVoiceRuntimeServices
} from "../bootstrap/createVoiceRuntimeServices.js";

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

const userId =
    "66a123456789abcdef123456";

const roomId =
    "room_voice_registration_test";

const dedicatedConnectionId =
    "65adc593c1b946778c79a0b1f16393ab";

const voiceConnectionId =
    "65adc593-c1b9-4677-8c79-a0b1f16393ab";

const clientInstanceId =
    "123e4567-e89b-42d3-a456-426614174000";

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

const realtimeRegistry =
    new ClientsRegistry();

const realtimeRooms =
    new RoomManager();

const realtimeConnection = {
    id:
        "rt_voice_registration_test",

    readyState: 1,

    context: {
        connectionId:
            "rt_voice_registration_test",

        state:
            RealtimeContextState
                .authenticated,

        transportKind:
            "websocket",

        roomId: "",

        user: {
            id: userId,
            userId
        }
    }
};

realtimeRegistry.addConnection(
    realtimeConnection,
    userId
);

realtimeRooms.join(
    roomId,
    realtimeConnection
);

const gameSessionRegistry =
    createGameSessionRegistry();

const gameSession =
    gameSessionRegistry.createSession({
        sessionId:
            "session_voice_registration_test",

        roomId,

        serverId:
            "server_voice_registration_test",

        status:
            "active",

        maxPlayers: 20
    });

const addPlayerResult =
    gameSessionRegistry.addPlayer(
        gameSession.sessionId,
        {
            userId,

            connectionId:
                dedicatedConnectionId,

            playerId:
                userId,

            userName:
                "Voice Registration Test",

            isReady: true,

            metadata: {
                verifiedAt:
                    1785300000000
            }
        }
    );

assert.equal(
    addPlayerResult.success,
    true
);

const voiceConnectionRegistry =
    new VoiceConnectionRegistry();

const runtimeServices =
    createVoiceRuntimeServices({
        realtimeRuntime: {
            registry:
                realtimeRegistry,

            rooms:
                realtimeRooms
        },

        gameServerControlRuntime: {
            sessionRegistry:
                gameSessionRegistry
        },

        accessTokenVerifier:
            new FakeAccessTokenVerifier(),

        voiceConnectionRegistry
    });

assert.equal(
    typeof runtimeServices
        .connectionRegistrationService
        .registerAndActivate,
    "function"
);

const registrationRequest = {
    accessToken:
        "valid.access.token",

    roomId,

    avatarId:
        userId,

    platform:
        VoiceClientPlatform.WEBGL,

    clientInstanceId,

    transportName:
        "websocket",

    transportConnectionKey:
        "voice_registration_transport",

    createdAtMs:
        1785300000000,

    activatedAtMs:
        1785300000100
};

const firstResult =
    runtimeServices
        .connectionRegistrationService
        .registerAndActivate(
            registrationRequest
        );

assert.equal(
    firstResult.success,
    true
);

assert.equal(
    firstResult.reused,
    false
);

assert.equal(
    firstResult.code,
    VoiceAuthResultCode
        .AUTHENTICATED
);

assert.equal(
    firstResult.connectionId,
    voiceConnectionId
);

assert.equal(
    firstResult.userId,
    userId
);

assert.equal(
    firstResult.roomId,
    roomId
);

assert.equal(
    firstResult.connection.state,
    VoiceConnectionState.ACTIVE
);

assert.equal(
    firstResult.connection.stateName,
    "ACTIVE"
);

assert.equal(
    voiceConnectionRegistry
        .getStats()
        .total,
    1
);

assert.equal(
    voiceConnectionRegistry
        .getStats()
        .active,
    1
);

assert.equal(
    voiceConnectionRegistry
        .getByConnectionId(
            voiceConnectionId
        )
        ?.userId,
    userId
);

const repeatedResult =
    runtimeServices
        .connectionRegistrationService
        .registerAndActivate(
            registrationRequest
        );

assert.equal(
    repeatedResult.success,
    true
);

assert.equal(
    repeatedResult.reused,
    true
);

assert.equal(
    repeatedResult.connectionId,
    voiceConnectionId
);

assert.equal(
    voiceConnectionRegistry
        .getStats()
        .total,
    1
);

const conflictResult =
    runtimeServices
        .connectionRegistrationService
        .registerAndActivate({
            ...registrationRequest,

            clientInstanceId:
                "223e4567-e89b-42d3-a456-426614174000"
        });

assert.equal(
    conflictResult.success,
    false
);

assert.equal(
    conflictResult.code,
    VoiceAuthResultCode
        .INVALID_PAYLOAD
);

assert.equal(
    voiceConnectionRegistry
        .getStats()
        .total,
    1
);

const directRegistry =
    new VoiceConnectionRegistry();

directRegistry
    .registerAuthenticatedConnection({
        connectionId:
            "75adc593-c1b9-4677-8c79-a0b1f16393ab",

        userId:
            "first-user",

        avatarId:
            "first-user",

        roomId:
            "first-room",

        platform:
            VoiceClientPlatform.WINDOWS,

        clientInstanceId:
            "323e4567-e89b-42d3-a456-426614174000",

        transportName:
            "grpc",

        transportConnectionKey:
            "first-grpc-stream"
    });

let duplicateConnectionIdError = null;

try {
    directRegistry
        .registerAuthenticatedConnection({
            connectionId:
                "75adc593-c1b9-4677-8c79-a0b1f16393ab",

            userId:
                "second-user",

            avatarId:
                "second-user",

            roomId:
                "second-room",

            platform:
                VoiceClientPlatform.QUEST,

            clientInstanceId:
                "423e4567-e89b-42d3-a456-426614174000",

            transportName:
                "grpc",

            transportConnectionKey:
                "second-grpc-stream"
        });
} catch (error) {
    duplicateConnectionIdError =
        error;
}

assert.match(
    duplicateConnectionIdError
        ?.message ??
        "",
    /already exists for this connection id/
);

assert.equal(
    directRegistry
        .getStats()
        .total,
    1
);

const invalidActivationResult =
    runtimeServices
        .connectionRegistrationService
        .registerAndActivate({
            ...registrationRequest,
            activatedAtMs: -1
        });

assert.equal(
    invalidActivationResult.success,
    false
);

assert.equal(
    invalidActivationResult.code,
    VoiceAuthResultCode
        .INVALID_PAYLOAD
);

console.log(
    "VOICE_V2_5_CONNECTION_REGISTRATION_TEST=OK"
);

/*
توضیح فایل:
این فایل ثبت و فعال شدن اتصال صوتی، استفاده از شناسه اتصال سرور اختصاصی، جلوگیری از ثبت تکراری و یکسان بودن نتیجه درخواست تکراری را بررسی می‌کند.
*/
