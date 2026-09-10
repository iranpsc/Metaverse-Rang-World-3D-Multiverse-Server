import assert from "node:assert/strict";

import {
    mkdtemp,
    readFile,
    stat
} from "node:fs/promises";

import {
    tmpdir
} from "node:os";

import {
    join
} from "node:path";

import {
    createVoiceV5RuntimeServices
} from "../bootstrap/createVoiceV5RuntimeServices.js";

import {
    VoiceRecordingState
} from "../recording/voiceRecordingConstants.js";

import {
    VoiceRecordingDownloadService
} from "../recording/voiceRecordingDownloadService.js";

const participants = Object.freeze({
    A: Object.freeze({
        userId:
            "11111111-1111-4111-8111-111111111111",
        connectionId:
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }),
    B: Object.freeze({
        userId:
            "22222222-2222-4222-8222-222222222222",
        connectionId:
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    }),
    C: Object.freeze({
        userId:
            "33333333-3333-4333-8333-333333333333",
        connectionId:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    })
});

const SESSION_ID =
    "770e8400-e29b-41d4-a716-446655440000";

function createSession(activeParticipants) {
    return Object.freeze({
        sessionId: SESSION_ID,
        roomId: "room-recording-g5-8",
        serverId: "dedicated-recording-g5-8",
        participants:
            Object.freeze(
                activeParticipants.map(
                    (participant) =>
                        Object.freeze({ ...participant })
                )
            )
    });
}

function createApplyResult(session, extra = {}) {
    return {
        data: {
            result: {
                ...extra,
                session
            }
        }
    };
}

const sessionAB =
    createSession([
        participants.A,
        participants.B
    ]);

const sessionABC =
    createSession([
        participants.A,
        participants.B,
        participants.C
    ]);

const storageRoot =
    await mkdtemp(
        join(tmpdir(), "voice-g5-8-recording-")
    );

let clockMs = 5_000_000;

const runtime =
    createVoiceV5RuntimeServices({
        storageRoot,
        resolveUserFromRequest:
            async () => null,
        now: () => clockMs
    });

await runtime.initializeStorage();

await runtime.handleDedicatedSessionEvent({
    event: {
        type: "session_created",
        sessionId: SESSION_ID,
        effectiveAtMs: clockMs
    },
    applyResult:
        createApplyResult(sessionAB)
});

await runtime.recordingService.updateConsent({
    session: sessionAB,
    connectionId:
        participants.A.connectionId,
    consented: true,
    changedAtMs: clockMs
});

clockMs += 10;

await runtime.recordingService.updateConsent({
    session: sessionAB,
    connectionId:
        participants.B.connectionId,
    consented: true,
    changedAtMs: clockMs
});

assert.equal(
    runtime.recordingService
        .getSnapshot(SESSION_ID)
        .state,
    VoiceRecordingState.RECORDING
);

const opusFrame =
    Buffer.from([0xf8, 0xff, 0xfe]);

for (let index = 0; index < 5; index += 1) {
    assert.equal(
        runtime.recordingService.captureFrame({
            session: sessionAB,
            publisherConnectionId:
                participants.A.connectionId,
            payload: opusFrame
        }),
        true
    );

    assert.equal(
        runtime.recordingService.captureFrame({
            session: sessionAB,
            publisherConnectionId:
                participants.B.connectionId,
            payload: opusFrame
        }),
        true
    );
}

clockMs += 200;
const joinedAtMs = clockMs;

await runtime.handleDedicatedSessionEvent({
    event: {
        type: "member_joined",
        sessionId: SESSION_ID,
        effectiveAtMs: joinedAtMs
    },
    applyResult:
        createApplyResult(sessionABC, {
            joined: true,
            closed: false
        })
});

const joinedSnapshot =
    runtime.recordingService
        .getSnapshot(SESSION_ID);

assert.equal(
    joinedSnapshot.state,
    VoiceRecordingState.RECORDING
);
assert.equal(joinedSnapshot.result, null);
assert.equal(
    runtime.recordingService.captureFrame({
        session: sessionABC,
        publisherConnectionId:
            participants.A.connectionId,
        payload: opusFrame
    }),
    true
);

assert.equal(
    runtime.recordingService.captureFrame({
        session: sessionABC,
        publisherConnectionId:
            participants.C.connectionId,
        payload: opusFrame
    }),
    false
);

clockMs += 10;

await runtime.recordingService.updateConsent({
    session: sessionABC,
    connectionId:
        participants.C.connectionId,
    consented: true,
    changedAtMs: clockMs
});

for (let index = 0; index < 5; index += 1) {
    for (const participant of Object.values(participants)) {
        assert.equal(
            runtime.recordingService.captureFrame({
                session: sessionABC,
                publisherConnectionId:
                    participant.connectionId,
                payload: opusFrame
            }),
            true
        );
    }
}

clockMs += 500;
const leftAtMs = clockMs;

await runtime.handleDedicatedSessionEvent({
    event: {
        type: "member_left",
        sessionId: SESSION_ID,
        effectiveAtMs: leftAtMs
    },
    applyResult:
        createApplyResult(sessionAB, {
            left: true,
            closed: false
        })
});

assert.equal(
    runtime.recordingService
        .getSnapshot(SESSION_ID)
        .state,
    VoiceRecordingState.RECORDING
);

assert.equal(
    runtime.recordingService.captureFrame({
        session: sessionAB,
        publisherConnectionId:
            participants.C.connectionId,
        payload: opusFrame
    }),
    false
);

for (let index = 0; index < 5; index += 1) {
    assert.equal(
        runtime.recordingService.captureFrame({
            session: sessionAB,
            publisherConnectionId:
                participants.A.connectionId,
            payload: opusFrame
        }),
        true
    );

    assert.equal(
        runtime.recordingService.captureFrame({
            session: sessionAB,
            publisherConnectionId:
                participants.B.connectionId,
            payload: opusFrame
        }),
        true
    );
}

clockMs += 300;

await runtime.handleDedicatedSessionEvent({
    event: {
        type: "session_closed",
        sessionId: SESSION_ID,
        effectiveAtMs: clockMs
    },
    applyResult:
        createApplyResult(sessionAB, {
            closed: true
        })
});

const finalSnapshot =
    runtime.recordingService
        .getSnapshot(SESSION_ID);

assert.equal(
    finalSnapshot.state,
    VoiceRecordingState.READY
);

const metadata =
    JSON.parse(
        await readFile(
            finalSnapshot.result.metadataPath,
            "utf8"
        )
    );

assert.equal(metadata.sessionId, SESSION_ID);
assert.equal(
    metadata.membershipModel,
    "dynamic_session_membership_v1"
);
assert.equal(metadata.participants.length, 3);
assert.equal(metadata.frameCount, 36);

const participantCMetadata =
    metadata.participants.find(
        (participant) =>
            participant.connectionId ===
            participants.C.connectionId
    );

assert.ok(participantCMetadata);
assert.equal(
    participantCMetadata.intervals.length,
    1
);
assert.equal(
    participantCMetadata.intervals[0].joinedAtMs,
    joinedAtMs
);
assert.equal(
    participantCMetadata.intervals[0].leftAtMs,
    leftAtMs
);
assert.equal(
    participantCMetadata.intervals[0].startOffsetMs,
    210
);
assert.equal(
    participantCMetadata.intervals[0].endOffsetMs,
    720
);

const recordingStat =
    await stat(
        finalSnapshot.result.recordingPath
    );

const metadataStat =
    await stat(
        finalSnapshot.result.metadataPath
    );

assert.equal(recordingStat.isFile(), true);
assert.equal(metadataStat.isFile(), true);

const clipCalls = [];

const downloadService =
    new VoiceRecordingDownloadService({
        storageRoot,
        clipService: {
            async createAuthorizedClip(input) {
                clipCalls.push(input);
                return {
                    recordingPath:
                        input.recordingPath,
                    fileName:
                        `voice-session-${input.sessionId}-authorized.ogg`,
                    contentType: "audio/ogg",
                    contentLength:
                        recordingStat.size,
                    checksumSha256:
                        metadata.checksumSha256,
                    downloadMode:
                        "authorized_clip"
                };
            }
        }
    });

const fullDownload =
    await downloadService.resolveDownload({
        sessionId: SESSION_ID,
        userId: participants.A.userId
    });

assert.equal(
    fullDownload.downloadMode,
    "full_session_passthrough"
);

const intervalDownload =
    await downloadService.resolveDownload({
        sessionId: SESSION_ID,
        userId: participants.C.userId
    });

assert.equal(
    intervalDownload.downloadMode,
    "authorized_clip"
);
assert.equal(clipCalls.length, 1);
assert.deepEqual(
    clipCalls[0].authorizedIntervals,
    participantCMetadata.intervals
);

console.log("VOICE_G5_8_STABLE_RECORDING_SESSION_ID=PASS");
console.log("VOICE_G5_8_JOIN_CONSENT_GATE=PASS");
console.log("VOICE_G5_8_MEMBER_LEAVE_DOES_NOT_FINALIZE=PASS");
console.log("VOICE_G5_8_DYNAMIC_MEMBERSHIP_INTERVALS=PASS");
console.log("VOICE_G5_8_INTERVAL_DOWNLOAD_AUTHORIZATION=PASS");
console.log("VOICE_G5_8_DYNAMIC_RECORDING_TESTS=PASS");
