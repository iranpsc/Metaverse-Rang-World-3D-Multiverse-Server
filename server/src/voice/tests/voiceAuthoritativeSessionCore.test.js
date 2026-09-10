// مسیر فایل: src/voice/tests/voiceAuthoritativeSessionCore.test.js

import assert from "node:assert/strict";

import {
    randomUUID
} from "node:crypto";

import {
    VoiceAuthoritativeSessionEventType,
    VoiceAuthoritativeSessionService,
    VoiceSessionReason,
    VoiceSessionState
} from "../session/index.js";

//* این تابع اطلاعات یک عضو آزمایشی را با شناسه‌های مشخص می‌سازد.
function createParticipant(
    label
) {
    const userId =
        `user-${label}`;

    return Object.freeze({
        connectionId:
            `connection-${label}`,

        userId:
            userId,

        avatarId:
            userId
    });
}

//* این تابع رویداد ایجاد سشن قطعی را برای دو عضو آزمایشی می‌سازد.
function createSessionCreatedEvent({
    sessionId = randomUUID(),
    firstParticipant,
    secondParticipant,
    distanceMeters,
    effectiveAtMs
} = {}) {
    return Object.freeze({
        type:
            VoiceAuthoritativeSessionEventType
                .SESSION_CREATED,

        authority:
            "dedicated_server",

        sessionId,

        roomId:
            "room-main",

        serverId:
            "dedicated-main",

        firstParticipant,
        secondParticipant,
        distanceMeters,
        effectiveAtMs
    });
}

const participantA =
    createParticipant("a");

const participantB =
    createParticipant("b");

const participantC =
    createParticipant("c");

const service =
    new VoiceAuthoritativeSessionService();

const sessionIdAB =
    randomUUID();

const sessionIdBC =
    randomUUID();

const createAB =
    service.applyEvent(
        createSessionCreatedEvent({
            sessionId:
                sessionIdAB,

            firstParticipant:
                participantA,

            secondParticipant:
                participantB,

            distanceMeters:
                2.75,

            effectiveAtMs:
                1000
        })
    );

assert.equal(
    createAB.created,
    true
);

assert.equal(
    createAB.session.state,
    VoiceSessionState.ACTIVE
);

const duplicateAB =
    service.applyEvent(
        createSessionCreatedEvent({
            sessionId:
                sessionIdAB,

            firstParticipant:
                participantA,

            secondParticipant:
                participantB,

            distanceMeters:
                2.75,

            effectiveAtMs:
                1000
        })
    );

assert.equal(
    duplicateAB.idempotent,
    true
);

const createBC =
    service.applyEvent(
        createSessionCreatedEvent({
            sessionId:
                sessionIdBC,

            firstParticipant:
                participantB,

            secondParticipant:
                participantC,

            distanceMeters:
                2.25,

            effectiveAtMs:
                1100
        })
    );

assert.equal(
    createBC.created,
    true
);

assert.equal(
    service.sessionRegistry
        .listActiveByConnectionId(
            participantA.connectionId
        ).length,
    1
);

assert.equal(
    service.sessionRegistry
        .listActiveByConnectionId(
            participantB.connectionId
        ).length,
    2
);

assert.equal(
    service.sessionRegistry
        .listActiveByConnectionId(
            participantC.connectionId
        ).length,
    1
);

assert.equal(
    service.sessionRegistry
        .getActiveByAvatarPair(
            "dedicated-main",
            "room-main",
            participantA.userId,
            participantA.connectionId,
            participantC.userId,
            participantC.connectionId
        ),
    null
);

const updatedAB =
    service.applyEvent({
        type:
            VoiceAuthoritativeSessionEventType
                .DISTANCE_UPDATED,

        authority:
            "dedicated_server",

        sessionId:
            sessionIdAB,

        distanceMeters:
            3.2,

        effectiveAtMs:
            1200
    });

assert.equal(
    updatedAB.updated,
    true
);

assert.equal(
    updatedAB.session.distanceMeters,
    3.2
);

const closeAB =
    service.applyEvent({
        type:
            VoiceAuthoritativeSessionEventType
                .MEMBER_LEFT,

        authority:
            "dedicated_server",

        sessionId:
            sessionIdAB,

        reason:
            VoiceSessionReason
                .PROXIMITY_EXIT,

        effectiveAtMs:
            1300
    });

assert.equal(
    closeAB.closed,
    true
);

assert.equal(
    closeAB.session.state,
    VoiceSessionState.CLOSED
);

assert.equal(
    service.sessionRegistry
        .listActiveByConnectionId(
            participantB.connectionId
        ).length,
    1
);

assert.throws(
    () =>
        service.applyEvent(
            createSessionCreatedEvent({
                sessionId:
                    sessionIdAB,

                firstParticipant:
                    participantA,

                secondParticipant:
                    participantB,

                distanceMeters:
                    2.5,

                effectiveAtMs:
                    1400
            })
        ),
    /burned|already registered/
);

const cleanupB =
    service.cleanupConnection(
        participantB.connectionId,
        {
            effectiveAtMs:
                1500
        }
    );

assert.equal(
    cleanupB.length,
    1
);

assert.equal(
    cleanupB[0].sessionId,
    sessionIdBC
);

assert.deepEqual(
    service.getStats(),
    {
        total: 2,
        active: 0,
        closed: 2,
        activePairs: 0,
        indexedConnections: 0,
        burnedSessionIds: 2
    }
);

assert.throws(
    () =>
        service.applyEvent({
            type:
                VoiceAuthoritativeSessionEventType
                    .SESSION_CREATED,

            authority:
                "client",

            sessionId:
                randomUUID(),

            roomId:
                "room-main",

            serverId:
                "dedicated-main",

            firstParticipant:
                participantA,

            secondParticipant:
                participantC,

            distanceMeters:
                2,

            effectiveAtMs:
                1600
        }),
    /authority must be dedicated_server/
);

console.log(
    "VOICE_V3_AUTHORITATIVE_PAIR_SESSION_CORE=OK"
);

console.log(
    "VOICE_V3_NON_TRANSITIVE_GRAPH_A_B_B_C=PASS"
);

console.log(
    "VOICE_V3_SESSION_CLEANUP=PASS"
);

console.log(
    "VOICE_V3_BURNED_SESSION_ID_GUARD=PASS"
);

/*
توضیح فایل:
این فایل سناریوی سه کاربر آ، ب و ج را بدون صوت واقعی بررسی می‌کند. سشن آ-ب و ب-ج هم‌زمان ساخته می‌شوند، آ و ج سشن مستقیم ندارند، خروج آ از محدوده فقط سشن آ-ب را می‌بندد و قطع ب سشن باقی‌مانده را پاک می‌کند.
*/
