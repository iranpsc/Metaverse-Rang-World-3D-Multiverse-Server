import test from "node:test";
import assert from "node:assert/strict";
import { installVoiceRecordingFinalizationAckRelease } from "../dedicated/voiceRecordingFinalizationAckReleaseAdapter.js";
import { VoiceDedicatedSessionDeltaService } from "../dedicated/voiceDedicatedSessionDeltaService.js";
import { VoiceRecordingService } from "../recording/voiceRecordingService.js";
import { VoiceRecordingState, VoiceRecordingStopReason } from "../recording/voiceRecordingConstants.js";

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function makeRecording(sessionId, stop) {
    const rec = Object.create(VoiceRecordingService.prototype);
    rec.recordsBySessionId = new Map([[sessionId, {
        session: { sessionId }, state: VoiceRecordingState.RECORDING,
        workerClient: { stop }, startPromise: null, endedAtMs: null,
        result: null, finalizePromise: null
    }]]);
    rec.completedBySessionId = new Map();
    rec.failedRecordings = 0;
    rec.now = () => 1000;
    return rec;
}
function makeDelta(rec, event) {
    const delta = Object.create(VoiceDedicatedSessionDeltaService.prototype);
    delta.logger = { error: () => {} };
    let delivered = 0;
    delta.eventObserver = async input => {
        const results = await Promise.allSettled([
            (async () => { delivered++; })(),
            rec.finalizeSession(input.event.sessionId, VoiceRecordingStopReason.SESSION_CLOSED)
        ]);
        const failure = results.find(x => x.status === "rejected");
        if (failure) throw failure.reason;
    };
    return { delta, delivered: () => delivered, event };
}

const notices = [];
const adapter = installVoiceRecordingFinalizationAckRelease({
    deltaPrototype: VoiceDedicatedSessionDeltaService.prototype,
    recordingPrototype: VoiceRecordingService.prototype,
    writeDiagnostic(level, message) { notices.push([level, message]); }
});

test("real VoiceRecordingService finalization starts, ACK returns while recording still pending", async () => {
    const d = deferred();
    let stops = 0;
    const rec = makeRecording("session-a", () => { stops++; return d.promise; });
    const { delta, delivered } = makeDelta(rec);
    await delta.notifyEventApplied({ type: "session_closed", sessionId: "session-a" }, { data: { result: {} } });
    assert.equal(delivered(), 1);
    assert.equal(stops, 1);
    assert.equal(rec.recordsBySessionId.get("session-a").state, VoiceRecordingState.FINALIZING);
    assert.equal(adapter.pendingCount() >= 1, true);
    d.resolve({ recordingPath: "test.ogg", metadataPath: "metadata.json", frameCount: 10, opusBytes: 50 });
    await rec.recordsBySessionId.get("session-a").finalizePromise;
    assert.equal(rec.recordsBySessionId.get("session-a").state, VoiceRecordingState.READY);
});

test("closed member_left ACK does not wait for recording", async () => {
    const d = deferred();
    const rec = makeRecording("session-b", () => d.promise);
    const { delta } = makeDelta(rec);
    await delta.notifyEventApplied({ type: "member_left", sessionId: "session-b" }, { data: { result: { closed: true } } });
    assert.equal(rec.recordsBySessionId.get("session-b").state, VoiceRecordingState.FINALIZING);
    d.resolve({ recordingPath: "b.ogg", metadataPath: "b.json", frameCount: 0, opusBytes: 0 });
    await rec.recordsBySessionId.get("session-b").finalizePromise;
});

test("non-closing member_left still waits for recording method", async () => {
    const d = deferred();
    const rec = makeRecording("session-c", () => d.promise);
    const { delta } = makeDelta(rec);
    let done = false;
    const ack = delta.notifyEventApplied({ type: "member_left", sessionId: "session-c" }, { data: { result: { closed: false } } }).then(() => { done=true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(done, false);
    d.resolve({ recordingPath: "c.ogg", metadataPath: "c.json", frameCount: 1, opusBytes: 12 });
    await ack;
    assert.equal(done, true);
});

test("session-created registration path not modified", async () => {
    const d = deferred();
    const rec = makeRecording("session-d", () => d.promise);
    const { delta } = makeDelta(rec);
    let done = false;
    const ack = delta.notifyEventApplied({ type: "session_created", sessionId: "session-d" }, { data: { result: {} } }).then(() => { done = true; });
    await Promise.resolve();
    assert.equal(done, false);
    d.resolve({ recordingPath: "d.ogg", metadataPath: "d.json", frameCount: 1, opusBytes: 12 });
    await ack;
});

test("unrelated session finalization remains awaited even during closed event", async () => {
    const d = deferred();
    const rec = makeRecording("other", () => d.promise);
    const delta = Object.create(VoiceDedicatedSessionDeltaService.prototype);
    delta.eventObserver = async () => { await rec.finalizeSession("other", VoiceRecordingStopReason.SESSION_CLOSED); };
    let done = false;
    const ack = delta.notifyEventApplied({ type: "session_closed", sessionId: "session-e" }, { data: { result: {} } }).then(() => { done = true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(done, false);
    d.resolve({ recordingPath: "other.ogg", metadataPath: "other.json", frameCount: 3, opusBytes: 42 });
    await ack;
});

test("recording finalization failure is logged, does not stall ACK", async () => {
    const d = deferred();
    const rec = makeRecording("session-f", () => d.promise);
    const { delta } = makeDelta(rec);
    await delta.notifyEventApplied({ type: "session_closed", sessionId: "session-f" }, { data: { result: {} } });
    d.reject(Object.assign(new Error("ffmpeg timed out"), { code: "VOICE_RECORDING_PROCESS_TIMEOUT" }));
    await assert.rejects(rec.recordsBySessionId.get("session-f").finalizePromise, /timed out/);
    // Detached completion handler is independent and handles the rejection.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(notices.some(([,x]) => x.includes("VOICE_RECORDING_FINALIZE_ASYNC=FAILED") && x.includes("session-f")), true);
});

test("recording other stop reasons remains awaited", async () => {
    const d=deferred();
    const rec=makeRecording("session-g",()=>d.promise);
    const delta=Object.create(VoiceDedicatedSessionDeltaService.prototype);
    delta.eventObserver = () => rec.finalizeSession("session-g", VoiceRecordingStopReason.SERVER_SHUTDOWN);
    let done = false;
    const ack=delta.notifyEventApplied({type:"session_closed",sessionId:"session-g"},{}).then(()=> {done=true;});
    await Promise.resolve();
    assert.equal(done,false);
    d.resolve({ recordingPath: "g.ogg", metadataPath: "g.json", frameCount: 4, opusBytes: 42 });
    await ack;
});

test("parallel events do not leak async context into another session", async () => {
    const d1=deferred(), d2=deferred();
    const rec1=makeRecording("session-h",()=>d1.promise);
    const rec2=makeRecording("session-i",()=>d2.promise);
    const left=makeDelta(rec1).delta;
    const right=makeDelta(rec2).delta;
    await Promise.all([
        left.notifyEventApplied({type:"session_closed",sessionId:"session-h"},{}),
        right.notifyEventApplied({type:"session_closed",sessionId:"session-i"},{})
    ]);
    assert.equal(rec1.recordsBySessionId.get("session-h").state, VoiceRecordingState.FINALIZING);
    assert.equal(rec2.recordsBySessionId.get("session-i").state, VoiceRecordingState.FINALIZING);
    d1.resolve({ recordingPath: "h.ogg", metadataPath: "h.json", frameCount: 0, opusBytes: 0 });
    d2.resolve({ recordingPath: "i.ogg", metadataPath: "i.json", frameCount: 0, opusBytes: 0 });
    await Promise.all([rec1.recordsBySessionId.get("session-h").finalizePromise, rec2.recordsBySessionId.get("session-i").finalizePromise]);
});

test("uninstall restores both methods", async () => {
    adapter.uninstall();
    assert.equal(adapter.pendingCount(), 0);
});
