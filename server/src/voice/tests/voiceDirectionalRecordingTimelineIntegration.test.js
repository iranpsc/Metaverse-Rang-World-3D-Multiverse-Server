import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VoiceRecordingService } from "../recording/voiceRecordingService.js";
import {
    applyVoiceDirectionalRecordingTimelineExtension,
    recordVoiceDirectionalButtonState
} from "../directional/voiceDirectionalRecordingTimeline.js";

applyVoiceDirectionalRecordingTimelineExtension();

let nowMs = 100000;
const root = await mkdtemp(join(tmpdir(), "voice-directional-timeline-"));
const sessionId = "22222222-2222-4222-8222-222222222222";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = {
    sessionId,
    roomId: "room-test",
    serverId: "server-test",
    participants: [
        { userId: "user-a", connectionId: a },
        { userId: "user-b", connectionId: b }
    ]
};

try {
    const service = new VoiceRecordingService({
        storageRoot: root,
        now: () => nowMs
    });
    await service.initializeStorage();

    await service.updateConsent({
        session,
        connectionId: a,
        consented: true,
        changedAtMs: nowMs
    });

    nowMs = 101234;
    recordVoiceDirectionalButtonState({
        source: "sender_mic",
        senderConnectionId: a,
        receiverConnectionId: b,
        blocked: true,
        changedAtMs: nowMs
    });

    nowMs = 102345;
    recordVoiceDirectionalButtonState({
        source: "sender_mic",
        senderConnectionId: a,
        receiverConnectionId: b,
        blocked: false,
        changedAtMs: nowMs
    });

    nowMs = 104000;
    await service.finalizeSession(sessionId);

    const timeline = await readFile(
        join(root, sessionId, "directional-events.ndjson"),
        "utf8"
    );

    const events = timeline.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(events.length, 2);
    assert.equal(events[0].changedAtMs, 101234);
    assert.equal(events[0].offsetMs, 1234);
    assert.equal(events[0].blocked, true);
    assert.equal(events[1].changedAtMs, 102345);
    assert.equal(events[1].offsetMs, 2345);
    assert.equal(events[1].blocked, false);

    console.log("VOICE_DIRECTIONAL_RECORDING_TIMELINE_INTEGRATION=PASS");
} finally {
    await rm(root, { recursive: true, force: true });
}
