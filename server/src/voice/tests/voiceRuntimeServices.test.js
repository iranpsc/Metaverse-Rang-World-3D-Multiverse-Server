// مسیر فایل: src/voice/tests/voiceRuntimeServices.test.js

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
    VoiceConnectionPreparationStage
} from "../core/voiceConnectionPreparationService.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

const userId =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const roomId =
    "room_voice_runtime_test";

const avatarId =
    userId;

const clientInstanceId =
    "123e4567-e89b-12d3-a456-426614174000";

class FakeAccessTokenVerifier {
    //* این سازنده نوع نتیجه آزمایشی بررسی توکن را نگهداری می‌کند.
    constructor(mode = "valid") {
        this.mode = mode;
    }

    //* این تابع نتیجه معتبر یا نامعتبر بررسی توکن را برای آزمون برمی‌گرداند.
    verify() {
        if (this.mode === "valid") {
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

        return Object.freeze({
            success: false,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .ACCESS_TOKEN_INVALID,
            userId: "",
            tokenPayload: null
        });
    }
}

const realtimeRegistry =
    new ClientsRegistry();

const realtimeRooms =
    new RoomManager();

const realtimeConnection = {
    id: "rt_voice_runtime_test",
    readyState: 1,
    context: {
        connectionId:
            "rt_voice_runtime_test",
        state:
            RealtimeContextState
                .authenticated,
        transportKind: "websocket",
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
            "session_voice_runtime_test",
        roomId,
        serverId:
            "server_voice_runtime_test",
        status: "active",
        maxPlayers: 20
    });

const addPlayerResult =
    gameSessionRegistry.addPlayer(
        gameSession.sessionId,
        {
            userId,
            connectionId:
                "65adc593c1b946778c79a0b1f16393ab",
            playerId:
                "dedicated_player_runtime_test",
            userName:
                "Voice Runtime Test",
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
            new FakeAccessTokenVerifier(
                "valid"
            ),
        voiceConnectionRegistry
    });

assert.equal(
    runtimeServices.realtimeRegistry,
    realtimeRegistry
);

assert.equal(
    runtimeServices.realtimeRooms,
    realtimeRooms
);

assert.equal(
    runtimeServices.gameSessionRegistry,
    gameSessionRegistry
);

assert.equal(
    runtimeServices.voiceConnectionRegistry,
    voiceConnectionRegistry
);

assert.equal(
    Object.isFrozen(runtimeServices),
    true
);

const preparedResult =
    runtimeServices
        .connectionPreparationService
        .prepare({
            accessToken:
                "valid.access.token",
            roomId,
            avatarId,
            platform:
                VoiceClientPlatform.WEBGL,
            clientInstanceId,
            transportName:
                "websocket",
            transportConnectionKey:
                "voice_websocket_test",
            createdAtMs:
                1785300000000
        });

assert.equal(
    preparedResult.ready,
    true
);

assert.equal(
    preparedResult.retryable,
    false
);

assert.equal(
    preparedResult.code,
    VoiceAuthResultCode.AUTHENTICATED
);

assert.equal(
    preparedResult.stage,
    VoiceConnectionPreparationStage
        .READY_FOR_REGISTRATION
);

assert.equal(
    preparedResult.userId,
    userId
);

assert.equal(
    preparedResult.roomId,
    roomId
);

assert.equal(
    preparedResult.realtimeConnectionId,
    "rt_voice_runtime_test"
);

assert.equal(
    preparedResult.dedicatedSessionId,
    gameSession.sessionId
);

assert.equal(
    preparedResult.dedicatedServerId,
    "server_voice_runtime_test"
);

assert.equal(
    preparedResult.dedicatedConnectionId,
    "65adc593c1b946778c79a0b1f16393ab"
);

assert.equal(
    preparedResult.dedicatedPlayerId,
    "dedicated_player_runtime_test"
);

assert.equal(
    preparedResult.registrationInput.connectionId,
    "65adc593-c1b9-4677-8c79-a0b1f16393ab"
);

assert.equal(
    preparedResult.registrationInput.userId,
    userId
);

assert.equal(
    preparedResult.registrationInput.avatarId,
    avatarId
);

assert.equal(
    Object.isFrozen(
        preparedResult.registrationInput
    ),
    true
);

assert.equal(
    voiceConnectionRegistry
        .getStats()
        .total,
    0
);

const missingDedicatedRegistry =
    createGameSessionRegistry();

const missingDedicatedRuntime =
    createVoiceRuntimeServices({
        realtimeRuntime: {
            registry:
                realtimeRegistry,
            rooms:
                realtimeRooms
        },
        gameServerControlRuntime: {
            sessionRegistry:
                missingDedicatedRegistry
        },
        accessTokenVerifier:
            new FakeAccessTokenVerifier(
                "valid"
            )
    });

const missingDedicatedResult =
    missingDedicatedRuntime
        .connectionPreparationService
        .prepare({
            accessToken:
                "valid.access.token",
            roomId,
            avatarId,
            platform:
                VoiceClientPlatform.WEBGL,
            clientInstanceId,
            transportName:
                "websocket",
            transportConnectionKey:
                "voice_websocket_test"
        });

assert.equal(
    missingDedicatedResult.ready,
    false
);

assert.equal(
    missingDedicatedResult.code,
    VoiceAuthResultCode
        .DEDICATED_NOT_AUTHENTICATED
);

assert.equal(
    missingDedicatedResult.stage,
    VoiceConnectionPreparationStage
        .DEDICATED_PLAYER
);

const invalidTokenRuntime =
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
            new FakeAccessTokenVerifier(
                "invalid"
            )
    });

const invalidTokenResult =
    invalidTokenRuntime
        .connectionPreparationService
        .prepare({
            accessToken:
                "invalid.access.token",
            roomId,
            avatarId,
            platform:
                VoiceClientPlatform.WEBGL,
            clientInstanceId,
            transportName:
                "websocket",
            transportConnectionKey:
                "voice_websocket_test"
        });

assert.equal(
    invalidTokenResult.ready,
    false
);

assert.equal(
    invalidTokenResult.stage,
    VoiceConnectionPreparationStage
        .ACCESS_TOKEN
);

let missingGameRuntimeError = null;

try {
    createVoiceRuntimeServices({
        realtimeRuntime: {
            registry:
                realtimeRegistry,
            rooms:
                realtimeRooms
        },
        gameServerControlRuntime: {},
        accessTokenVerifier:
            new FakeAccessTokenVerifier()
    });
} catch (error) {
    missingGameRuntimeError = error;
}

assert.match(
    missingGameRuntimeError?.message ?? "",
    /sessionRegistry is required/
);

console.log(
    "VOICE_V2_4_2_RUNTIME_SERVICES_TEST=OK"
);

/*
توضیح فایل:
این فایل بررسی می‌کند که توکن، روم ریل‌تایم و حضور همان کاربر در سرور اختصاصی به‌ترتیب بررسی شوند و فقط پس از موفقیت همه آن‌ها اطلاعات اتصال صوتی آماده شود.
*/
