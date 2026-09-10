import assert from "node:assert/strict";

import {
    VoiceDedicatedSessionDeltaService
} from "../dedicated/voiceDedicatedSessionDeltaService.js";

import {
    VoiceAuthoritativeSessionService
} from "../session/voiceAuthoritativeSessionService.js";

import {
    VoiceSessionRegistry
} from "../session/voiceSessionRegistry.js";

const SERVER_ID = "server-g5-4";
const ROOM_ID = "room-g5-4";
const AUTHORITY_EPOCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_AB = "11111111-1111-4111-8111-111111111111";
const SESSION_AC = "22222222-2222-4222-8222-222222222222";

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
        effectiveAtMs: 1786000000000 + sourceSequence
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
                hasServer: (serverId) => serverId === SERVER_ID
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

const fixture =
    createServiceFixture();

const batchResult =
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
                    reason: 1,
                    distanceMeters: 2.0
                }),
                createEvent({
                    type: "session_created",
                    sessionId: SESSION_AC,
                    first: participants.A,
                    second: participants.C,
                    sourceSequence: 2,
                    reason: 1,
                    distanceMeters: 1.5
                }),
                createEvent({
                    type: "session_closed",
                    sessionId: SESSION_AC,
                    first: participants.A,
                    second: participants.C,
                    sourceSequence: 3,
                    reason: 8,
                    distanceMeters: 1.5
                }),
                createEvent({
                    type: "member_joined",
                    sessionId: SESSION_AB,
                    first: participants.A,
                    second: participants.B,
                    member: participants.C,
                    sourceSequence: 4,
                    reason: 1,
                    distanceMeters: 2.25
                })
            ]
        }
    );

assert.equal(batchResult.success, true);
assert.equal(batchResult.data.appliedCount, 4);

const stableSession =
    fixture.sessionRegistry.getBySessionId(
        SESSION_AB
    );

assert.equal(stableSession.sessionId, SESSION_AB);
assert.deepEqual(
    stableSession.participants
        .map((participant) => participant.userId)
        .sort(),
    ["user-a", "user-b", "user-c"]
);

const burnedSecondary =
    fixture.sessionRegistry.getBySessionId(
        SESSION_AC
    );

assert.equal(burnedSecondary.state, 6);
assert.equal(
    fixture.sessionRegistry.burnedSessionIds.has(
        SESSION_AC
    ),
    true
);

for (const [first, second] of [
    [participants.A, participants.B],
    [participants.A, participants.C],
    [participants.B, participants.C]
]) {
    assert.equal(
        fixture.sessionRegistry
            .getActiveByAvatarPair(
                SERVER_ID,
                ROOM_ID,
                first.userId,
                first.connectionId,
                second.userId,
                second.connectionId
            )
            ?.sessionId,
        SESSION_AB
    );
}

assert.throws(
    () => fixture.sessionRegistry.createPairSession({
        sessionId: SESSION_AC,
        roomId: ROOM_ID,
        serverId: SERVER_ID,
        firstParticipant: {
            ...participants.A,
            avatarId: participants.A.userId
        },
        secondParticipant: {
            ...participants.C,
            avatarId: participants.C.userId
        },
        distanceMeters: 1.0,
        effectiveAtMs: 1786000001000
    }),
    /already registered|burned/i
);

console.log("VOICE_G5_4_STABLE_SESSION_IDENTITY=PASS");
console.log("VOICE_G5_4_PAIR_TO_GROUP_MERGE=PASS");
console.log("VOICE_G5_4_SECONDARY_SESSION_BURN=PASS");
console.log("VOICE_G5_4_GROUP_PAIR_INDEX=PASS");
