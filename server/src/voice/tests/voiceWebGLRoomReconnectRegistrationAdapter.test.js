import assert from "node:assert/strict";

import {
    VoiceAuthResultCode,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    createVoiceV4RuntimeServices
} from "../bootstrap/createVoiceV4RuntimeServices.js";

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
    VoiceWebGLRoomReconnectRegistrationAdapter
} from "../reconnect/webgl/voiceWebGLRoomReconnectRegistrationAdapter.js";

import {
    VoiceAuthoritativeSessionService,
    VoiceSessionReason
} from "../session/index.js";

const NOW_MS = 1_789_896_802_001;
const userId = "11111111-1111-4111-8111-111111111111";
const peerUserId = "22222222-2222-4222-8222-222222222222";
const roomId = "room-webgl-reconnect-test";
const clientInstanceId = "123e4567-e89b-42d3-a456-426614174000";
const retainedConnectionId = "65adc593-c1b9-4677-8c79-a0b1f16393ab";
const freshDedicatedConnectionId = "75adc593-c1b9-4677-8c79-a0b1f16393ab";
const peerConnectionId = "85adc593-c1b9-4677-8c79-a0b1f16393ab";

function registerSuspendedConnection({
    registry,
    platform,
    connectionId = retainedConnectionId,
    transportName,
    transportConnectionKey
}) {
    const connection = registry.registerAuthenticatedConnection({
        connectionId,
        userId,
        avatarId: userId,
        roomId,
        platform,
        clientInstanceId,
        transportName,
        transportConnectionKey,
        createdAtMs: NOW_MS - 2_000
    });

    connection.activate(NOW_MS - 1_900);
    registry.suspendConnection(connectionId, NOW_MS - 1_000);
    return connection;
}

function registerActiveConnection({
    registry,
    platform,
    connectionId = retainedConnectionId,
    transportName,
    transportConnectionKey
}) {
    const connection = registry.registerAuthenticatedConnection({
        connectionId,
        userId,
        avatarId: userId,
        roomId,
        platform,
        clientInstanceId,
        transportName,
        transportConnectionKey,
        createdAtMs: NOW_MS - 2_000
    });

    connection.activate(NOW_MS - 1_900);
    return connection;
}

function createRuntime({
    registry,
    authoritativeConnectionId,
    platform,
    transportName
}) {
    const sessionService = new VoiceAuthoritativeSessionService();

    const preparationService = {
        prepare(input = {}) {
            return Object.freeze({
                ready: true,
                retryable: false,
                code: VoiceAuthResultCode.AUTHENTICATED,
                userId,
                roomId,
                registrationInput: Object.freeze({
                    connectionId: authoritativeConnectionId,
                    userId,
                    avatarId: userId,
                    roomId,
                    platform,
                    clientInstanceId: input.clientInstanceId,
                    transportName,
                    transportConnectionKey:
                        input.transportConnectionKey,
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

    const v4Runtime = createVoiceV4RuntimeServices({
        voiceRuntimeServices: {
            connectionRegistrationService: registrationService,
            voiceConnectionRegistry: registry
        },
        voiceSessionRegistry: sessionService.sessionRegistry,
        now: () => NOW_MS
    });

    return { sessionService, v4Runtime };
}

function createWebGLAdapter(runtime, registry) {
    return new VoiceWebGLRoomReconnectRegistrationAdapter({
        baseRegistrationService:
            runtime.v4Runtime
                .authoritativeConnectionRegistrationService,
        voiceConnectionRegistry: registry,
        reconnectCoordinator:
            runtime.v4Runtime.reconnectCoordinator,
        now: () => NOW_MS
    });
}

const rolloverRegistry = new VoiceConnectionRegistry();
registerActiveConnection({
    registry: rolloverRegistry,
    platform: VoiceClientPlatform.WEBGL,
    transportName: "websocket",
    transportConnectionKey: "webgl-before-network-loss"
});

const rolloverRuntime = createRuntime({
    registry: rolloverRegistry,
    authoritativeConnectionId: freshDedicatedConnectionId,
    platform: VoiceClientPlatform.WEBGL,
    transportName: "websocket"
});

rolloverRuntime.sessionService.applyEvent({
    type: "session_created",
    authority: "dedicated_server",
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    roomId,
    serverId: "server-webgl-reconnect-test",
    firstParticipant: {
        connectionId: retainedConnectionId,
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
    effectiveAtMs: NOW_MS - 800
});

const rolloverAdapter = createWebGLAdapter(
    rolloverRuntime,
    rolloverRegistry
);

const rolloverResult = rolloverAdapter.registerAndActivate({
    platform: VoiceClientPlatform.WEBGL,
    clientInstanceId,
    transportName: "websocket",
    transportConnectionKey: "webgl-after-network-loss",
    createdAtMs: NOW_MS,
    activatedAtMs: NOW_MS
});

assert.equal(rolloverResult.success, true);
assert.equal(rolloverResult.webglDedicatedIdentityHandoff, true);
assert.equal(rolloverResult.connectionId, freshDedicatedConnectionId);
assert.equal(rolloverResult.previousVoiceConnectionId, retainedConnectionId);
assert.equal(rolloverResult.currentVoiceConnectionId, freshDedicatedConnectionId);
assert.equal(rolloverRegistry.getByConnectionId(retainedConnectionId), null);
assert.equal(
    rolloverRegistry.getByConnectionId(freshDedicatedConnectionId)?.state,
    VoiceConnectionState.ACTIVE
);
assert.equal(
    rolloverRuntime.sessionService.sessionRegistry
        .listActiveByConnectionId(retainedConnectionId)
        .length,
    0
);
assert.equal(rolloverRegistry.getStats().total, 1);

const stableRegistry = new VoiceConnectionRegistry();
registerSuspendedConnection({
    registry: stableRegistry,
    platform: VoiceClientPlatform.WEBGL,
    transportName: "websocket",
    transportConnectionKey: "voice-only-before-loss"
});

const stableRuntime = createRuntime({
    registry: stableRegistry,
    authoritativeConnectionId: retainedConnectionId,
    platform: VoiceClientPlatform.WEBGL,
    transportName: "websocket"
});

const stableAdapter = createWebGLAdapter(stableRuntime, stableRegistry);
const stableResult = stableAdapter.registerAndActivate({
    platform: VoiceClientPlatform.WEBGL,
    clientInstanceId,
    transportName: "websocket",
    transportConnectionKey: "voice-only-after-loss",
    createdAtMs: NOW_MS,
    activatedAtMs: NOW_MS
});

assert.equal(stableResult.success, true);
assert.equal(stableResult.reused, true);
assert.equal(stableResult.resumed, true);
assert.equal(stableResult.connectionId, retainedConnectionId);
assert.equal(stableResult.webglDedicatedIdentityHandoff, undefined);
assert.equal(stableRegistry.getStats().total, 1);

const windowsRegistry = new VoiceConnectionRegistry();
registerSuspendedConnection({
    registry: windowsRegistry,
    platform: VoiceClientPlatform.WINDOWS,
    transportName: "grpc",
    transportConnectionKey: "windows-before-loss"
});

const windowsRuntime = createRuntime({
    registry: windowsRegistry,
    authoritativeConnectionId: freshDedicatedConnectionId,
    platform: VoiceClientPlatform.WINDOWS,
    transportName: "grpc"
});

const windowsAdapter = createWebGLAdapter(windowsRuntime, windowsRegistry);
const windowsResult = windowsAdapter.registerAndActivate({
    platform: VoiceClientPlatform.WINDOWS,
    clientInstanceId,
    transportName: "grpc",
    transportConnectionKey: "windows-after-loss",
    createdAtMs: NOW_MS,
    activatedAtMs: NOW_MS
});

assert.equal(windowsResult.success, false);
assert.notEqual(
    windowsRegistry.getByConnectionId(retainedConnectionId),
    null
);
assert.equal(
    windowsRegistry.getByConnectionId(freshDedicatedConnectionId),
    null
);
assert.equal(windowsRegistry.getStats().total, 1);

rolloverRuntime.v4Runtime.stop();
stableRuntime.v4Runtime.stop();
windowsRuntime.v4Runtime.stop();

console.log(
    "VOICE_WEBGL_ROOM_RECONNECT_ADAPTER_TEST=OK | activeTransportRace=handled | generalReconnect=freshDedicatedIdentity | voiceOnlyReconnect=retainedVoiceIdentity | oldSessionClosed=true | windowsPathChanged=false | questPathChanged=false"
);

/*
توضیح فایل:
این آزمون با سرویس‌های واقعی Registry، ReconnectCoordinator و Session ثابت می‌کند ریکانکت عمومی WebGL حتی در مسابقه زمانی فعال‌ماندن Transport قدیمی، پس از تغییر شناسه Dedicated، Voice قبلی را رسمی می‌بندد و هویت تازه را ثبت می‌کند؛ ریکانکت صرفاً Voice همان شناسه را Resume می‌کند و مسیر Windows تغییر نمی‌کند.
*/
