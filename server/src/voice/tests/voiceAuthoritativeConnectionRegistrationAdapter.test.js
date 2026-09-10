import assert from "node:assert/strict";

import {
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    createVoiceV4RuntimeServices
} from "../bootstrap/createVoiceV4RuntimeServices.js";

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceConnectionRegistrationStage
} from "../core/voiceConnectionRegistrationService.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    VoiceAuthoritativeSessionService,
    VoiceSessionReason
} from "../session/index.js";

const NOW_MS = 1_785_000_000_000;
const userId = "11111111-1111-4111-8111-111111111111";
const peerUserId = "22222222-2222-4222-8222-222222222222";
const roomId = "room-authoritative-handoff";
const oldConnectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const newConnectionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const peerConnectionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const oldClientInstanceId = "a1111111-1111-4111-8111-111111111111";
const newClientInstanceId = "b2222222-2222-4222-8222-222222222222";

//* این تابع یک Voice connection قدیمی و فعال را برای شبیه‌سازی خروج ناقص Runtime می‌سازد.
function registerOldConnection(registry) {
    const connection =
        registry.registerAuthenticatedConnection({
            connectionId: oldConnectionId,
            userId,
            avatarId: userId,
            roomId,
            platform: VoiceClientPlatform.WINDOWS,
            clientInstanceId: oldClientInstanceId,
            transportName: "grpc",
            transportConnectionKey: "old-transport",
            createdAtMs: NOW_MS - 2000
        });

    connection.activate(NOW_MS - 1900);
    return connection;
}

//* این تابع سرویسی می‌سازد که قبل از cleanup همان خطای duplicate user/avatar و بعد از cleanup ثبت موفق می‌دهد.
function createBaseRegistrationService(
    registry,
    clientInstanceId = newClientInstanceId
) {
    const registrationInput = Object.freeze({
        connectionId: newConnectionId,
        userId,
        avatarId: userId,
        roomId,
        platform: VoiceClientPlatform.WINDOWS,
        clientInstanceId,
        transportName: "grpc",
        transportConnectionKey: "new-transport",
        createdAtMs: NOW_MS
    });

    return {
        calls: 0,

        registerAndActivate() {
            this.calls += 1;

            if (
                registry.getByUserAndAvatar(
                    registrationInput.userId,
                    registrationInput.avatarId
                )
            ) {
                return Object.freeze({
                    success: false,
                    stage: VoiceConnectionRegistrationStage.REGISTRATION,
                    preparationResult: Object.freeze({ registrationInput })
                });
            }

            const connection =
                registry.registerAuthenticatedConnection(
                    registrationInput
                );

            const snapshot =
                connection.activate(NOW_MS);

            return Object.freeze({
                success: true,
                stage: VoiceConnectionRegistrationStage.ACTIVE,
                connectionId: connection.connectionId,
                connection: snapshot
            });
        }
    };
}

//* این تابع ترکیب واقعی V4 را روی رجیستری اتصال و Session آزمایشی می‌سازد.
function createV4Runtime(
    connectionRegistry,
    connectionRegistrationService
) {
    const sessionService =
        new VoiceAuthoritativeSessionService();

    const v4Runtime =
        createVoiceV4RuntimeServices({
            voiceRuntimeServices: {
                connectionRegistrationService,
                voiceConnectionRegistry:
                    connectionRegistry
            },
            voiceSessionRegistry:
                sessionService.sessionRegistry,
            now: () => NOW_MS
        });

    return {
        sessionService,
        v4Runtime
    };
}

const connectionRegistry =
    new VoiceConnectionRegistry();

registerOldConnection(connectionRegistry);

const baseRegistrationService =
    createBaseRegistrationService(
        connectionRegistry
    );

const runtime =
    createV4Runtime(
        connectionRegistry,
        baseRegistrationService
    );

runtime.sessionService.applyEvent({
    type: "session_created",
    authority: "dedicated_server",
    sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    roomId,
    serverId: "server-authoritative-handoff",
    firstParticipant: {
        connectionId: oldConnectionId,
        userId,
        avatarId: userId
    },
    secondParticipant: {
        connectionId: peerConnectionId,
        userId: peerUserId,
        avatarId: peerUserId
    },
    distanceMeters: 2.5,
    reason: VoiceSessionReason.PROXIMITY_ENTER,
    effectiveAtMs: NOW_MS - 1000
});

const handoffResult =
    runtime.v4Runtime
        .authoritativeConnectionRegistrationService
        .registerAndActivate({
            activatedAtMs: NOW_MS
        });

assert.equal(handoffResult.success, true);
assert.equal(baseRegistrationService.calls, 2);
assert.equal(
    connectionRegistry.getByConnectionId(oldConnectionId),
    null
);
assert.equal(
    connectionRegistry.getByConnectionId(newConnectionId)?.state,
    VoiceConnectionState.ACTIVE
);
assert.equal(
    runtime.sessionService.sessionRegistry
        .listActiveByConnectionId(oldConnectionId)
        .length,
    0
);
assert.equal(
    runtime.v4Runtime
        .getStats()
        .authoritativeConnectionRegistration
        .authoritativeHandoffs,
    1
);

const reconnectRegistry =
    new VoiceConnectionRegistry();

registerOldConnection(reconnectRegistry);

const sameRuntimeRegistrationService =
    createBaseRegistrationService(
        reconnectRegistry,
        oldClientInstanceId
    );

const reconnectRuntime =
    createV4Runtime(
        reconnectRegistry,
        sameRuntimeRegistrationService
    );

const sameRuntimeResult =
    reconnectRuntime.v4Runtime
        .authoritativeConnectionRegistrationService
        .registerAndActivate({
            activatedAtMs: NOW_MS
        });

assert.equal(sameRuntimeResult.success, false);
assert.equal(sameRuntimeRegistrationService.calls, 1);
assert.notEqual(
    reconnectRegistry.getByConnectionId(oldConnectionId),
    null
);
assert.equal(
    reconnectRuntime.v4Runtime
        .getStats()
        .authoritativeConnectionRegistration
        .authoritativeHandoffs,
    0
);

console.log(
    "VOICE_G4_AUTHORITATIVE_CONNECTION_HANDOFF_TEST=OK"
);

/*
توضیح فایل:
این آزمون ثابت می‌کند ورود Runtime تازه با Dedicated connection authoritative تازه، Voice قدیمی را همراه Session cleanup جایگزین می‌کند و reconnect همان Runtime به‌اشتباه پاک نمی‌شود.
*/
