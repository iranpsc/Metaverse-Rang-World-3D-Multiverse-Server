// File: src/voice/tests/voiceSessionContract.test.js

import assert from "node:assert/strict";

import {
    VoiceMessageDirection,
    VoicePayloadKind,
    getVoiceMessageRule
} from "../protocol/voiceMessageRules.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceProximityDecision,
    VoiceSessionReason,
    VoiceSessionState
} from "../session/voiceSessionConstants.js";

import {
    VoiceSessionMembershipPolicy,
    createCanonicalVoiceParticipantPairKey,
    evaluateVoiceProximityCandidate
} from "../session/voiceSessionPolicy.js";

import {
    decodeVoiceSessionDescriptor,
    decodeVoiceSessionSnapshot,
    encodeVoiceSessionDescriptor,
    encodeVoiceSessionSnapshot
} from "../session/voiceSessionPayload.js";

const sessionIdA =
    "123e4567-e89b-12d3-a456-426614174000";

const sessionIdB =
    "223e4567-e89b-12d3-a456-426614174000";

const peerUserIdA =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const peerUserIdB =
    "f0c9c153-211a-4a56-ac5a-7ae31da64cc9";

assert.equal(
    VoiceSessionMembershipPolicy.topology,
    "authoritative_pair_edge"
);

assert.equal(
    VoiceSessionMembershipPolicy.nonTransitiveAudibility,
    true
);

assert.equal(
    VoiceSessionMembershipPolicy.maxParticipantsPerSession,
    2
);

assert.equal(
    VoiceSessionMembershipPolicy.participantCanJoinMultipleSessions,
    true
);

assert.equal(
    VoiceSessionMembershipPolicy.sessionIdAuthority,
    "server"
);

assert.equal(
    VoiceSessionMembershipPolicy.clientCanChooseSessionId,
    false
);

assert.equal(
    VoiceSessionMembershipPolicy.enterDistanceMeters,
    3
);

assert.equal(
    VoiceSessionMembershipPolicy.exitDistanceMeters,
    3.5
);

assert.equal(
    VoiceSessionMembershipPolicy.stabilityConfirmationRequired,
    true
);

assert.equal(
    VoiceSessionMembershipPolicy.stabilityDelayMs,
    null
);

const pairKeyForward =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_a",
        "connection_a",
        "user_b",
        "connection_b"
    );

const pairKeyReverse =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_b",
        "connection_b",
        "user_a",
        "connection_a"
    );

assert.equal(pairKeyForward, pairKeyReverse);

const pairKeyAfterReconnect =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_a",
        "connection_a_new",
        "user_b",
        "connection_b"
    );

assert.notEqual(
    pairKeyForward,
    pairKeyAfterReconnect
);

const pairKeyOtherRoom =
    createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_b",
        "user_a",
        "connection_a",
        "user_b",
        "connection_b"
    );

assert.notEqual(
    pairKeyForward,
    pairKeyOtherRoom
);

assert.throws(
    () => createCanonicalVoiceParticipantPairKey(
        "server_a",
        "room_a",
        "user_a",
        "connection_a",
        "user_a",
        "connection_b"
    ),
    /two different userId values/
);

const enterCandidate =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: false,
        distanceMeters: 3
    });

assert.equal(
    enterCandidate.decision,
    VoiceProximityDecision.ENTER_CANDIDATE
);

assert.equal(
    enterCandidate.reason,
    VoiceSessionReason.PROXIMITY_ENTER
);

assert.equal(
    enterCandidate.requiresStabilityConfirmation,
    true
);

const outsideEnterRange =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: false,
        distanceMeters: 3.01
    });

assert.equal(
    outsideEnterRange.decision,
    VoiceProximityDecision.KEEP_CURRENT_STATE
);

const insideHysteresis =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: true,
        distanceMeters: 3.49
    });

assert.equal(
    insideHysteresis.decision,
    VoiceProximityDecision.KEEP_CURRENT_STATE
);

const exitCandidate =
    evaluateVoiceProximityCandidate({
        isCurrentlyMember: true,
        distanceMeters: 3.5
    });

assert.equal(
    exitCandidate.decision,
    VoiceProximityDecision.EXIT_CANDIDATE
);

assert.equal(
    exitCandidate.reason,
    VoiceSessionReason.PROXIMITY_EXIT
);

const descriptorPayload =
    encodeVoiceSessionDescriptor({
        sessionId: sessionIdA,
        state: VoiceSessionState.ACTIVE,
        reason: VoiceSessionReason.PROXIMITY_ENTER,
        distanceMeters: 2.875,
        effectiveAtMs: 1785300000123n,
        peerUserId: peerUserIdA,
        peerAvatarId: "avatar_peer_a"
    });

const descriptor =
    decodeVoiceSessionDescriptor(descriptorPayload);

assert.equal(descriptor.sessionId, sessionIdA);
assert.equal(descriptor.state, VoiceSessionState.ACTIVE);
assert.equal(
    descriptor.reason,
    VoiceSessionReason.PROXIMITY_ENTER
);
assert.equal(descriptor.distanceMeters, 2.875);
assert.equal(descriptor.effectiveAtMs, 1785300000123n);
assert.equal(descriptor.peerUserId, peerUserIdA);
assert.equal(descriptor.peerAvatarId, "avatar_peer_a");

const unknownDistancePayload =
    encodeVoiceSessionDescriptor({
        sessionId: sessionIdB,
        state: VoiceSessionState.SUSPENDED,
        reason: VoiceSessionReason.VOICE_DISCONNECTED,
        distanceMeters: null,
        effectiveAtMs: 1785300001123n,
        peerUserId: peerUserIdB,
        peerAvatarId: "avatar_peer_b"
    });

const unknownDistanceDescriptor =
    decodeVoiceSessionDescriptor(
        unknownDistancePayload
    );

assert.equal(
    unknownDistanceDescriptor.distanceMeters,
    null
);

const snapshotPayload =
    encodeVoiceSessionSnapshot({
        sessions: [
            {
                sessionId: sessionIdA,
                state: VoiceSessionState.ACTIVE,
                reason: VoiceSessionReason.NONE,
                distanceMeters: 2.5,
                effectiveAtMs: 1785300002123n,
                peerUserId: peerUserIdA,
                peerAvatarId: "avatar_peer_a"
            },
            {
                sessionId: sessionIdB,
                state: VoiceSessionState.ACTIVE,
                reason: VoiceSessionReason.NONE,
                distanceMeters: 1.75,
                effectiveAtMs: 1785300003123n,
                peerUserId: peerUserIdB,
                peerAvatarId: "avatar_peer_b"
            }
        ]
    });

const snapshot =
    decodeVoiceSessionSnapshot(snapshotPayload);

assert.equal(snapshot.entryCount, 2);
assert.equal(snapshot.sessions.length, 2);
assert.equal(snapshot.sessions[0].sessionId, sessionIdA);
assert.equal(snapshot.sessions[1].sessionId, sessionIdB);
assert.equal(
    snapshot.sessions[0].peerAvatarId,
    "avatar_peer_a"
);
assert.equal(
    snapshot.sessions[1].peerAvatarId,
    "avatar_peer_b"
);

const snapshotRule =
    getVoiceMessageRule(
        VoiceMessageType.SESSION_SNAPSHOT
    );

assert.equal(
    snapshotRule.direction,
    VoiceMessageDirection.SERVER_TO_CLIENT
);

assert.equal(
    snapshotRule.payloadKind,
    VoicePayloadKind.CONTROL_BINARY
);

const joinedRule =
    getVoiceMessageRule(
        VoiceMessageType.SESSION_JOINED
    );

assert.equal(
    joinedRule.direction,
    VoiceMessageDirection.SERVER_TO_CLIENT
);

assert.throws(
    () => evaluateVoiceProximityCandidate({
        isCurrentlyMember: false,
        distanceMeters: -1
    }),
    /finite non-negative number/
);

assert.throws(
    () => encodeVoiceSessionDescriptor({
        sessionId: sessionIdA,
        state: 99,
        reason: VoiceSessionReason.NONE,
        peerUserId: peerUserIdA,
        peerAvatarId: "avatar_peer_a"
    }),
    /Unknown Voice session state/
);

assert.throws(
    () => decodeVoiceSessionDescriptor(
        descriptorPayload.subarray(
            0,
            descriptorPayload.length - 1
        )
    ),
    /length mismatch/
);

const snapshotWithTrailingByte =
    Buffer.concat([
        snapshotPayload,
        Buffer.from([0x00])
    ]);

assert.throws(
    () => decodeVoiceSessionSnapshot(
        snapshotWithTrailingByte
    ),
    /trailing bytes/
);

console.log("VOICE_V1_5_SESSION_CONTRACT_TEST=OK");
