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
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";

import {
    VoiceRecordingDownloadService
} from "../recording/voiceRecordingDownloadService.js";

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
        "660e8400-e29b-41d4-a716-446655440000",
    roomId:
        "room-recording-rd3",
    serverId:
        "dedicated-recording-rd3",
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

const storageRoot =
    await mkdtemp(
        join(tmpdir(), "voice-rd3-clip-")
    );

let clockMs = 3_000_000;

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

clockMs += 10;

await recordingService.updateConsent({
    session,
    connectionId:
        session.participants[1].connectionId,
    consented: true,
    changedAtMs: clockMs
});

const opusA = Buffer.from([0xf8, 0xff, 0xfe]);
const opusB = Buffer.from([0xf8, 0xff, 0xfd]);

for (let index = 0; index < 60; index += 1) {
    assert.equal(
        recordingService.captureFrame({
            session,
            publisherConnectionId:
                session.participants[0].connectionId,
            payload: opusA
        }),
        true
    );

    assert.equal(
        recordingService.captureFrame({
            session,
            publisherConnectionId:
                session.participants[1].connectionId,
            payload: opusB
        }),
        true
    );
}

clockMs += 1200;

const finalized =
    await recordingService.finalizeSession(
        session.sessionId,
        VoiceRecordingStopReason.SESSION_CLOSED
    );

const recordingProbe =
    await probeOggOpusFile(finalized.recordingPath);

assert.match(recordingProbe, /codec_name=opus/);
assert.match(recordingProbe, /sample_rate=48000/);
assert.match(recordingProbe, /channels=1/);

const downloadService =
    new VoiceRecordingDownloadService({
        storageRoot
    });

const fullDownload =
    await downloadService.resolveDownload({
        sessionId: session.sessionId,
        userId: session.participants[0].userId
    });

assert.equal(
    fullDownload.downloadMode,
    "full_session_passthrough"
);

const metadata =
    JSON.parse(
        await readFile(finalized.metadataPath, "utf8")
    );

metadata.participants[0].intervals = [
    {
        joinedAtMs:
            metadata.startedAtMs + 200,
        leftAtMs:
            metadata.startedAtMs + 900,
        startOffsetMs: 200,
        endOffsetMs: 900
    }
];

await writeFile(
    finalized.metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`
);

const partialDownload =
    await downloadService.resolveDownload({
        sessionId: session.sessionId,
        userId: session.participants[0].userId
    });

assert.equal(
    partialDownload.downloadMode,
    "authorized_clip"
);

assert.equal(
    partialDownload.contentType,
    "audio/ogg"
);

assert.equal(
    partialDownload.authorizedIntervals.length,
    1
);

assert.equal(
    partialDownload.authorizedIntervals[0].startOffsetMs,
    200
);

assert.equal(
    partialDownload.authorizedIntervals[0].endOffsetMs,
    900
);

assert.notEqual(
    partialDownload.recordingPath,
    finalized.recordingPath
);

const partialProbe =
    await probeOggOpusFile(partialDownload.recordingPath);

assert.match(partialProbe, /codec_name=opus/);
assert.match(partialProbe, /sample_rate=48000/);
assert.match(partialProbe, /channels=1/);

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

console.log("VOICE_G4_RD3_FULL_DOWNLOAD_PASSTHROUGH=PASS");
console.log("VOICE_G4_RD3_AUTHORIZED_CLIP_DOWNLOAD=PASS");
console.log("VOICE_G4_RD3_FORBIDDEN_NON_MEMBER=PASS");
console.log("VOICE_G4_RD3_DOWNLOAD_CLIP_TESTS=PASS");
