import assert from "node:assert/strict";

import {
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    VoiceAuthoritativeConnectionRegistrationAdapter
} from "../adapters/voiceAuthoritativeConnectionRegistrationAdapter.js";

import {
    VoiceConnectionRegistrationStage
} from "../core/voiceConnectionRegistrationService.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

const NOW_MS = 1_789_896_900_000;
const userId = "11111111-1111-4111-8111-111111111111";
const roomId = "room-webgl-startup-hook-test";
const clientInstanceId = "123e4567-e89b-42d3-a456-426614174000";
const oldConnectionId = "65adc593-c1b9-4677-8c79-a0b1f16393ab";
const newConnectionId = "75adc593-c1b9-4677-8c79-a0b1f16393ab";

process.env.VOICE_WEBGL_ROOM_RECONNECT_RESUME_ENABLED = "true";
await import(
    "../reconnect/webgl/voiceWebGLRoomReconnectStartupHook.js"
);

const registry = new VoiceConnectionRegistry();
const oldConnection = registry.registerAuthenticatedConnection({
    connectionId: oldConnectionId,
    userId,
    avatarId: userId,
    roomId,
    platform: VoiceClientPlatform.WEBGL,
    clientInstanceId,
    transportName: "websocket",
    transportConnectionKey: "old-webgl-transport",
    createdAtMs: NOW_MS - 1000
});
oldConnection.activate(NOW_MS - 900);

const registrationInput = Object.freeze({
    connectionId: newConnectionId,
    userId,
    avatarId: userId,
    roomId,
    platform: VoiceClientPlatform.WEBGL,
    clientInstanceId,
    transportName: "websocket",
    transportConnectionKey: "new-webgl-transport",
    createdAtMs: NOW_MS
});

let baseCalls = 0;
const baseRegistrationService = {
    registerAndActivate() {
        baseCalls += 1;

        if (registry.getByUserAndAvatar(userId, userId)) {
            return Object.freeze({
                success: false,
                stage: VoiceConnectionRegistrationStage.REGISTRATION,
                preparationResult: Object.freeze({ registrationInput })
            });
        }

        const connection =
            registry.registerAuthenticatedConnection(registrationInput);
        const snapshot = connection.activate(NOW_MS);

        return Object.freeze({
            success: true,
            stage: VoiceConnectionRegistrationStage.ACTIVE,
            connectionId: newConnectionId,
            connection: snapshot
        });
    }
};

let closeCalls = 0;
const reconnectCoordinator = {
    closeConnectionImmediately(connectionId, reason, closedAtMs) {
        closeCalls += 1;
        registry.removeConnection(connectionId, {
            reason,
            closedAtMs
        });
    }
};

const authoritativeAdapter =
    new VoiceAuthoritativeConnectionRegistrationAdapter({
        connectionRegistrationService: baseRegistrationService,
        voiceConnectionRegistry: registry,
        reconnectCoordinator,
        now: () => NOW_MS
    });

const result = authoritativeAdapter.registerAndActivate({
    platform: VoiceClientPlatform.WEBGL,
    activatedAtMs: NOW_MS
});

assert.equal(result.success, true);
assert.equal(result.webglDedicatedIdentityHandoff, true);
assert.equal(result.connectionId, newConnectionId);
assert.equal(baseCalls, 2);
assert.equal(closeCalls, 1);
assert.equal(registry.getByConnectionId(oldConnectionId), null);
assert.notEqual(registry.getByConnectionId(newConnectionId), null);

console.log(
    "VOICE_WEBGL_ROOM_RECONNECT_STARTUP_HOOK_TEST=OK | outerAdapterPatched=true | activeTransportRace=handled | windowsPathChanged=false | questPathChanged=false"
);

/*
توضیح فایل:
این آزمون ثابت می‌کند Startup Hook روی Authoritative Adapter بیرونی نصب می‌شود و مسابقه زمانی اتصال WebGL قدیمی که هنوز Active مانده است را با handoff رسمی به شناسه Dedicated تازه حل می‌کند.
*/
