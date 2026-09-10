import assert from "node:assert/strict";

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    VoiceDedicatedSessionDeltaService
} from "../dedicated/voiceDedicatedSessionDeltaService.js";

import {
    VoiceMuteRegistry
} from "../mute/voiceMuteRegistry.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceReconnectCoordinator
} from "../reconnect/voiceReconnectCoordinator.js";

import {
    encodeVoiceRecordingConsentPayload
} from "../recording/voiceRecordingPayload.js";

import {
    VoicePacketFlowGuard
} from "../routing/voicePacketFlowGuard.js";

import {
    VoiceRoutingApplication
} from "../routing/voiceRoutingApplication.js";

import {
    decodeVoiceControlAckPayload,
    VoiceControlAckCode
} from "../routing/voiceRoutingControlPayload.js";

import {
    VoiceAuthoritativeSessionService,
    VoiceSessionReason,
    VoiceSessionState
} from "../session/index.js";

const SERVER_ID = "server-g5-live-regression";
const ROOM_ID = "room-g5-live-regression";
const EPOCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const NOW_MS = 1786423000000;

const identities = Object.freeze({
    A: Object.freeze({
        userId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        compactConnectionId: "11111111111141118111111111111111",
        voiceConnectionId: "11111111-1111-4111-8111-111111111111"
    }),
    B: Object.freeze({
        userId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        compactConnectionId: "22222222222242228222222222222222",
        voiceConnectionId: "22222222-2222-4222-8222-222222222222"
    }),
    C: Object.freeze({
        userId: "cccccccc-3333-4333-8333-cccccccccccc",
        compactConnectionId: "33333333333343338333333333333333",
        voiceConnectionId: "33333333-3333-4333-8333-333333333333"
    })
});

function createDeltaEvent({
    type,
    sessionId = SESSION_ID,
    first,
    second,
    member = null,
    sourceSequence,
    reason,
    distanceMeters = 2.0
}) {
    return {
        type,
        authority: "dedicated_server",
        authorityEpochId: EPOCH_ID,
        sourceSequence,
        serverId: SERVER_ID,
        roomId: ROOM_ID,
        sessionId,
        firstUserId: first.userId,
        firstConnectionId: first.compactConnectionId,
        secondUserId: second.userId,
        secondConnectionId: second.compactConnectionId,
        memberUserId: member?.userId ?? "",
        memberConnectionId: member?.compactConnectionId ?? "",
        distanceMeters,
        reason,
        effectiveAtMs: NOW_MS + sourceSequence
    };
}

function createDeltaFixture() {
    const sessionService = new VoiceAuthoritativeSessionService();

    const players = Object.values(identities).map((identity) => ({
        userId: identity.userId,
        connectionId: identity.compactConnectionId,
        isReady: true
    }));

    const voiceConnections = new Map(
        Object.values(identities).map((identity) => [
            identity.userId,
            [{
                userId: identity.userId,
                avatarId: identity.userId,
                roomId: ROOM_ID,
                connectionId: identity.voiceConnectionId,
                state: VoiceConnectionState.ACTIVE
            }]
        ])
    );

    const service = new VoiceDedicatedSessionDeltaService({
        dedicatedServerHandler: {
            verifyDedicatedServerToken: () => ({ success: true })
        },
        gameServerRegistry: {
            hasServer: (serverId) => serverId === SERVER_ID
        },
        gameSessionRegistry: {
            findSessionByRoom: (roomId) => roomId === ROOM_ID
                ? { serverId: SERVER_ID, players }
                : null,
            isPublicSessionOpen: () => true
        },
        voiceConnectionRegistry: {
            listByUserId: (userId) => voiceConnections.get(userId) ?? []
        },
        voiceAuthoritativeSessionService: sessionService
    });

    return { service, sessionService };
}

async function testHyphenatedVoiceConnectionMemberLeave() {
    const fixture = createDeltaFixture();

    const createResult = await fixture.service.acceptBatch({}, {
        serviceToken: "test-token",
        serverId: SERVER_ID,
        authorityEpochId: EPOCH_ID,
        events: [
            createDeltaEvent({
                type: "session_created",
                first: identities.A,
                second: identities.B,
                sourceSequence: 1,
                reason: VoiceSessionReason.PROXIMITY_ENTER
            }),
            createDeltaEvent({
                type: "member_joined",
                first: identities.A,
                second: identities.B,
                member: identities.C,
                sourceSequence: 2,
                reason: VoiceSessionReason.PROXIMITY_ENTER
            })
        ]
    });

    assert.equal(createResult.success, true);
    assert.equal(createResult.data.appliedCount, 2);

    const beforeLeave = fixture.sessionService.sessionRegistry.getBySessionId(SESSION_ID);
    assert.equal(beforeLeave.participants.length, 3);
    assert.equal(
        beforeLeave.participants.some((participant) =>
            participant.connectionId === identities.C.voiceConnectionId),
        true
    );

    const leaveC = await fixture.service.acceptBatch({}, {
        serviceToken: "test-token",
        serverId: SERVER_ID,
        authorityEpochId: EPOCH_ID,
        events: [
            createDeltaEvent({
                type: "member_left",
                first: identities.A,
                second: identities.C,
                member: identities.C,
                sourceSequence: 3,
                reason: VoiceSessionReason.PROXIMITY_EXIT,
                distanceMeters: 4.0
            })
        ]
    });

    assert.equal(leaveC.success, true);
    assert.equal(leaveC.data.appliedCount, 1);
    assert.equal(leaveC.data.ignoredCount, 0);

    const afterCLeave = fixture.sessionService.sessionRegistry.getBySessionId(SESSION_ID);
    assert.equal(afterCLeave.state, VoiceSessionState.ACTIVE);
    assert.equal(afterCLeave.participants.length, 2);
    assert.equal(
        afterCLeave.participants.some((participant) =>
            participant.userId === identities.C.userId),
        false
    );

    const leaveB = await fixture.service.acceptBatch({}, {
        serviceToken: "test-token",
        serverId: SERVER_ID,
        authorityEpochId: EPOCH_ID,
        events: [
            createDeltaEvent({
                type: "member_left",
                first: identities.A,
                second: identities.B,
                member: identities.B,
                sourceSequence: 4,
                reason: VoiceSessionReason.PROXIMITY_EXIT,
                distanceMeters: 4.2
            })
        ]
    });

    assert.equal(leaveB.success, true);
    assert.equal(leaveB.data.appliedCount, 1);

    const closed = fixture.sessionService.sessionRegistry.getBySessionId(SESSION_ID);
    assert.equal(closed.state, VoiceSessionState.CLOSED);

    console.log("VOICE_G5_LIVE_MEMBER_CONNECTION_CANONICALIZATION=PASS");
    console.log("VOICE_G5_LIVE_PAIR_CLOSE_AFTER_GROUP_LEAVE=PASS");
}

function createRoutingFixture({ activeSessions = [] } = {}) {
    const connectionRegistry = new VoiceConnectionRegistry();
    const muteRegistry = new VoiceMuteRegistry();
    const flowGuard = new VoicePacketFlowGuard({ now: () => NOW_MS });
    const sessionRegistry = {
        listActiveByConnectionId: () => activeSessions
    };
    const reconnectCoordinator = {
        handleTransportClosed: () => ({ handled: true }),
        handleConnectionAuthenticated: () => true
    };
    const recordingService = {
        updateConsent: async () => {
            throw new Error("stale consent must not reach recording service");
        },
        captureFrame: () => false
    };

    return new VoiceRoutingApplication({
        voiceConnectionRegistry: connectionRegistry,
        voiceSessionRegistry: sessionRegistry,
        muteRegistry,
        packetFlowGuard: flowGuard,
        reconnectCoordinator,
        recordingService,
        now: () => NOW_MS
    });
}

async function testMemberLeftNotificationUsesResolvedVoiceConnectionId() {
    const routing = createRoutingFixture();
    const sentByConnectionId = new Map();

    routing.setGateway({
        getConnectionByConnectionId: (connectionId) => {
            const normalized = String(connectionId ?? "").trim().toLowerCase();
            if (![
                identities.A.voiceConnectionId,
                identities.B.voiceConnectionId,
                identities.C.voiceConnectionId
            ].includes(normalized)) {
                return null;
            }

            return {
                async sendEnvelope(message) {
                    const messages = sentByConnectionId.get(normalized) ?? [];
                    messages.push(message);
                    sentByConnectionId.set(normalized, messages);
                    return true;
                }
            };
        }
    });

    const remainingSession = {
        sessionId: SESSION_ID,
        state: VoiceSessionState.ACTIVE,
        reason: VoiceSessionReason.PROXIMITY_EXIT,
        distanceMeters: 4.0,
        effectiveAtMs: NOW_MS,
        participants: [
            {
                userId: identities.A.userId,
                avatarId: identities.A.userId,
                connectionId: identities.A.voiceConnectionId
            },
            {
                userId: identities.B.userId,
                avatarId: identities.B.userId,
                connectionId: identities.B.voiceConnectionId
            }
        ]
    };

    await routing.handleDedicatedSessionEvent({
        event: {
            type: "member_left",
            memberConnectionId: identities.C.compactConnectionId
        },
        applyResult: {
            data: {
                resolvedMemberConnectionId: identities.C.voiceConnectionId,
                result: {
                    left: true,
                    closed: false,
                    session: remainingSession
                }
            }
        }
    });

    assert.equal(sentByConnectionId.get(identities.A.voiceConnectionId)?.length, 1);
    assert.equal(sentByConnectionId.get(identities.B.voiceConnectionId)?.length, 1);
    assert.equal(sentByConnectionId.get(identities.C.voiceConnectionId)?.length, 1);
    assert.equal(
        sentByConnectionId.get(identities.A.voiceConnectionId)[0].senderId,
        identities.C.voiceConnectionId
    );
    assert.equal(
        sentByConnectionId.get(identities.C.voiceConnectionId)[0].senderId,
        "00000000-0000-0000-0000-000000000000"
    );

    console.log("VOICE_G5_LIVE_MEMBER_LEFT_NOTIFICATION_CANONICALIZATION=PASS");
}

async function testDistanceUpdateDoesNotEmitMembershipNotification() {
    const routing = createRoutingFixture();
    const sent = [];
    routing.setGateway({
        getConnectionByConnectionId: () => ({
            async sendEnvelope(message) {
                sent.push(message);
            }
        })
    });

    await routing.handleDedicatedSessionEvent({
        event: { type: "distance_updated" },
        applyResult: {
            data: {
                result: {
                    updated: true,
                    session: {
                        sessionId: SESSION_ID,
                        participants: [
                            {
                                userId: identities.A.userId,
                                avatarId: identities.A.userId,
                                connectionId: identities.A.voiceConnectionId
                            },
                            {
                                userId: identities.B.userId,
                                avatarId: identities.B.userId,
                                connectionId: identities.B.voiceConnectionId
                            }
                        ]
                    }
                }
            }
        }
    });

    assert.equal(sent.length, 0);
    console.log("VOICE_G5_LIVE_DISTANCE_UPDATE_NO_SESSION_JOINED_FLOOD=PASS");
}

async function testStaleRecordingConsentIsNonFatal() {
    const routing = createRoutingFixture({ activeSessions: [] });
    const sent = [];
    const transportConnection = {
        connectionId: identities.A.voiceConnectionId,
        async sendEnvelope(message) {
            sent.push({ ...message, payload: Buffer.from(message.payload) });
        }
    };

    const result = await routing.handleRecordingConsentChanged(
        {
            sequence: 77,
            sessionId: SESSION_ID,
            payloadLength: 4,
            payload: encodeVoiceRecordingConsentPayload({ consented: true })
        },
        transportConnection
    );

    assert.equal(result.dropped, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].messageType, VoiceMessageType.ACK);
    assert.equal(
        decodeVoiceControlAckPayload(sent[0].payload).code,
        VoiceControlAckCode.DROPPED
    );

    console.log("VOICE_G5_LIVE_STALE_RECORDING_CONSENT_NON_FATAL=PASS");
}

async function testResumedConnectionBridgesFreshTransportSequence() {
    const registry = new VoiceConnectionRegistry();
    const identity = identities.A;
    const connection = registry.registerAuthenticatedConnection({
        connectionId: identity.voiceConnectionId,
        userId: identity.userId,
        avatarId: identity.userId,
        roomId: ROOM_ID,
        platform: 2,
        clientInstanceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        transportName: "grpc",
        transportConnectionKey: "stream-before",
        createdAtMs: NOW_MS - 1000
    });

    connection.activate(NOW_MS - 900);
    connection.updateSequences({
        lastReceivedSequence: 250,
        lastPublishedSequence: 250
    });
    connection.suspend(NOW_MS - 100);
    connection.resume({
        transportName: "grpc",
        transportConnectionKey: "stream-after",
        resumedAtMs: NOW_MS
    });

    assert.equal(connection.lastReceivedSequence, 250);
    assert.equal(connection.lastPublishedSequence, 250);

    const muteRegistry = new VoiceMuteRegistry();
    const flowGuard = new VoicePacketFlowGuard({ now: () => NOW_MS });
    const routing = new VoiceRoutingApplication({
        voiceConnectionRegistry: registry,
        voiceSessionRegistry: {
            listActiveByConnectionId: () => []
        },
        muteRegistry,
        packetFlowGuard: flowGuard,
        reconnectCoordinator: {
            handleTransportClosed: () => ({ handled: true }),
            handleConnectionAuthenticated: () => true
        },
        now: () => NOW_MS
    });

    routing.publisherSettingsByConnectionId.set(
        identity.voiceConnectionId,
        Object.freeze({ bitrateKbps: 40 })
    );

    await routing.handleAuthenticated({
        transportConnection: {
            connectionId: identity.voiceConnectionId,
            async sendEnvelope() { return true; }
        },
        registrationResult: {
            resumed: true,
            userId: identity.userId,
            roomId: ROOM_ID
        }
    });

    const result = await routing.handleVoiceFrame(
        {
            sequence: 3,
            timestampMs: NOW_MS,
            sessionId: "00000000-0000-0000-0000-000000000000",
            payloadLength: 4,
            payload: Buffer.from([1, 2, 3, 4]),
            flags: 0
        },
        { connectionId: identity.voiceConnectionId }
    );

    assert.equal(result.accepted, true);
    assert.equal(connection.lastReceivedSequence, 251);
    assert.equal(connection.lastPublishedSequence, 251);
    console.log("VOICE_G5_LIVE_RESUME_SEQUENCE_BRIDGE=PASS");
}

await testHyphenatedVoiceConnectionMemberLeave();
await testMemberLeftNotificationUsesResolvedVoiceConnectionId();
await testDistanceUpdateDoesNotEmitMembershipNotification();
await testStaleRecordingConsentIsNonFatal();
await testResumedConnectionBridgesFreshTransportSequence();

console.log("VOICE_G5_LIVE_STATE_REGRESSION=PASS");
