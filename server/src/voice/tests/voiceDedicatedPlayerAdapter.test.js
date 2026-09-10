// مسیر فایل: src/voice/tests/voiceDedicatedPlayerAdapter.test.js

import assert from "node:assert/strict";

import {
    createGameSessionRegistry
} from "../../gameServerControl/sessions/gameSessionRegistry.js";

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

import {
    VoiceDedicatedPlayerAdapter
} from "../adapters/voiceDedicatedPlayerAdapter.js";

const userId =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const roomId =
    "room_voice_dedicated_test";

const serverId =
    "server_voice_dedicated_test";

const sessionRegistry =
    createGameSessionRegistry();

const session =
    sessionRegistry.createSession({
        sessionId:
            "session_voice_dedicated_test",
        roomId,
        serverId,
        status: "active",
        maxPlayers: 20
    });

const addPlayerResult =
    sessionRegistry.addPlayer(
        session.sessionId,
        {
            userId,
            connectionId:
                "dedicated_connection_test",
            playerId:
                "dedicated_player_test",
            userName:
                "Voice Dedicated Test",
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

const adapter =
    new VoiceDedicatedPlayerAdapter({
        sessionRegistry
    });

const validResult =
    adapter.verify({
        userId,
        roomId
    });

assert.equal(
    validResult.success,
    true
);

assert.equal(
    validResult.retryable,
    false
);

assert.equal(
    validResult.code,
    VoiceAuthResultCode.AUTHENTICATED
);

assert.equal(
    validResult.userId,
    userId
);

assert.equal(
    validResult.roomId,
    roomId
);

assert.equal(
    validResult.sessionId,
    session.sessionId
);

assert.equal(
    validResult.serverId,
    serverId
);

assert.equal(
    validResult.connectionId,
    "dedicated_connection_test"
);

assert.equal(
    validResult.playerId,
    "dedicated_player_test"
);

assert.equal(
    Object.isFrozen(validResult),
    true
);

const wrongUserResult =
    adapter.verify({
        userId:
            "80c686cf-d8ca-4c15-9f85-5f503a14f21a",
        roomId
    });

assert.equal(
    wrongUserResult.success,
    false
);

assert.equal(
    wrongUserResult.code,
    VoiceAuthResultCode
        .DEDICATED_NOT_AUTHENTICATED
);

const wrongRoomResult =
    adapter.verify({
        userId,
        roomId:
            "room_voice_not_found"
    });

assert.equal(
    wrongRoomResult.success,
    false
);

assert.equal(
    wrongRoomResult.code,
    VoiceAuthResultCode
        .DEDICATED_NOT_AUTHENTICATED
);

const notReadyRegistry =
    createGameSessionRegistry();

const notReadySession =
    notReadyRegistry.createSession({
        sessionId:
            "session_voice_not_ready",
        roomId:
            "room_voice_not_ready",
        serverId:
            "server_voice_not_ready",
        status: "active",
        maxPlayers: 20
    });

notReadyRegistry.addPlayer(
    notReadySession.sessionId,
    {
        userId,
        connectionId:
            "dedicated_connection_not_ready",
        playerId:
            "dedicated_player_not_ready",
        userName:
            "Voice Not Ready",
        isReady: false
    }
);

const notReadyAdapter =
    new VoiceDedicatedPlayerAdapter({
        sessionRegistry:
            notReadyRegistry
    });

const notReadyResult =
    notReadyAdapter.verify({
        userId,
        roomId:
            "room_voice_not_ready"
    });

assert.equal(
    notReadyResult.success,
    false
);

assert.equal(
    notReadyResult.code,
    VoiceAuthResultCode
        .DEDICATED_NOT_AUTHENTICATED
);

sessionRegistry.closeSession(
    session.sessionId,
    "voice_test_closed"
);

const closedSessionResult =
    adapter.verify({
        userId,
        roomId
    });

assert.equal(
    closedSessionResult.success,
    false
);

assert.equal(
    closedSessionResult.code,
    VoiceAuthResultCode
        .DEDICATED_NOT_AUTHENTICATED
);

const invalidPayloadResult =
    adapter.verify({
        userId: "",
        roomId
    });

assert.equal(
    invalidPayloadResult.success,
    false
);

assert.equal(
    invalidPayloadResult.retryable,
    false
);

assert.equal(
    invalidPayloadResult.code,
    VoiceAuthResultCode
        .INVALID_PAYLOAD
);

let invalidRegistryError = null;

try {
    new VoiceDedicatedPlayerAdapter({
        sessionRegistry: {}
    });
} catch (error) {
    invalidRegistryError = error;
}

assert.match(
    invalidRegistryError?.message ?? "",
    /does not provide the required interface/
);

console.log(
    "VOICE_V2_4_1_DEDICATED_PLAYER_ADAPTER_TEST=OK"
);

/*
توضیح فایل:
این فایل پیدا شدن کاربر در نشست همان روم، نبودن کاربر، اشتباه بودن روم، آماده نبودن کاربر و بسته بودن نشست سرور اختصاصی را بررسی می‌کند.
*/
