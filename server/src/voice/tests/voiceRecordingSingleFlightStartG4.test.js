import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    VoiceRecordingState,
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";
import { VoiceRecordingService } from "../recording/voiceRecordingService.js";

const session = Object.freeze({
    sessionId: "990e8400-e29b-41d4-a716-446655440000",
    roomId: "room-single-flight",
    serverId: "dedicated-single-flight",
    participants: Object.freeze([
        Object.freeze({
            userId: "11111111-1111-4111-8111-111111111111",
            connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        }),
        Object.freeze({
            userId: "22222222-2222-4222-8222-222222222222",
            connectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        })
    ])
});

const storageRoot = await mkdtemp(join(tmpdir(), "voice-single-flight-"));
let clockMs = 20_000_000;
const service = new VoiceRecordingService({
    storageRoot,
    now: () => clockMs
});
service.registerSession(session);

const capturedLogs = [];
const originalLog = console.log;
console.log = (...args) => {
    capturedLogs.push(args.join(" "));
};

try {
    await Promise.all([
        service.updateConsent({
            session,
            connectionId: session.participants[0].connectionId,
            consented: true,
            changedAtMs: clockMs
        }),
        service.updateConsent({
            session,
            connectionId: session.participants[1].connectionId,
            consented: true,
            changedAtMs: clockMs + 1
        })
    ]);
} finally {
    console.log = originalLog;
}

assert.equal(
    service.getSnapshot(session.sessionId).state,
    VoiceRecordingState.RECORDING
);

const startBeginCount = capturedLogs.filter(
    (line) => line.includes("START_RECORDING_BEGIN")
).length;
const startDoneCount = capturedLogs.filter(
    (line) => line.includes("START_RECORDING_DONE")
).length;
const joinedExistingCount = capturedLogs.filter(
    (line) => line.includes("START_RECORDING_JOIN_EXISTING")
).length;

assert.equal(startBeginCount, 1);
assert.equal(startDoneCount, 1);
assert.equal(joinedExistingCount, 1);

const opusFrame = Buffer.from([0xf8, 0xff, 0xfe]);
for (let index = 0; index < 10; index += 1) {
    clockMs += 20;
    assert.equal(service.captureFrame({
        session,
        publisherConnectionId: session.participants[0].connectionId,
        payload: opusFrame
    }), true);
    assert.equal(service.captureFrame({
        session,
        publisherConnectionId: session.participants[1].connectionId,
        payload: opusFrame
    }), true);
}

clockMs += 20;
const result = await service.finalizeSession(
    session.sessionId,
    VoiceRecordingStopReason.SESSION_CLOSED
);
assert.ok(result);

const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));
const a = metadata.participants.find(
    (participant) => participant.connectionId === session.participants[0].connectionId
);
const b = metadata.participants.find(
    (participant) => participant.connectionId === session.participants[1].connectionId
);
assert.equal(a.frameCount, 10);
assert.equal(b.frameCount, 10);

console.log("VOICE_G4_RECORDING_SINGLE_FLIGHT_START=PASS");
console.log("VOICE_G4_RECORDING_SIMULTANEOUS_CONSENT=PASS");
console.log("VOICE_G4_RECORDING_NO_DUPLICATE_WORKER=PASS");
