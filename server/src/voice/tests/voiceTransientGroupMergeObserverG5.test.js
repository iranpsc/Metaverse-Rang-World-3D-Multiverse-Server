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
import {
    VoiceSessionReason
} from "../session/voiceSessionConstants.js";

const SERVER_ID = "server-g5-transient-observer";
const ROOM_ID = "room-g5-transient-observer";
const EPOCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_AB = "11111111-1111-4111-8111-111111111111";
const SESSION_AC_TRANSIENT = "22222222-2222-4222-8222-222222222222";

const A = { userId: "user-a", connectionId: "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa" };
const B = { userId: "user-b", connectionId: "bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb" };
const C = { userId: "user-c", connectionId: "cccccccccccc4ccc8ccccccccccccccc" };
const players = [A, B, C].map((participant) => ({ ...participant, isReady: true }));
const connections = new Map([A, B, C].map((participant) => [
    participant.userId,
    [{ ...participant, roomId: ROOM_ID, state: 2 }]
]));
const observed = [];

function event({ type, sessionId, first, second, sourceSequence, reason, member = null, distanceMeters = 2.0 }) {
    return {
        type,
        authority: "dedicated_server",
        authorityEpochId: EPOCH,
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
        effectiveAtMs: 30_000_000 + sourceSequence
    };
}

const registry = new VoiceSessionRegistry();
const service = new VoiceDedicatedSessionDeltaService({
    dedicatedServerHandler: { verifyDedicatedServerToken: () => ({ success: true }) },
    gameServerRegistry: { hasServer: (id) => id === SERVER_ID },
    gameSessionRegistry: {
        findSessionByRoom: (id) => id === ROOM_ID ? { serverId: SERVER_ID, players } : null,
        isPublicSessionOpen: () => true
    },
    voiceConnectionRegistry: { listByUserId: (userId) => connections.get(userId) ?? [] },
    voiceAuthoritativeSessionService: new VoiceAuthoritativeSessionService({ sessionRegistry: registry }),
    eventObserver: async ({ event: observedEvent }) => { observed.push({ type: observedEvent.type, sessionId: observedEvent.sessionId }); }
});

const result = await service.acceptBatch({}, {
    serviceToken: "test-token",
    serverId: SERVER_ID,
    authorityEpochId: EPOCH,
    events: [
        event({
            type: "session_created", sessionId: SESSION_AB, first: A, second: B, sourceSequence: 1,
            reason: VoiceSessionReason.PROXIMITY_ENTER
        }),
        event({
            type: "session_created", sessionId: SESSION_AC_TRANSIENT, first: A, second: C, sourceSequence: 2,
            reason: VoiceSessionReason.PROXIMITY_ENTER
        }),
        event({
            type: "session_closed", sessionId: SESSION_AC_TRANSIENT, first: A, second: C, sourceSequence: 3,
            reason: VoiceSessionReason.SESSION_CLOSED
        }),
        event({
            type: "member_joined", sessionId: SESSION_AB, first: A, second: B, member: C, sourceSequence: 4,
            reason: VoiceSessionReason.PROXIMITY_ENTER
        })
    ]
});

assert.equal(result.success, true);
assert.deepEqual(observed, [
    { type: "session_created", sessionId: SESSION_AB },
    { type: "member_joined", sessionId: SESSION_AB }
]);
assert.equal(registry.getBySessionId(SESSION_AC_TRANSIENT).state, 6);
assert.deepEqual(
    registry.getBySessionId(SESSION_AB).participants.map((participant) => participant.userId).sort(),
    ["user-a", "user-b", "user-c"]
);

console.log("VOICE_G5_TRANSIENT_SECONDARY_OBSERVER_SUPPRESSED=PASS");
console.log("VOICE_G5_STABLE_GROUP_OBSERVER_PRESERVED=PASS");
console.log("VOICE_G5_TRANSIENT_SECONDARY_STILL_BURNED=PASS");
