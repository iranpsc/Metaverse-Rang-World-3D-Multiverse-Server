import assert from "node:assert/strict";

const PairState = Object.freeze({
    ENTERED: "entered",
    EXITED: "exited"
});

const TopologyEventType = Object.freeze({
    PAIR_ENTER: "PAIR_ENTER",
    PAIR_EXIT: "PAIR_EXIT",
    GROUP_MEMBER_JOIN: "GROUP_MEMBER_JOIN",
    GROUP_MEMBER_LEAVE: "GROUP_MEMBER_LEAVE",
    PAIR_SESSION_MERGE_INTO_GROUP: "PAIR_SESSION_MERGE_INTO_GROUP",
    PAIR_SESSION_RECREATE_AFTER_GROUP_LEAVE:
        "PAIR_SESSION_RECREATE_AFTER_GROUP_LEAVE",
    SESSION_CLOSE: "SESSION_CLOSE",
    SESSION_BURN: "SESSION_BURN"
});

function normalizeId(value, fieldName) {
    const normalized =
        typeof value === "string"
            ? value.trim()
            : "";

    assert.notEqual(
        normalized,
        "",
        `${fieldName} is required.`
    );

    return normalized;
}

function buildPairKey(firstUserId, secondUserId) {
    const first =
        normalizeId(firstUserId, "firstUserId");

    const second =
        normalizeId(secondUserId, "secondUserId");

    assert.notEqual(
        first,
        second,
        "A Voice pair requires two different users."
    );

    return first < second
        ? `${first}|${second}`
        : `${second}|${first}`;
}

function compareOrdinal(first, second) {
    if (first === second) return 0;
    return first < second ? -1 : 1;
}

class DynamicGroupTopologyStateModel {
    constructor({ enterDistanceMeters = 3.0 } = {}) {
        assert.ok(
            Number.isFinite(enterDistanceMeters) &&
            enterDistanceMeters > 0,
            "enterDistanceMeters must be greater than zero."
        );

        this.enterDistanceMeters =
            enterDistanceMeters;

        this.pairs =
            new Map();

        this.sessions =
            new Map();

        this.burnedSessionIds =
            new Set();

        this.appliedEventTypes =
            [];
    }

    applyPairEnter(firstUserId, secondUserId, distanceMeters) {
        assert.ok(
            Number.isFinite(distanceMeters) &&
            distanceMeters >= 0,
            "distanceMeters must be a finite non-negative number."
        );

        const pairKey =
            buildPairKey(firstUserId, secondUserId);

        this.pairs.set(
            pairKey,
            Object.freeze({
                state: PairState.ENTERED,
                distanceMeters
            })
        );

        this.appliedEventTypes.push(
            TopologyEventType.PAIR_ENTER
        );
    }

    applyPairExit(firstUserId, secondUserId) {
        const pairKey =
            buildPairKey(firstUserId, secondUserId);

        this.pairs.set(
            pairKey,
            Object.freeze({
                state: PairState.EXITED,
                distanceMeters: null
            })
        );

        this.appliedEventTypes.push(
            TopologyEventType.PAIR_EXIT
        );
    }

    createPairSession(sessionId, firstUserId, secondUserId) {
        const normalizedSessionId =
            normalizeId(sessionId, "sessionId");

        const first =
            normalizeId(firstUserId, "firstUserId");

        const second =
            normalizeId(secondUserId, "secondUserId");

        assert.equal(
            this.sessions.has(normalizedSessionId),
            false,
            "An active Voice session id cannot be reused."
        );

        assert.equal(
            this.burnedSessionIds.has(normalizedSessionId),
            false,
            "A burned Voice session id cannot be reused."
        );

        assert.equal(
            this.isPairEntered(first, second),
            true,
            "A Voice session must start from an entered pair."
        );

        assert.equal(
            this.findSessionContainingPair(first, second),
            null,
            "The same pair cannot exist in two Voice sessions."
        );

        this.sessions.set(
            normalizedSessionId,
            {
                sessionId: normalizedSessionId,
                members: new Set([first, second])
            }
        );

        this.assertInvariants();
    }

    selectJoinTarget({
        candidateUserId,
        previousTargetSessionId = ""
    }) {
        const candidate =
            normalizeId(candidateUserId, "candidateUserId");

        const previousTarget =
            typeof previousTargetSessionId === "string"
                ? previousTargetSessionId.trim()
                : "";

        const eligible = [];

        for (const session of this.sessions.values()) {
            if (session.members.has(candidate)) continue;

            let score = 0;
            let valid = true;

            for (const memberUserId of session.members) {
                const pair =
                    this.getPair(candidate, memberUserId);

                if (pair === null ||
                    pair.state !== PairState.ENTERED ||
                    !Number.isFinite(pair.distanceMeters) ||
                    pair.distanceMeters > this.enterDistanceMeters) {
                    valid = false;
                    break;
                }

                score = Math.max(
                    score,
                    pair.distanceMeters
                );
            }

            if (!valid) continue;

            eligible.push({
                sessionId: session.sessionId,
                score
            });
        }

        if (eligible.length === 0) return null;

        eligible.sort((first, second) => {
            if (first.score !== second.score) {
                return first.score - second.score;
            }

            return compareOrdinal(
                first.sessionId,
                second.sessionId
            );
        });

        const minimumScore =
            eligible[0].score;

        if (previousTarget.length > 0) {
            const preserved =
                eligible.find((candidateSession) =>
                    candidateSession.score === minimumScore &&
                    candidateSession.sessionId === previousTarget
                );

            if (preserved) return preserved;
        }

        return eligible[0];
    }

    mergeMemberIntoSession({
        targetSessionId,
        memberUserId,
        mergedSessionIds = []
    }) {
        const target =
            this.requireSession(targetSessionId);

        const member =
            normalizeId(memberUserId, "memberUserId");

        assert.equal(
            target.members.has(member),
            false,
            "A group member cannot be added twice."
        );

        for (const targetMemberUserId of target.members) {
            const pair =
                this.getPair(member, targetMemberUserId);

            assert.ok(
                pair !== null &&
                pair.state === PairState.ENTERED &&
                Number.isFinite(pair.distanceMeters) &&
                pair.distanceMeters <= this.enterDistanceMeters,
                "A member can join only when close to every current session member."
            );
        }

        const uniqueMergedSessionIds =
            [...new Set(mergedSessionIds.map((value) =>
                normalizeId(value, "mergedSessionId")
            ))];

        for (const mergedSessionId of uniqueMergedSessionIds) {
            assert.notEqual(
                mergedSessionId,
                target.sessionId,
                "The preserved session cannot merge into itself."
            );

            const mergedSession =
                this.requireSession(mergedSessionId);

            assert.equal(
                mergedSession.members.has(member),
                true,
                "A merged pair session must contain the joining member."
            );

            this.closeAndBurnSession(mergedSessionId);
        }

        target.members.add(member);

        if (uniqueMergedSessionIds.length > 0) {
            this.appliedEventTypes.push(
                TopologyEventType.PAIR_SESSION_MERGE_INTO_GROUP
            );
        }

        this.appliedEventTypes.push(
            TopologyEventType.GROUP_MEMBER_JOIN
        );

        this.assertInvariants();
    }

    leaveGroupMember(sessionId, memberUserId) {
        const session =
            this.requireSession(sessionId);

        const member =
            normalizeId(memberUserId, "memberUserId");

        assert.equal(
            session.members.delete(member),
            true,
            "The leaving member must belong to the Voice session."
        );

        this.appliedEventTypes.push(
            TopologyEventType.GROUP_MEMBER_LEAVE
        );

        if (session.members.size < 2) {
            this.closeAndBurnSession(session.sessionId);
        }

        this.assertInvariants();
    }

    recreatePairSessionAfterGroupLeave(
        sessionId,
        firstUserId,
        secondUserId
    ) {
        this.createPairSession(
            sessionId,
            firstUserId,
            secondUserId
        );

        this.appliedEventTypes.push(
            TopologyEventType.PAIR_SESSION_RECREATE_AFTER_GROUP_LEAVE
        );
    }

    closeAndBurnSession(sessionId) {
        const normalizedSessionId =
            normalizeId(sessionId, "sessionId");

        assert.equal(
            this.sessions.delete(normalizedSessionId),
            true,
            "Only an active Voice session can be closed."
        );

        this.burnedSessionIds.add(normalizedSessionId);

        this.appliedEventTypes.push(
            TopologyEventType.SESSION_CLOSE,
            TopologyEventType.SESSION_BURN
        );
    }

    getSessionMembers(sessionId) {
        return [...this.requireSession(sessionId).members]
            .sort(compareOrdinal);
    }

    getPair(firstUserId, secondUserId) {
        return this.pairs.get(
            buildPairKey(firstUserId, secondUserId)
        ) ?? null;
    }

    isPairEntered(firstUserId, secondUserId) {
        return this.getPair(firstUserId, secondUserId)?.state ===
            PairState.ENTERED;
    }

    findSessionContainingPair(firstUserId, secondUserId) {
        const first =
            normalizeId(firstUserId, "firstUserId");

        const second =
            normalizeId(secondUserId, "secondUserId");

        for (const session of this.sessions.values()) {
            if (session.members.has(first) &&
                session.members.has(second)) {
                return session;
            }
        }

        return null;
    }

    requireSession(sessionId) {
        const normalizedSessionId =
            normalizeId(sessionId, "sessionId");

        const session =
            this.sessions.get(normalizedSessionId);

        assert.ok(
            session,
            `Voice session ${normalizedSessionId} is not active.`
        );

        return session;
    }

    assertInvariants() {
        const observedPairs =
            new Set();

        for (const session of this.sessions.values()) {
            assert.ok(
                session.members.size >= 2,
                "An active Voice session must have at least two members."
            );

            assert.equal(
                this.burnedSessionIds.has(session.sessionId),
                false,
                "A burned Voice session cannot remain active."
            );

            const members =
                [...session.members];

            assert.equal(
                new Set(members).size,
                members.length,
                "A Voice session cannot contain a duplicate participant."
            );

            for (let firstIndex = 0;
                 firstIndex < members.length;
                 firstIndex += 1) {
                for (let secondIndex = firstIndex + 1;
                     secondIndex < members.length;
                     secondIndex += 1) {
                    const pairKey =
                        buildPairKey(
                            members[firstIndex],
                            members[secondIndex]
                        );

                    assert.equal(
                        observedPairs.has(pairKey),
                        false,
                        "A Voice pair cannot route through two active sessions."
                    );

                    observedPairs.add(pairKey);
                }
            }
        }
    }
}

function runPairBaselineScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 2.5);
    topology.createPairSession("session-ab", "A", "B");

    assert.deepEqual(
        topology.getSessionMembers("session-ab"),
        ["A", "B"]
    );

    assert.equal(topology.sessions.size, 1);
    assert.equal(topology.burnedSessionIds.size, 0);
}

function runDistanceSelectionScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 1.0);
    topology.applyPairEnter("D", "E", 1.0);
    topology.createPairSession("session-ab", "A", "B");
    topology.createPairSession("session-de", "D", "E");

    topology.applyPairEnter("C", "A", 1.0);
    topology.applyPairEnter("C", "B", 2.8);
    topology.applyPairEnter("C", "D", 1.7);
    topology.applyPairEnter("C", "E", 1.8);

    assert.deepEqual(
        topology.selectJoinTarget({
            candidateUserId: "C"
        }),
        {
            sessionId: "session-de",
            score: 1.8
        }
    );
}

function runTieBreakScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 1.0);
    topology.applyPairEnter("D", "E", 1.0);
    topology.createPairSession("session-10", "A", "B");
    topology.createPairSession("session-20", "D", "E");

    topology.applyPairEnter("C", "A", 1.5);
    topology.applyPairEnter("C", "B", 2.0);
    topology.applyPairEnter("C", "D", 2.0);
    topology.applyPairEnter("C", "E", 1.5);

    assert.equal(
        topology.selectJoinTarget({
            candidateUserId: "C",
            previousTargetSessionId: "session-20"
        }).sessionId,
        "session-20"
    );

    assert.equal(
        topology.selectJoinTarget({
            candidateUserId: "C"
        }).sessionId,
        "session-10"
    );
}

function runPairToGroupAndLeaveScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 2.0);
    topology.createPairSession("session-ab", "A", "B");

    topology.applyPairEnter("A", "C", 2.0);
    topology.createPairSession("session-ac-burned", "A", "C");

    assert.equal(
        topology.selectJoinTarget({
            candidateUserId: "C"
        }),
        null
    );

    topology.applyPairEnter("B", "C", 2.5);

    assert.equal(
        topology.selectJoinTarget({
            candidateUserId: "C"
        }).sessionId,
        "session-ab"
    );

    topology.mergeMemberIntoSession({
        targetSessionId: "session-ab",
        memberUserId: "C",
        mergedSessionIds: ["session-ac-burned"]
    });

    assert.deepEqual(
        topology.getSessionMembers("session-ab"),
        ["A", "B", "C"]
    );

    assert.equal(
        topology.burnedSessionIds.has("session-ac-burned"),
        true
    );

    topology.applyPairExit("B", "C");
    topology.leaveGroupMember("session-ab", "C");

    assert.deepEqual(
        topology.getSessionMembers("session-ab"),
        ["A", "B"]
    );

    topology.recreatePairSessionAfterGroupLeave(
        "session-ac-recreated",
        "A",
        "C"
    );

    assert.deepEqual(
        topology.getSessionMembers("session-ac-recreated"),
        ["A", "C"]
    );

    assert.throws(
        () => topology.createPairSession(
            "session-ac-burned",
            "A",
            "C"
        ),
        /burned/
    );

    assert.deepEqual(
        new Set(topology.appliedEventTypes),
        new Set(Object.values(TopologyEventType))
    );
}

function runIneligibleJoinScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 2.0);
    topology.createPairSession("session-ab", "A", "B");
    topology.applyPairEnter("A", "C", 1.0);
    topology.applyPairEnter("B", "C", 3.01);

    assert.equal(
        topology.selectJoinTarget({
            candidateUserId: "C"
        }),
        null
    );
}

function runNoDuplicateMemberScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 1.0);
    topology.applyPairEnter("A", "C", 1.0);
    topology.applyPairEnter("B", "C", 1.0);
    topology.createPairSession("session-ab", "A", "B");
    topology.mergeMemberIntoSession({
        targetSessionId: "session-ab",
        memberUserId: "C"
    });

    assert.throws(
        () => topology.mergeMemberIntoSession({
            targetSessionId: "session-ab",
            memberUserId: "C"
        }),
        /cannot be added twice/
    );
}

function runSessionCloseAndBurnScenario() {
    const topology =
        new DynamicGroupTopologyStateModel();

    topology.applyPairEnter("A", "B", 1.0);
    topology.createPairSession("session-ab", "A", "B");
    topology.leaveGroupMember("session-ab", "B");

    assert.equal(topology.sessions.size, 0);
    assert.equal(
        topology.burnedSessionIds.has("session-ab"),
        true
    );
}

runPairBaselineScenario();
runDistanceSelectionScenario();
runTieBreakScenario();
runPairToGroupAndLeaveScenario();
runIneligibleJoinScenario();
runNoDuplicateMemberScenario();
runSessionCloseAndBurnScenario();

console.log("VOICE_G5_2_DYNAMIC_TOPOLOGY_STATE_MODEL=PASS");
console.log("VOICE_G5_2_DISTANCE_SELECTION_MIN_MAX=PASS");
console.log("VOICE_G5_2_STABLE_SESSION_ID_AND_BURN=PASS");
console.log("VOICE_G5_2_PAIR_BASELINE_INVARIANT=PASS");
