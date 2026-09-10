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

import {
    VoiceMuteRegistry
} from "../mute/voiceMuteRegistry.js";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceReconnectCoordinator
} from "../reconnect/voiceReconnectCoordinator.js";

import {
    VoicePacketFlowGuard
} from "../routing/voicePacketFlowGuard.js";

import {
    VoiceRoutingApplication
} from "../routing/voiceRoutingApplication.js";

import {
    VoiceListenerMuteKind,
    VoicePublishStopReason,
    encodeVoiceListenerMuteChangedPayload,
    encodeVoicePublishStartPayload,
    encodeVoicePublishStopPayload
} from "../routing/voiceRoutingControlPayload.js";

import {
    VoiceAuthoritativeSessionService,
    VoiceSessionReason
} from "../session/index.js";

const NOW_MS = 1_000_000;

const identities = Object.freeze({
    a: Object.freeze({
        userId: "11111111-1111-4111-8111-111111111111",
        connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        clientInstanceId: "a1111111-1111-4111-8111-111111111111"
    }),
    b: Object.freeze({
        userId: "22222222-2222-4222-8222-222222222222",
        connectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        clientInstanceId: "b2222222-2222-4222-8222-222222222222"
    }),
    c: Object.freeze({
        userId: "33333333-3333-4333-8333-333333333333",
        connectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        clientInstanceId: "c3333333-3333-4333-8333-333333333333"
    })
});

//* این تابع اتصال معتبر و فعال یک کاربر آزمایشی را داخل رجیستری واقعی ایجاد می‌کند.
function registerActiveConnection(
    registry,
    identity
) {
    const connection =
        registry.registerAuthenticatedConnection({
            connectionId:
                identity.connectionId,
            userId:
                identity.userId,
            avatarId:
                identity.userId,
            roomId:
                "room-v4",
            platform:
                VoiceClientPlatform.WINDOWS,
            clientInstanceId:
                identity.clientInstanceId,
            transportName:
                "v4_memory_test",
            transportConnectionKey:
                `transport-${identity.connectionId}`,
            createdAtMs:
                NOW_MS - 1000
        });

    connection.activate(NOW_MS - 900);
    return connection;
}

//* این تابع رویداد ساخت Session قطعی را برای دو عضو ایجاد می‌کند.
function createSession(
    service,
    sessionId,
    first,
    second
) {
    return service.applyEvent({
        type: "session_created",
        authority: "dedicated_server",
        sessionId,
        roomId: "room-v4",
        serverId: "dedicated-v4",
        firstParticipant: {
            connectionId: first.connectionId,
            userId: first.userId,
            avatarId: first.userId
        },
        secondParticipant: {
            connectionId: second.connectionId,
            userId: second.userId,
            avatarId: second.userId
        },
        distanceMeters: 2.5,
        effectiveAtMs: NOW_MS - 800
    });
}

//* این تابع یک راه انتقال حافظه‌ای برای دریافت Envelopeهای خروجی برنامه می‌سازد.
function createMemoryTransport(connectionId) {
    return {
        connectionId,
        sent: [],
        closed: [],

        async sendEnvelope(input) {
            this.sent.push({
                ...input,
                payload: Buffer.from(input.payload)
            });
            return this.sent.length;
        },

        async close(input) {
            this.closed.push(input);
        }
    };
}

const connectionRegistry =
    new VoiceConnectionRegistry();

for (const identity of Object.values(identities)) {
    registerActiveConnection(
        connectionRegistry,
        identity
    );
}

const sessionService =
    new VoiceAuthoritativeSessionService();

const sessionAB =
    "ab000000-0000-4000-8000-000000000001";

const sessionBC =
    "bc000000-0000-4000-8000-000000000002";

createSession(
    sessionService,
    sessionAB,
    identities.a,
    identities.b
);

createSession(
    sessionService,
    sessionBC,
    identities.b,
    identities.c
);

assert.equal(
    sessionService.sessionRegistry
        .listActiveByConnectionId(
            identities.a.connectionId
        ).length,
    1
);

assert.equal(
    sessionService.sessionRegistry
        .listActiveByConnectionId(
            identities.b.connectionId
        ).length,
    2
);

const muteRegistry =
    new VoiceMuteRegistry();

const flowGuard =
    new VoicePacketFlowGuard({
        now: () => NOW_MS
    });

const scheduled = [];

const reconnectCoordinator =
    new VoiceReconnectCoordinator({
        voiceConnectionRegistry:
            connectionRegistry,
        voiceSessionRegistry:
            sessionService.sessionRegistry,
        muteRegistry,
        packetFlowGuard:
            flowGuard,
        now: () => NOW_MS,
        schedule: (callback, delayMs) => {
            const timer = { callback, delayMs };
            scheduled.push(timer);
            return timer;
        },
        cancelSchedule: (timer) => {
            timer.cancelled = true;
        }
    });

const routingApplication =
    new VoiceRoutingApplication({
        voiceConnectionRegistry:
            connectionRegistry,
        voiceSessionRegistry:
            sessionService.sessionRegistry,
        muteRegistry,
        packetFlowGuard:
            flowGuard,
        reconnectCoordinator,
        now: () => NOW_MS
    });

const transports = new Map(
    Object.values(identities).map(
        (identity) => [
            identity.connectionId,
            createMemoryTransport(
                identity.connectionId
            )
        ]
    )
);

routingApplication.setGateway({
    getConnectionByConnectionId(connectionId) {
        return transports.get(connectionId) ?? null;
    }
});

const publisherTransport =
    transports.get(
        identities.b.connectionId
    );

await routingApplication.handleEnvelope({
    envelope: {
        messageType:
            VoiceMessageType.PUBLISH_START,
        flags:
            VoiceMessageFlag.ACK_REQUIRED,
        sequence: 1,
        timestampMs:
            BigInt(NOW_MS),
        sessionId:
            VoiceBinaryProtocolConstants.emptyUuid,
        senderId:
            identities.b.connectionId,
        payload:
            encodeVoicePublishStartPayload({
                bitrateKbps: 32
            })
    },
    transportConnection:
        publisherTransport
});

assert.equal(
    routingApplication.getStats().activePublishers,
    1
);

const opusFrame =
    Buffer.from([0xf8, 0xff, 0xfe, 0x00]);

await routingApplication.handleEnvelope({
    envelope: {
        messageType:
            VoiceMessageType.VOICE_FRAME,
        flags:
            VoiceMessageFlag.NONE,
        sequence: 2,
        timestampMs:
            BigInt(NOW_MS),
        sessionId:
            VoiceBinaryProtocolConstants.emptyUuid,
        senderId:
            identities.b.connectionId,
        payloadLength:
            opusFrame.length,
        payload:
            opusFrame
    },
    transportConnection:
        publisherTransport
});

const aFrames =
    transports.get(identities.a.connectionId)
        .sent.filter(
            (message) =>
                message.messageType ===
                VoiceMessageType.VOICE_FRAME
        );

const cFrames =
    transports.get(identities.c.connectionId)
        .sent.filter(
            (message) =>
                message.messageType ===
                VoiceMessageType.VOICE_FRAME
        );

assert.equal(aFrames.length, 1);
assert.equal(cFrames.length, 1);
assert.equal(aFrames[0].sessionId, sessionAB);
assert.equal(cFrames[0].sessionId, sessionBC);
assert.equal(
    aFrames[0].senderId,
    identities.b.connectionId
);
assert.strictEqual(
    aFrames[0].payload.equals(opusFrame),
    true
);

await routingApplication.handleEnvelope({
    envelope: {
        messageType:
            VoiceMessageType.LISTENER_MUTE_CHANGED,
        flags:
            VoiceMessageFlag.ACK_REQUIRED,
        sequence: 1,
        timestampMs:
            BigInt(NOW_MS),
        sessionId:
            VoiceBinaryProtocolConstants.emptyUuid,
        senderId:
            identities.a.connectionId,
        payload:
            encodeVoiceListenerMuteChangedPayload({
                kind:
                    VoiceListenerMuteKind.PER_USER,
                muted: true,
                targetConnectionId:
                    identities.b.connectionId
            })
    },
    transportConnection:
        transports.get(
            identities.a.connectionId
        )
});

await routingApplication.handleEnvelope({
    envelope: {
        messageType:
            VoiceMessageType.VOICE_FRAME,
        flags:
            VoiceMessageFlag.DTX,
        sequence: 3,
        timestampMs:
            BigInt(NOW_MS),
        sessionId:
            VoiceBinaryProtocolConstants.emptyUuid,
        senderId:
            identities.b.connectionId,
        payloadLength:
            opusFrame.length,
        payload:
            opusFrame
    },
    transportConnection:
        publisherTransport
});

assert.equal(
    transports.get(identities.a.connectionId)
        .sent.filter(
            (message) =>
                message.messageType ===
                VoiceMessageType.VOICE_FRAME
        ).length,
    1
);

assert.equal(
    transports.get(identities.c.connectionId)
        .sent.filter(
            (message) =>
                message.messageType ===
                VoiceMessageType.VOICE_FRAME
        ).length,
    2
);

const futureTimestampGuard =
    new VoicePacketFlowGuard({
        now: () => NOW_MS
    });

const futureTimestampFrame =
    futureTimestampGuard.inspect({
        connectionId:
            identities.b.connectionId,
        sequence: 1,
        timestampMs:
            BigInt(NOW_MS + 10_000),
        payloadBytes:
            opusFrame.length
    });

assert.equal(futureTimestampFrame.accepted, true);
assert.equal(
    futureTimestampGuard.getStats()
        .normalizedPacketsByReason.future_timestamp,
    1
);

const duplicate =
    flowGuard.inspect({
        connectionId:
            identities.b.connectionId,
        sequence: 3,
        timestampMs:
            BigInt(NOW_MS),
        payloadBytes:
            opusFrame.length
    });

assert.equal(duplicate.accepted, false);
assert.equal(duplicate.dropReason, "duplicate");

const suspended =
    reconnectCoordinator.handleTransportClosed({
        connectionId:
            identities.c.connectionId,
        registryReason:
            VoiceConnectionCloseReason
                .TRANSPORT_CLOSED,
        closedAtMs:
            NOW_MS
    });

assert.equal(suspended.action, "suspended");
assert.equal(
    connectionRegistry
        .getByConnectionId(
            identities.c.connectionId
        ).state,
    VoiceConnectionState.SUSPENDED
);
assert.equal(scheduled.length, 1);

connectionRegistry.resumeConnection(
    identities.c.connectionId,
    {
        transportName:
            "v4_memory_test",
        transportConnectionKey:
            "transport-c-resumed",
        resumedAtMs:
            NOW_MS + 100
    }
);

assert.equal(
    reconnectCoordinator
        .handleConnectionAuthenticated(
            identities.c.connectionId,
            true
        ),
    true
);
assert.equal(scheduled[0].cancelled, true);

await routingApplication.handleEnvelope({
    envelope: {
        messageType:
            VoiceMessageType.PUBLISH_STOP,
        flags:
            VoiceMessageFlag.ACK_REQUIRED,
        sequence: 4,
        timestampMs:
            BigInt(NOW_MS),
        sessionId:
            VoiceBinaryProtocolConstants.emptyUuid,
        senderId:
            identities.b.connectionId,
        payload:
            encodeVoicePublishStopPayload({
                reason:
                    VoicePublishStopReason.MIC_MUTED
            })
    },
    transportConnection:
        publisherTransport
});

assert.equal(
    routingApplication.getStats().activePublishers,
    0
);

assert.equal(
    sessionService.sessionRegistry
        .listActiveByConnectionId(
            identities.a.connectionId
        )[0].reason,
    VoiceSessionReason.PROXIMITY_ENTER
);

console.log("VOICE_V4_REFERENCE_STREAM_ROUTING=PASS");
console.log("VOICE_V4_NON_TRANSITIVE_FAN_OUT=PASS");
console.log("VOICE_V4_DIRECTIONAL_MUTE=PASS");
console.log("VOICE_V4_PACKET_FLOW_GUARD=PASS");
console.log("VOICE_V4_RECONNECT_RETENTION=PASS");
console.log("VOICE_V4_ROUTING_TESTS=PASS");

