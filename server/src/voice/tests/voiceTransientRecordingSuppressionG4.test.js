import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    VoiceRecordingState,
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";
import {
    VoiceRecordingService
} from "../recording/voiceRecordingService.js";

const storageRoot = await mkdtemp(
    join(tmpdir(), "voice-transient-recording-")
);
let clockMs = 20_000_000;

const session = Object.freeze({
    sessionId: "990e8400-e29b-41d4-a716-446655440000",
    roomId: "room-transient-recording",
    serverId: "dedicated-transient-recording",
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

const service = new VoiceRecordingService({
    storageRoot,
    now: () => clockMs
});
service.registerSession(session);

await service.updateConsent({
    session,
    connectionId: session.participants[0].connectionId,
    consented: true,
    changedAtMs: clockMs
});

const opusFrame = Buffer.from([0xf8, 0xff, 0xfe]);
for (let index = 0; index < 10; index += 1) {
    clockMs += 20;
    assert.equal(service.captureFrame({
        session,
        publisherConnectionId: session.participants[0].connectionId,
        payload: opusFrame
    }), true);
}

clockMs += 117;
const finalized = await service.finalizeSession(
    session.sessionId,
    VoiceRecordingStopReason.SESSION_CLOSED
);

assert.equal(
    service.getSnapshot(session.sessionId).state,
    VoiceRecordingState.DECLINED
);
assert.equal(finalized.state, VoiceRecordingState.DECLINED);
await assert.rejects(
    access(join(storageRoot, session.sessionId))
);

console.log("VOICE_G4_TRANSIENT_RECORDING_DECLINED=PASS");
console.log("VOICE_G4_TRANSIENT_RECORDING_FILES_REMOVED=PASS");
