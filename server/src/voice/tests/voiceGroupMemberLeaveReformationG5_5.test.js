import assert from "node:assert/strict";

import {
    VoiceDedicatedSessionDeltaService
} from "../dedicated/voiceDedicatedSessionDeltaService.js";

import {
    VoiceAuthoritativeSessionService
} from "../session/voiceAuthoritativeSessionService.js";

import {
    VoiceSessionReason,
    VoiceSessionState
} from "../session/voiceSessionConstants.js";

import {
    VoiceSessionRegistry
} from "../session/voiceSessionRegistry.js";

const SERVER_ID = "server-g5-5";
const ROOM_ID = "room-g5-5";
const AUTHORITY_EPOCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_AB = "11111111-1111-4111-8111-111111111111";
const SESSION_AC_BURNED = "22222222-2222-4222-8222-222222222222";
const SESSION_AC_REFORMED = "33333333-3333-4333-8333-333333333333";
const SESSION_DE = "44444444-4444-4444-8444-444444444444";

const participants = Object.freeze({
    A: Object.freeze({
        userId: "user-a",
        connectionId: "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa"
    }),
    B: Object.freeze({
        userId: "user-b",
        connectionId: "bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"
    }),
    C: Object.freeze({
        userId: "user-c",
        connectionId: "cccccccccccc4ccc8ccccccccccccccc"
    }),
    D: Object.freeze({
        userId: "user-d",
        connectionId: "dddddddddddd4ddd8ddddddddddddddd"
    }),
    E: Object.freeze({
        userId: "user-e",
        connectionId: "eeeeeeeeeeee4eee8eeeeeeeeeeeeeee"
    })
});

function createEvent({
    type,
    sessionId,
    first,
    second,
    sourceSequence,
    reason,
    distanceMeters,
    member = null
}) {
    return {
        type,
        authority: "dedicated_server",
        authorityEpochId: AUTHORITY_EPOCH_ID,
        sourceSequence,
        serverId: SERVER_ID,
        roomId: ROOM_ID,
        sessionId,
        firstUserId: first.userId,
        firstConnectionId: first.connectionId,
        secondUserId: second.userId,
        secondConnectionId: second.connectionId,
        memberUserId: member?.userId ?? "",
        memberConnectionId: member?.connectionId ?? "",
        distanceMeters,
        reason,
        effectiveAtMs: 1786001000000 + sourceSequence
    };
}

function createServiceFixture() {
    const sessionRegistry =
        new VoiceSessionRegistry();

    const authoritativeSessionService =
        new VoiceAuthoritativeSessionService({
            sessionRegistry
        });

    const players =
        Object.values(participants).map(
            (participant) => ({
                ...participant,
                isReady: true
            })
        );

    const activeConnectionsByUserId =
        new Map(
            Object.values(participants).map(
                (participant) => [
                    participant.userId,
                    [
                        {
                            ...participant,
                            roomId: ROOM_ID,
                            state: 2
                        }
                    ]
                ]
            )
        );

    const deltaService =
        new VoiceDedicatedSessionDeltaService({
            dedicatedServerHandler: {
                verifyDedicatedServerToken: () => ({
                    success: true
                })
            },
            gameServerRegistry: {
                hasServer: (serverId) =>
                    serverId === SERVER_ID
            },
            gameSessionRegistry: {
                findSessionByRoom: (roomId) =>
                    roomId === ROOM_ID
                        ? {
                            serverId: SERVER_ID,
                            players
                        }
                        : null,
                isPublicSessionOpen: () => true
            },
            voiceConnectionRegistry: {
                listByUserId: (userId) =>
                    activeConnectionsByUserId.get(userId) ?? []
            },
            voiceAuthoritativeSessionService:
                authoritativeSessionService
        });

    return {
        deltaService,
        sessionRegistry
    };
}

function assertPairSession(
    sessionRegistry,
    first,
    second,
    expectedSessionId
) {
    assert.equal(
        sessionRegistry
            .getActiveByAvatarPair(
                SERVER_ID,
                ROOM_ID,
                first.userId,
                first.connectionId,
                second.userId,
                second.connectionId
            )
            ?.sessionId ??
            null,
        expectedSessionId
    );
}

async function runGroupLeaveAndPairReformationScenario() {
    const fixture =
        createServiceFixture();

    const mergeResult =
        await fixture.deltaService.acceptBatch(
            {},
            {
                serviceToken: "test-token",
                serverId: SERVER_ID,
                authorityEpochId: AUTHORITY_EPOCH_ID,
                events: [
                    createEvent({
                        type: "session_created",
                        sessionId: SESSION_AB,
                        first: participants.A,
                        second: participants.B,
                        sourceSequence: 1,
                        reason: VoiceSessionReason.PROXIMITY_ENTER,
                        distanceMeters: 2.0
                    }),
                    createEvent({
                        type: "session_created",
                        sessionId: SESSION_AC_BURNED,
                        first: participants.A,
                        second: participants.C,
                        sourceSequence: 2,
                        reason: VoiceSessionReason.PROXIMITY_ENTER,
                        distanceMeters: 1.5
                    }),
                    createEvent({
                        type: "session_closed",
                        sessionId: SESSION_AC_BURNED,
                        first: participants.A,
                        second: participants.C,
                        sourceSequence: 3,
                        reason: VoiceSessionReason.SESSION_CLOSED,
                        distanceMeters: 1.5
                    }),
                    createEvent({
                        type: "member_joined",
                        sessionId: SESSION_AB,
                        first: participants.A,
                        second: participants.B,
                        member: participants.C,
                        sourceSequence: 4,
                        reason: VoiceSessionReason.PROXIMITY_ENTER,
                        distanceMeters: 2.5
                    })
                ]
            }
        );

    assert.equal(mergeResult.success, true);
    assert.equal(mergeResult.data.appliedCount, 4);

    const leaveResult =
        await fixture.deltaService.acceptBatch(
            {},
            {
                serviceToken: "test-token",
                serverId: SERVER_ID,
                authorityEpochId: AUTHORITY_EPOCH_ID,
                events: [
                    createEvent({
                        type: "member_left",
                        sessionId: SESSION_AB,
                        first: participants.B,
                        second: participants.C,
                        member: participants.C,
                        sourceSequence: 5,
                        reason: VoiceSessionReason.PROXIMITY_EXIT,
                        distanceMeters: 3.6
                    })
                ]
            }
        );

    assert.equal(leaveResult.success, true);
    assert.equal(leaveResult.data.appliedCount, 1);

    const stablePairSession =
        fixture.sessionRegistry.getBySessionId(
            SESSION_AB
        );

    assert.equal(
        stablePairSession.state,
        VoiceSessionState.ACTIVE
    );
    assert.deepEqual(
        stablePairSession.participants.map(
            (participant) => participant.userId
        ),
        ["user-a", "user-b"]
    );
    assertPairSession(
        fixture.sessionRegistry,
        participants.A,
        participants.B,
        SESSION_AB
    );
    assertPairSession(
        fixture.sessionRegistry,
        participants.A,
        participants.C,
        null
    );
    assertPairSession(
        fixture.sessionRegistry,
        participants.B,
        participants.C,
        null
    );
    assert.equal(
        fixture.sessionRegistry
            .listActiveByConnectionId(
                participants.C.connectionId
            ).length,
        0
    );

    const reformationResult =
        await fixture.deltaService.acceptBatch(
            {},
            {
                serviceToken: "test-token",
                serverId: SERVER_ID,
                authorityEpochId: AUTHORITY_EPOCH_ID,
                events: [
                    createEvent({
                        type: "session_created",
                        sessionId: SESSION_AC_REFORMED,
                        first: participants.A,
                        second: participants.C,
                        sourceSequence: 6,
                        reason: VoiceSessionReason.PROXIMITY_ENTER,
                        distanceMeters: 2.7
                    })
                ]
            }
        );

    assert.equal(reformationResult.success, true);
    assert.equal(reformationResult.data.appliedCount, 1);
    assertPairSession(
        fixture.sessionRegistry,
        participants.A,
        participants.B,
        SESSION_AB
    );
    assertPairSession(
        fixture.sessionRegistry,
        participants.A,
        participants.C,
        SESSION_AC_REFORMED
    );
    assert.equal(
        fixture.sessionRegistry
            .listActiveByConnectionId(
                participants.A.connectionId
            ).length,
        2
    );
}

async function runPairBaselineLeaveScenario() {
    const fixture =
        createServiceFixture();

    const result =
        await fixture.deltaService.acceptBatch(
            {},
            {
                serviceToken: "test-token",
                serverId: SERVER_ID,
                authorityEpochId: AUTHORITY_EPOCH_ID,
                events: [
                    createEvent({
                        type: "session_created",
                        sessionId: SESSION_DE,
                        first: participants.D,
                        second: participants.E,
                        sourceSequence: 1,
                        reason: VoiceSessionReason.PROXIMITY_ENTER,
                        distanceMeters: 2.0
                    }),
                    createEvent({
                        type: "member_left",
                        sessionId: SESSION_DE,
                        first: participants.D,
                        second: participants.E,
                        member: participants.E,
                        sourceSequence: 2,
                        reason: VoiceSessionReason.PROXIMITY_EXIT,
                        distanceMeters: 3.6
                    })
                ]
            }
        );

    assert.equal(result.success, true);
    assert.equal(result.data.appliedCount, 2);
    assert.equal(
        fixture.sessionRegistry
            .getBySessionId(SESSION_DE)
            .state,
        VoiceSessionState.CLOSED
    );
    assert.equal(
        fixture.sessionRegistry
            .burnedSessionIds
            .has(SESSION_DE),
        true
    );
}

function runAnchorMemberLeaveScenario() {
    const registry =
        new VoiceSessionRegistry();

    const asRegistryParticipant =
        (participant) => ({
            ...participant,
            avatarId: participant.userId
        });

    registry.createPairSession({
        sessionId: SESSION_AB,
        roomId: ROOM_ID,
        serverId: SERVER_ID,
        firstParticipant:
            asRegistryParticipant(participants.A),
        secondParticipant:
            asRegistryParticipant(participants.B),
        distanceMeters: 2.0,
        effectiveAtMs: 1786001000100
    });

    registry.addParticipant(
        SESSION_AB,
        {
            participant:
                asRegistryParticipant(participants.C),
            effectiveAtMs: 1786001000200
        }
    );

    const result =
        registry.removeParticipant(
            SESSION_AB,
            {
                participant:
                    asRegistryParticipant(participants.A),
                reason:
                    VoiceSessionReason.PROXIMITY_EXIT,
                effectiveAtMs: 1786001000300
            }
        );

    assert.equal(result.left, true);
    assert.equal(result.closed, false);
    assert.deepEqual(
        result.session.participants.map(
            (participant) => participant.userId
        ),
        ["user-b", "user-c"]
    );
    assertPairSession(
        registry,
        participants.B,
        participants.C,
        SESSION_AB
    );
    assertPairSession(
        registry,
        participants.A,
        participants.B,
        null
    );
    assertPairSession(
        registry,
        participants.A,
        participants.C,
        null
    );
}

await runGroupLeaveAndPairReformationScenario();
await runPairBaselineLeaveScenario();
runAnchorMemberLeaveScenario();

console.log("VOICE_G5_5_GROUP_MEMBER_LEAVE=PASS");
console.log("VOICE_G5_5_STABLE_REMAINING_SESSION=PASS");
console.log("VOICE_G5_5_PAIR_REFORMATION=PASS");
console.log("VOICE_G5_5_PAIR_BASELINE_LEAVE=PASS");
