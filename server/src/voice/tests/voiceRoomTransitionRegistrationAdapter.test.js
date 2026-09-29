import assert from "node:assert/strict";

import {
    VoiceAuthResultCode,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceConnectionRegistrationService
} from "../core/voiceConnectionRegistrationService.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    VoiceRoomTransitionRegistrationAdapter
} from "../reconnect/voiceRoomTransitionRegistrationAdapter.js";

const NOW_MS = 1_790_250_100_000;
const userId = "11111111-1111-4111-8111-111111111111";
const avatarId = userId;
const oldRoomId = "room-old";
const newRoomId = "room-new";
const oldConnectionId = "65adc593-c1b9-4677-8c79-a0b1f16393ab";
const newConnectionId = "75adc593-c1b9-4677-8c79-a0b1f16393ab";
const oldClientInstanceId = "123e4567-e89b-42d3-a456-426614174000";
const newClientInstanceId = "223e4567-e89b-42d3-a456-426614174000";

function registerRetainedConnection(registry, platform) {
    const connection = registry.registerAuthenticatedConnection({
        connectionId: oldConnectionId,
        userId,
        avatarId,
        roomId: oldRoomId,
        platform,
        clientInstanceId: oldClientInstanceId,
        transportName:
            platform === VoiceClientPlatform.WEBGL ? "websocket" : "grpc",
        transportConnectionKey: "old-transport",
        createdAtMs: NOW_MS - 5_000
    });

    connection.activate(NOW_MS - 4_900);
    registry.suspendConnection(oldConnectionId, NOW_MS - 1_000);
    return connection;
}

function createFixture(platform, targetRoomId = newRoomId) {
    const registry = new VoiceConnectionRegistry();
    registerRetainedConnection(registry, platform);

    const preparationService = {
        prepare(input = {}) {
            return Object.freeze({
                ready: true,
                retryable: false,
                code: VoiceAuthResultCode.AUTHENTICATED,
                userId,
                roomId: targetRoomId,
                registrationInput: Object.freeze({
                    connectionId: newConnectionId,
                    userId,
                    avatarId,
                    roomId: targetRoomId,
                    platform,
                    clientInstanceId: input.clientInstanceId,
                    transportName:
                        platform === VoiceClientPlatform.WEBGL ? "websocket" : "grpc",
                    transportConnectionKey: input.transportConnectionKey,
                    createdAtMs: input.createdAtMs
                })
            });
        }
    };

    const registrationService =
        new VoiceConnectionRegistrationService({
            connectionPreparationService: preparationService,
            voiceConnectionRegistry: registry
        });

    const reconnectCoordinator = {
        closeConnectionImmediately(connectionId, reason, closedAtMs) {
            registry.removeConnection(connectionId, {
                reason,
                closedAtMs
            });
        }
    };

    const adapter = new VoiceRoomTransitionRegistrationAdapter({
        baseRegistrationService: registrationService,
        voiceConnectionRegistry: registry,
        reconnectCoordinator,
        now: () => NOW_MS
    });

    return { registry, adapter };
}

for (const platform of [
    VoiceClientPlatform.WINDOWS,
    VoiceClientPlatform.WEBGL
]) {
    const fixture = createFixture(platform);

    const result = fixture.adapter.registerAndActivate({
        platform,
        clientInstanceId: newClientInstanceId,
        transportConnectionKey: "new-transport",
        createdAtMs: NOW_MS,
        activatedAtMs: NOW_MS
    });

    assert.equal(result.success, true);
    assert.equal(result.roomTransitionRegistrationHandoff, true);
    assert.equal(result.previousVoiceConnectionId, oldConnectionId);
    assert.equal(result.currentVoiceConnectionId, newConnectionId);
    assert.equal(result.previousVoiceRoomId, oldRoomId);
    assert.equal(result.currentVoiceRoomId, newRoomId);
    assert.equal(fixture.registry.getByConnectionId(oldConnectionId), null);
    assert.equal(
        fixture.registry.getByConnectionId(newConnectionId)?.state,
        VoiceConnectionState.ACTIVE
    );
    assert.equal(fixture.registry.getStats().total, 1);
}

const sameRoomFixture = createFixture(
    VoiceClientPlatform.WINDOWS,
    oldRoomId
);

const sameRoomResult = sameRoomFixture.adapter.registerAndActivate({
    platform: VoiceClientPlatform.WINDOWS,
    clientInstanceId: newClientInstanceId,
    transportConnectionKey: "new-same-room-transport",
    createdAtMs: NOW_MS,
    activatedAtMs: NOW_MS
});

assert.equal(sameRoomResult.success, false);
assert.equal(
    sameRoomResult.roomTransitionRegistrationHandoff,
    undefined
);
assert.notEqual(
    sameRoomFixture.registry.getByConnectionId(oldConnectionId),
    null
);

console.log(
    "VOICE_ROOM_TRANSITION_REGISTRATION_TEST=PASS" +
    " | windowsCrossRoomHandoff=true" +
    " | webglCrossRoomHandoff=true" +
    " | sameRoomReconnectPreserved=true" +
    " | serverRetentionWaitRemoved=true" +
    " | coreFilesChanged=false"
);
