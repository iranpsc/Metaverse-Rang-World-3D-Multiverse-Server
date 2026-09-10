import assert from "node:assert/strict";

import {
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

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
    encodeVoicePublishStartPayload,
    encodeVoicePublishStopPayload
} from "../routing/voiceRoutingControlPayload.js";

import {
    VoiceAuthoritativeSessionService,
    decodeVoiceSessionDescriptor
} from "../session/index.js";

const NOW_MS = 1786002000000;
const ROOM_ID = "room-g5-6";
const SERVER_ID = "server-g5-6";
const SESSION_ABC = "11111111-1111-4111-8111-111111111111";

const identities = Object.freeze({
    A: Object.freeze({
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        connectionId: "11111111-1111-4111-8111-111111111111",
        clientInstanceId: "a1111111-1111-4111-8111-111111111111"
    }),
    B: Object.freeze({
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        connectionId: "22222222-2222-4222-8222-222222222222",
        clientInstanceId: "b2222222-2222-4222-8222-222222222222"
    }),
    C: Object.freeze({
        userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        connectionId: "33333333-3333-4333-8333-333333333333",
        clientInstanceId: "c3333333-3333-4333-8333-333333333333"
    }),
    D: Object.freeze({
        userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        connectionId: "44444444-4444-4444-8444-444444444444",
        clientInstanceId: "d4444444-4444-4444-8444-444444444444"
    })
});

function asParticipant(identity) {
    return {
        userId: identity.userId,
        avatarId: identity.userId,
        connectionId: identity.connectionId
    };
}

function registerConnection(registry, identity) {
    const connection = registry.registerAuthenticatedConnection({
        connectionId: identity.connectionId,
        userId: identity.userId,
        avatarId: identity.userId,
        roomId: ROOM_ID,
        platform: VoiceClientPlatform.WINDOWS,
        clientInstanceId: identity.clientInstanceId,
        transportName: "g5_6_memory_test",
        transportConnectionKey: `transport-${identity.connectionId}`,
        createdAtMs: NOW_MS - 1000
    });

    connection.activate(NOW_MS - 900);
    return connection;
}

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

function createFixture() {
    const connectionRegistry = new VoiceConnectionRegistry();
    for (const identity of Object.values(identities)) {
        registerConnection(connectionRegistry, identity);
    }

    const sessionService = new VoiceAuthoritativeSessionService();
    sessionService.applyEvent({
        type: "session_created",
        authority: "dedicated_server",
        sessionId: SESSION_ABC,
        roomId: ROOM_ID,
        serverId: SERVER_ID,
        firstParticipant: asParticipant(identities.A),
        secondParticipant: asParticipant(identities.B),
        distanceMeters: 2.0,
        effectiveAtMs: NOW_MS - 800
    });

    const joinResult = sessionService.applyEvent({
        type: "member_joined",
        authority: "dedicated_server",
        sessionId: SESSION_ABC,
        memberParticipant: asParticipant(identities.C),
        effectiveAtMs: NOW_MS - 700
    });

    const muteRegistry = new VoiceMuteRegistry();
    const flowGuard = new VoicePacketFlowGuard({
        now: () => NOW_MS
    });
    const reconnectCoordinator = new VoiceReconnectCoordinator({
        voiceConnectionRegistry: connectionRegistry,
        voiceSessionRegistry: sessionService.sessionRegistry,
        muteRegistry,
        packetFlowGuard: flowGuard,
        now: () => NOW_MS,
        schedule: (callback, delayMs) => ({ callback, delayMs }),
        cancelSchedule: (timer) => {
            timer.cancelled = true;
        }
    });

    const routingApplication = new VoiceRoutingApplication({
        voiceConnectionRegistry: connectionRegistry,
        voiceSessionRegistry: sessionService.sessionRegistry,
        muteRegistry,
        packetFlowGuard: flowGuard,
        reconnectCoordinator,
        now: () => NOW_MS
    });

    const transports = new Map(
        Object.values(identities).map(
            (identity) => [
                identity.connectionId,
                createMemoryTransport(identity.connectionId)
            ]
        )
    );

    routingApplication.setGateway({
        getConnectionByConnectionId(connectionId) {
            return transports.get(connectionId) ?? null;
        }
    });

    return {
        connectionRegistry,
        flowGuard,
        joinResult,
        muteRegistry,
        routingApplication,
        sessionService,
        transports
    };
}

async function startPublisher(fixture, identity) {
    await fixture.routingApplication.handleEnvelope({
        envelope: {
            messageType: VoiceMessageType.PUBLISH_START,
            flags: VoiceMessageFlag.ACK_REQUIRED,
            sequence: 1,
            timestampMs: BigInt(NOW_MS),
            sessionId: VoiceBinaryProtocolConstants.emptyUuid,
            senderId: identity.connectionId,
            payload: encodeVoicePublishStartPayload({ bitrateKbps: 32 })
        },
        transportConnection:
            fixture.transports.get(identity.connectionId)
    });
}

async function publishFrame(
    fixture,
    identity,
    sequence,
    timestampMs = NOW_MS
) {
    const payload = Buffer.from([0xf8, 0xff, 0xfe, sequence]);
    return fixture.routingApplication.handleEnvelope({
        envelope: {
            messageType: VoiceMessageType.VOICE_FRAME,
            flags: VoiceMessageFlag.NONE,
            sequence,
            timestampMs: BigInt(timestampMs),
            sessionId: VoiceBinaryProtocolConstants.emptyUuid,
            senderId: identity.connectionId,
            payloadLength: payload.length,
            payload
        },
        transportConnection:
            fixture.transports.get(identity.connectionId)
    });
}

async function stopPublisher(fixture, identity, sequence) {
    const payload =
        encodeVoicePublishStopPayload({
            reason: 1
        });

    return fixture.routingApplication.handleEnvelope({
        envelope: {
            messageType:
                VoiceMessageType.PUBLISH_STOP,
            flags:
                VoiceMessageFlag.ACK_REQUIRED,
            sequence,
            timestampMs: BigInt(NOW_MS),
            sessionId:
                VoiceBinaryProtocolConstants.emptyUuid,
            senderId: identity.connectionId,
            payloadLength: payload.length,
            payload
        },
        transportConnection:
            fixture.transports.get(identity.connectionId)
    });
}

async function testGroupFanOutAndPerListenerMute() {
    const fixture = createFixture();
    await startPublisher(fixture, identities.A);

    await publishFrame(
        fixture,
        identities.A,
        2
    );

    assert.equal(
        fixture.transports.get(identities.B.connectionId)
            .sent.filter((message) =>
                message.messageType === VoiceMessageType.VOICE_FRAME
            ).length,
        1
    );
    assert.equal(
        fixture.transports.get(identities.C.connectionId)
            .sent.filter((message) =>
                message.messageType === VoiceMessageType.VOICE_FRAME
            ).length,
        1
    );

    fixture.muteRegistry.applyChange({
        listenerConnectionId: identities.C.connectionId,
        kind: VoiceListenerMuteKind.PER_USER,
        muted: true,
        targetConnectionId: identities.A.connectionId
    });

    await publishFrame(
        fixture,
        identities.A,
        3
    );

    assert.equal(
        fixture.transports.get(identities.B.connectionId)
            .sent.filter((message) =>
                message.messageType === VoiceMessageType.VOICE_FRAME
            ).length,
        2
    );
    assert.equal(
        fixture.transports.get(identities.C.connectionId)
            .sent.filter((message) =>
                message.messageType === VoiceMessageType.VOICE_FRAME
            ).length,
        1
    );

    await stopPublisher(
        fixture,
        identities.A,
        4
    );

    for (const identity of [identities.B, identities.C]) {
        assert.equal(
            fixture.transports.get(identity.connectionId)
                .sent.filter((message) =>
                    message.messageType ===
                    VoiceMessageType.PUBLISH_STOP
                ).length,
            1
        );
    }
}

async function testListenerMediaUsesServerRouteTimestamp() {
    const fixture = createFixture();
    await startPublisher(fixture, identities.A);

    await publishFrame(
        fixture,
        identities.A,
        2,
        NOW_MS - 800
    );

    const routedFrame = fixture.transports
        .get(identities.B.connectionId)
        .sent.find((message) =>
            message.messageType === VoiceMessageType.VOICE_FRAME
        );

    assert.ok(routedFrame);
    assert.equal(routedFrame.timestampMs, NOW_MS);
}

async function testGroupDescriptorsAndLeaveNotifications() {
    const fixture = createFixture();

    await fixture.routingApplication.handleDedicatedSessionEvent({
        event: {
            type: "member_joined",
            memberUserId: identities.C.userId,
            memberConnectionId: identities.C.connectionId
        },
        applyResult: {
            data: {
                result: fixture.joinResult
            }
        }
    });

    const aJoined = fixture.transports.get(identities.A.connectionId)
        .sent.filter((message) =>
            message.messageType === VoiceMessageType.SESSION_JOINED
        );

    assert.equal(aJoined.length, 2);
    const aPeers = aJoined.map((message) =>
        decodeVoiceSessionDescriptor(message.payload)
    );
    assert.deepEqual(
        aPeers.map((descriptor) => descriptor.peerConnectionId).sort(),
        [
            identities.B.connectionId,
            identities.C.connectionId
        ].sort()
    );

    const leaveResult = fixture.sessionService.applyEvent({
        type: "member_left",
        authority: "dedicated_server",
        sessionId: SESSION_ABC,
        memberUserId: identities.C.userId,
        memberConnectionId: identities.C.connectionId,
        reason: 2,
        effectiveAtMs: NOW_MS
    });

    await fixture.routingApplication.handleDedicatedSessionEvent({
        event: {
            type: "member_left",
            memberUserId: identities.C.userId,
            memberConnectionId: identities.C.connectionId
        },
        applyResult: {
            data: {
                result: leaveResult
            }
        }
    });

    for (const identity of [identities.A, identities.B]) {
        const leftMessage = fixture.transports.get(identity.connectionId)
            .sent.find((message) =>
                message.messageType === VoiceMessageType.SESSION_LEFT
            );

        assert.equal(
            leftMessage.senderId,
            identities.C.connectionId
        );
    }

    const leavingClientMessage = fixture.transports
        .get(identities.C.connectionId)
        .sent.find((message) =>
            message.messageType === VoiceMessageType.SESSION_LEFT
        );

    assert.equal(
        leavingClientMessage.senderId,
        VoiceBinaryProtocolConstants.emptyUuid
    );
}

async function testFourMemberFanOut() {
    const fixture = createFixture();

    fixture.sessionService.applyEvent({
        type: "member_joined",
        authority: "dedicated_server",
        sessionId: SESSION_ABC,
        memberParticipant:
            asParticipant(identities.D),
        effectiveAtMs: NOW_MS - 600
    });

    await startPublisher(fixture, identities.A);
    await publishFrame(fixture, identities.A, 2);

    for (const identity of [
        identities.B,
        identities.C,
        identities.D
    ]) {
        assert.equal(
            fixture.transports.get(identity.connectionId)
                .sent.filter((message) =>
                    message.messageType ===
                    VoiceMessageType.VOICE_FRAME
                ).length,
            1
        );
    }
}

await testGroupFanOutAndPerListenerMute();
await testListenerMediaUsesServerRouteTimestamp();
await testGroupDescriptorsAndLeaveNotifications();
await testFourMemberFanOut();

console.log("VOICE_G5_6_GROUP_FAN_OUT=PASS");
console.log("VOICE_G5_6_FOUR_MEMBER_DELIVERED_THREE=PASS");
console.log("VOICE_G5_6_PER_LISTENER_MUTE=PASS");
console.log("VOICE_G5_6_NO_DUPLICATE_AUDIO_ROUTE=PASS");
console.log("VOICE_G5_6_GROUP_PUBLISH_STOP_FAN_OUT=PASS");
console.log("VOICE_G5_7_LISTENER_MEDIA_ROUTE_TIMESTAMP=PASS");
console.log("VOICE_G5_7_GROUP_PEER_DESCRIPTOR=PASS");
console.log("VOICE_G5_7_GROUP_MEMBER_LEAVE_NOTIFICATION=PASS");
