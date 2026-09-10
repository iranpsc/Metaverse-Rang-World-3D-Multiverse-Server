// مسیر فایل: src/voice/tests/voiceConnectionRegistry.test.js

import assert from "node:assert/strict";

import {
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionCloseReason,
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

const registry =
    new VoiceConnectionRegistry();

const userId =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const firstClientInstanceId =
    "123e4567-e89b-12d3-a456-426614174000";

const secondClientInstanceId =
    "223e4567-e89b-12d3-a456-426614174000";

const connection =
    registry.registerAuthenticatedConnection({
        userId,
        avatarId: userId,
        roomId: "room_voice_001",
        platform: VoiceClientPlatform.WINDOWS,
        clientInstanceId:
            firstClientInstanceId,
        transportName: "grpc",
        transportConnectionKey:
            "grpc_stream_001",
        createdAtMs: 1785300000000
    });

assert.equal(
    connection.state,
    VoiceConnectionState.AUTHENTICATED
);

assert.equal(
    connection.userId,
    userId
);

assert.equal(
    connection.avatarId,
    userId
);

assert.equal(
    registry.getByConnectionId(
        connection.connectionId
    ),
    connection
);

assert.equal(
    registry.getByClientInstanceId(
        firstClientInstanceId
    ),
    connection
);

assert.equal(
    registry.getByUserAndAvatar(
        userId,
        userId
    ),
    connection
);

connection.activate(
    1785300000100
);

assert.equal(
    connection.state,
    VoiceConnectionState.ACTIVE
);

connection.updateSequences({
    lastReceivedSequence: 20,
    lastPublishedSequence: 25
});

assert.equal(
    connection.lastReceivedSequence,
    20
);

assert.equal(
    connection.lastPublishedSequence,
    25
);

connection.suspend(
    1785300000200
);

assert.equal(
    connection.state,
    VoiceConnectionState.SUSPENDED
);

assert.equal(
    connection.disconnectedAtMs,
    1785300000200
);

connection.resume({
    transportName: "grpc",
    transportConnectionKey:
        "grpc_stream_002",
    resumedAtMs: 1785300000300
});

assert.equal(
    connection.state,
    VoiceConnectionState.ACTIVE
);

assert.equal(
    connection.transportConnectionKey,
    "grpc_stream_002"
);

assert.equal(
    connection.disconnectedAtMs,
    null
);

const userConnections =
    registry.listByUserId(userId);

assert.equal(
    userConnections.length,
    1
);

assert.equal(
    Object.isFrozen(userConnections),
    true
);

assert.equal(
    Object.isFrozen(userConnections[0]),
    true
);

const activeStats =
    registry.getStats();

assert.equal(
    activeStats.total,
    1
);

assert.equal(
    activeStats.active,
    1
);

let duplicateClientInstanceError = null;

try {
    registry.registerAuthenticatedConnection({
        userId:
            "80c686cf-d8ca-4c15-9f85-5f503a14f21a",
        avatarId:
            "80c686cf-d8ca-4c15-9f85-5f503a14f21a",
        roomId: "room_voice_001",
        platform: VoiceClientPlatform.WEBGL,
        clientInstanceId:
            firstClientInstanceId,
        transportName: "websocket",
        transportConnectionKey:
            "websocket_001"
    });
} catch (error) {
    duplicateClientInstanceError = error;
}

assert.match(
    duplicateClientInstanceError?.message ?? "",
    /already exists for this client instance/
);

let duplicateAvatarError = null;

try {
    registry.registerAuthenticatedConnection({
        userId,
        avatarId: userId,
        roomId: "room_voice_001",
        platform: VoiceClientPlatform.QUEST,
        clientInstanceId:
            secondClientInstanceId,
        transportName: "grpc",
        transportConnectionKey:
            "grpc_stream_003"
    });
} catch (error) {
    duplicateAvatarError = error;
}

assert.match(
    duplicateAvatarError?.message ?? "",
    /already exists for this user and avatar/
);

let backwardSequenceError = null;

try {
    connection.updateSequences({
        lastReceivedSequence: 19
    });
} catch (error) {
    backwardSequenceError = error;
}

assert.match(
    backwardSequenceError?.message ?? "",
    /cannot move backwards/
);

const removedSnapshot =
    registry.removeConnection(
        connection.connectionId,
        {
            reason:
                VoiceConnectionCloseReason
                    .CLIENT_DISCONNECTED,
            closedAtMs: 1785300000400
        }
    );

assert.equal(
    removedSnapshot.state,
    VoiceConnectionState.CLOSED
);

assert.equal(
    removedSnapshot.closeReason,
    VoiceConnectionCloseReason
        .CLIENT_DISCONNECTED
);

assert.equal(
    registry.getByConnectionId(
        connection.connectionId
    ),
    null
);

assert.equal(
    registry.getByClientInstanceId(
        firstClientInstanceId
    ),
    null
);

assert.equal(
    registry.getStats().total,
    0
);

console.log(
    "VOICE_V2_1_CONNECTION_REGISTRY_TEST=OK"
);

/*
توضیح فایل:
این فایل ثبت اتصال صوتی، جلوگیری از اتصال تکراری، تغییر وضعیت، به‌روزرسانی شماره بسته‌ها، تعلیق، ادامه اتصال و حذف کامل اتصال را بررسی می‌کند.
*/
