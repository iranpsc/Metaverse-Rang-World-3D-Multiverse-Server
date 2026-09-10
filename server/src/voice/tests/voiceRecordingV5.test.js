import assert from "node:assert/strict";

import {
    spawn
} from "node:child_process";

import {
    mkdtemp,
    readFile,
    writeFile
} from "node:fs/promises";

import {
    tmpdir
} from "node:os";

import {
    join
} from "node:path";

import {
    VoiceRecordingState,
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";

import {
    VoiceRecordingDownloadService
} from "../recording/voiceRecordingDownloadService.js";

import {
    decodeVoiceRecordingConsentPayload,
    decodeVoiceRecordingStatePayload,
    encodeVoiceRecordingConsentPayload,
    encodeVoiceRecordingStatePayload
} from "../recording/voiceRecordingPayload.js";

import {
    VoiceRecordingService
} from "../recording/voiceRecordingService.js";

async function probeOggOpusFile(filePath) {
    return await new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";

        const child = spawn("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration,size",
            "-show_entries", "stream=codec_name,codec_type,sample_rate,channels",
            "-of", "default=noprint_wrappers=1",
            filePath
        ], {
            stdio: ["ignore", "pipe", "pipe"]
        });

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", reject);

        child.on("close", (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            reject(new Error(stderr || `ffprobe exited with code ${code}`));
        });
    });
}

const session = Object.freeze({
    sessionId:
        "550e8400-e29b-41d4-a716-446655440000",
    roomId:
        "room-recording-v5",
    serverId:
        "dedicated-recording-v5",
    participants: Object.freeze([
        Object.freeze({
            userId:
                "11111111-1111-4111-8111-111111111111",
            connectionId:
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        }),
        Object.freeze({
            userId:
                "22222222-2222-4222-8222-222222222222",
            connectionId:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        })
    ])
});

const consentPayload =
    encodeVoiceRecordingConsentPayload({
        consented: true
    });

assert.deepEqual(
    decodeVoiceRecordingConsentPayload(consentPayload),
    { consented: true }
);

const statePayload =
    encodeVoiceRecordingStatePayload({
        state: VoiceRecordingState.RECORDING
    });

assert.deepEqual(
    decodeVoiceRecordingStatePayload(statePayload),
    {
        state: VoiceRecordingState.RECORDING,
        reason: 0
    }
);

const storageRoot =
    await mkdtemp(
        join(tmpdir(), "voice-v5-recording-")
    );

let clockMs = 2_000_000;

const recordingService =
    new VoiceRecordingService({
        storageRoot,
        now: () => clockMs
    });

recordingService.registerSession(session);

await recordingService.updateConsent({
    session,
    connectionId:
        session.participants[0].connectionId,
    consented: true,
    changedAtMs: clockMs
});

assert.equal(
    recordingService
        .getSnapshot(session.sessionId)
        .state,
    VoiceRecordingState.RECORDING
);

clockMs += 10;

await recordingService.updateConsent({
    session,
    connectionId:
        session.participants[1].connectionId,
    consented: true,
    changedAtMs: clockMs
});

assert.equal(
    recordingService
        .getSnapshot(session.sessionId)
        .state,
    VoiceRecordingState.RECORDING
);

const opusA = Buffer.from([0xf8, 0xff, 0xfe]);
const opusB = Buffer.from([0xf8, 0xff, 0xfd, 0x00]);

for (let index = 0; index < 5; index += 1) {
    assert.equal(
        recordingService.captureFrame({
            session,
            publisherConnectionId:
                session.participants[0]
                    .connectionId,
            payload: opusA
        }),
        true
    );

    assert.equal(
        recordingService.captureFrame({
            session,
            publisherConnectionId:
                session.participants[1]
                    .connectionId,
            payload: opusB
        }),
        true
    );
}

clockMs += 1000;

const finalized =
    await recordingService.finalizeSession(
        session.sessionId,
        VoiceRecordingStopReason.SESSION_CLOSED
    );

assert.equal(finalized.frameCount, 10);
assert.equal(finalized.opusBytes, 35);
assert.match(finalized.checksumSha256, /^[0-9a-f]{64}$/);

const recordingBytes =
    await readFile(finalized.recordingPath);

assert.equal(
    recordingBytes.subarray(0, 4).toString("ascii"),
    "OggS"
);

const recordingProbe =
    await probeOggOpusFile(finalized.recordingPath);

assert.match(recordingProbe, /codec_name=opus/);
assert.match(recordingProbe, /sample_rate=48000/);
assert.match(recordingProbe, /channels=1/);
assert.match(recordingProbe, /duration=/);

const metadata = JSON.parse(
    await readFile(finalized.metadataPath, "utf8")
);

assert.equal(metadata.sessionId, session.sessionId);
assert.equal(metadata.version, 2);
assert.equal(metadata.recordingContract, "G4.RD1");
assert.equal(metadata.authorizationModel, "user_intervals_from_session_json");
assert.equal(metadata.durationMs, 1010);
assert.equal(metadata.participants.length, 2);
assert.equal(metadata.frameCount, 10);

for (const participant of metadata.participants) {
    assert.equal(Array.isArray(participant.intervals), true);
    assert.equal(participant.intervals.length, 1);
    assert.equal(participant.intervals[0].joinedAtMs, metadata.startedAtMs);
    assert.equal(participant.intervals[0].leftAtMs, metadata.endedAtMs);
    assert.equal(participant.intervals[0].startOffsetMs, 0);
    assert.equal(participant.intervals[0].endOffsetMs, metadata.durationMs);
}

const downloadService =
    new VoiceRecordingDownloadService({
        storageRoot
    });

const authorizedDownload =
    await downloadService.resolveDownload({
        sessionId: session.sessionId,
        userId: session.participants[0].userId
    });

assert.equal(
    authorizedDownload.checksumSha256,
    finalized.checksumSha256
);

assert.equal(
    authorizedDownload.downloadMode,
    "full_session_passthrough"
);

assert.equal(
    Array.isArray(
        authorizedDownload.authorizedIntervals
    ),
    true
);

assert.equal(
    authorizedDownload.authorizedIntervals.length,
    1
);

assert.equal(
    authorizedDownload.authorizedIntervals[0]
        .startOffsetMs,
    0
);

assert.equal(
    authorizedDownload.authorizedIntervals[0]
        .endOffsetMs,
    metadata.durationMs
);

const partialAccessMetadata =
    JSON.parse(
        await readFile(
            finalized.metadataPath,
            "utf8"
        )
    );

partialAccessMetadata.participants[0].intervals = [
    {
        joinedAtMs:
            partialAccessMetadata.startedAtMs,
        leftAtMs:
            partialAccessMetadata.startedAtMs + 400,
        startOffsetMs: 0,
        endOffsetMs: 400
    }
];

await writeFile(
    finalized.metadataPath,
    JSON.stringify(
        partialAccessMetadata,
        null,
        2
    )
);

const partialAuthorizedDownload =
    await downloadService.resolveDownload({
        sessionId: session.sessionId,
        userId: session.participants[0].userId
    });

assert.equal(
    partialAuthorizedDownload.downloadMode,
    "authorized_clip"
);

assert.equal(
    partialAuthorizedDownload.contentType,
    "audio/ogg"
);

assert.equal(
    partialAuthorizedDownload.authorizedIntervals.length,
    1
);

assert.equal(
    partialAuthorizedDownload.authorizedIntervals[0]
        .startOffsetMs,
    0
);

assert.equal(
    partialAuthorizedDownload.authorizedIntervals[0]
        .endOffsetMs,
    400
);

const partialAuthorizedProbe =
    await probeOggOpusFile(
        partialAuthorizedDownload.recordingPath
    );

assert.match(partialAuthorizedProbe, /codec_name=opus/);
assert.match(partialAuthorizedProbe, /sample_rate=48000/);
assert.match(partialAuthorizedProbe, /channels=1/);

await assert.rejects(
    downloadService.resolveDownload({
        sessionId: session.sessionId,
        userId:
            "33333333-3333-4333-8333-333333333333"
    }),
    (error) =>
        error.code ===
        "VOICE_RECORDING_FORBIDDEN"
);

console.log("VOICE_V5_RECORDING_CONSENT=PASS");
console.log("VOICE_V5_WORKER_OGG_OPUS=PASS");
console.log("VOICE_V5_METADATA_CHECKSUM=PASS");
console.log("VOICE_V5_MEMBER_DOWNLOAD_AUTHORIZATION=PASS");
console.log("VOICE_G4_RD2_INTERVAL_AUTHORIZATION=PASS");
console.log("VOICE_V5_RECORDING_TESTS=PASS");

