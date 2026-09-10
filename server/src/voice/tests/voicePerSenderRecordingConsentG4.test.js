import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    VoiceRecordingState,
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";
import {
    VoiceRecordingService
} from "../recording/voiceRecordingService.js";

async function probeDuration(filePath) {
    return await new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const child = spawn("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            filePath
        ], { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(stderr || `ffprobe exited with ${code}`));
                return;
            }
            resolve(Number(stdout.trim()));
        });
    });
}

const session = Object.freeze({
    sessionId: "880e8400-e29b-41d4-a716-446655440000",
    roomId: "room-per-sender-consent",
    serverId: "dedicated-per-sender-consent",
    participants: Object.freeze([
        Object.freeze({
            userId: "11111111-1111-4111-8111-111111111111",
            connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        }),
        Object.freeze({
            userId: "22222222-2222-4222-8222-222222222222",
            connectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        }),
        Object.freeze({
            userId: "33333333-3333-4333-8333-333333333333",
            connectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        })
    ])
});

const storageRoot = await mkdtemp(
    join(tmpdir(), "voice-per-sender-consent-")
);
let clockMs = 10_000_000;
const recordingService = new VoiceRecordingService({
    storageRoot,
    now: () => clockMs
});
recordingService.registerSession(session);

await recordingService.updateConsent({
    session,
    connectionId: session.participants[0].connectionId,
    consented: true,
    changedAtMs: clockMs
});

assert.equal(
    recordingService.getSnapshot(session.sessionId).state,
    VoiceRecordingState.RECORDING
);

const opusFrame = Buffer.from([0xf8, 0xff, 0xfe]);
assert.equal(
    recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[0].connectionId,
        payload: opusFrame
    }),
    true
);
assert.equal(
    recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[1].connectionId,
        payload: opusFrame
    }),
    false
);
assert.equal(
    recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[2].connectionId,
        payload: opusFrame
    }),
    false
);

clockMs += 20;
await recordingService.updateConsent({
    session,
    connectionId: session.participants[1].connectionId,
    consented: true,
    changedAtMs: clockMs
});

for (let index = 0; index < 10; index += 1) {
    clockMs += 20;
    assert.equal(recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[0].connectionId,
        payload: opusFrame
    }), true);
    assert.equal(recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[1].connectionId,
        payload: opusFrame
    }), true);
}

clockMs += 20;
const revokedAtMs = clockMs;
await recordingService.updateConsent({
    session,
    connectionId: session.participants[0].connectionId,
    consented: false,
    changedAtMs: revokedAtMs
});

assert.equal(
    recordingService.getSnapshot(session.sessionId).state,
    VoiceRecordingState.RECORDING
);
assert.equal(
    recordingService.getSnapshot(session.sessionId)
        .consents[session.participants[0].connectionId].consented,
    false
);

for (let index = 0; index < 20; index += 1) {
    clockMs += 20;
    assert.equal(recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[0].connectionId,
        payload: opusFrame
    }), false);
    assert.equal(recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[1].connectionId,
        payload: opusFrame
    }), true);
}

clockMs += 20;
const reconsentedAtMs = clockMs;
await recordingService.updateConsent({
    session,
    connectionId: session.participants[0].connectionId,
    consented: true,
    changedAtMs: reconsentedAtMs
});

for (let index = 0; index < 10; index += 1) {
    clockMs += 20;
    assert.equal(recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[0].connectionId,
        payload: opusFrame
    }), true);
    assert.equal(recordingService.captureFrame({
        session,
        publisherConnectionId: session.participants[1].connectionId,
        payload: opusFrame
    }), true);
}

clockMs += 220;
const finalized = await recordingService.finalizeSession(
    session.sessionId,
    VoiceRecordingStopReason.SESSION_CLOSED
);
assert.ok(finalized);

const metadata = JSON.parse(
    await readFile(finalized.metadataPath, "utf8")
);
const participantA = metadata.participants.find(
    (participant) =>
        participant.connectionId === session.participants[0].connectionId
);
const participantB = metadata.participants.find(
    (participant) =>
        participant.connectionId === session.participants[1].connectionId
);
const participantC = metadata.participants.find(
    (participant) =>
        participant.connectionId === session.participants[2].connectionId
);

assert.ok(participantA);
assert.ok(participantB);
assert.ok(participantC);
assert.equal(metadata.stopReason, VoiceRecordingStopReason.SESSION_CLOSED);
assert.equal(participantA.frameCount, 21);
assert.equal(participantB.frameCount, 40);
assert.equal(participantA.consentIntervals.length, 2);
assert.equal(participantB.consentIntervals.length, 1);
assert.equal(participantC.frameCount, 0);
assert.equal(participantC.consentIntervals.length, 0);
assert.equal(
    participantA.consentIntervals[0].revokedAtMs,
    revokedAtMs
);
assert.equal(
    participantA.consentIntervals[1].consentedAtMs,
    reconsentedAtMs
);

const participantAPath = join(
    storageRoot,
    session.sessionId,
    "participants",
    `${session.participants[0].connectionId}.ogg`
);
const participantBPath = join(
    storageRoot,
    session.sessionId,
    "participants",
    `${session.participants[1].connectionId}.ogg`
);
const participantCPath = join(
    storageRoot,
    session.sessionId,
    "participants",
    `${session.participants[2].connectionId}.ogg`
);

const expectedDurationSeconds = metadata.durationMs / 1000;
const durationA = await probeDuration(participantAPath);
const durationB = await probeDuration(participantBPath);
const durationC = await probeDuration(participantCPath);
const durationSession = await probeDuration(finalized.recordingPath);

for (const duration of [durationA, durationB, durationC, durationSession]) {
    assert.ok(Number.isFinite(duration));
    assert.ok(
        Math.abs(duration - expectedDurationSeconds) <= 0.08,
        `duration mismatch actual=${duration} expected=${expectedDurationSeconds}`
    );
}

await assert.rejects(
    access(join(storageRoot, session.sessionId, "segments"))
);

console.log("VOICE_G4_PER_SENDER_CONSENT_STARTS_ON_FIRST_CONSENT=PASS");
console.log("VOICE_G4_PER_SENDER_CONSENT_REVOKE_DOES_NOT_STOP_SESSION=PASS");
console.log("VOICE_G4_PER_SENDER_CONSENT_OTHER_SENDERS_CONTINUE=PASS");
console.log("VOICE_G4_PER_SENDER_CONSENT_NEVER_CONSENTED_SENDER_SILENT_TRACK=PASS");
console.log("VOICE_G4_PER_SENDER_CONSENT_REGRANT_RESUMES_ONLY_SENDER=PASS");
console.log("VOICE_G4_PER_SENDER_CONSENT_TIMELINE_GAP_PRESERVED=PASS");
