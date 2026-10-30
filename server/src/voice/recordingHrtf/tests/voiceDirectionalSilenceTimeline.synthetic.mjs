import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { buildDirectionalDownloadPlan, createDirectionalPersonalizedRecording, applyVoiceDirectionalDownloadExtension } from "../../directional/voiceDirectionalDownloadExtension.js";
import { VoiceRecordingDownloadService } from "../../recording/voiceRecordingDownloadService.js";
import { VoicePersonalHrtfRecordingRenderer } from "../voicePersonalHrtfRecordingRenderer.js";

async function run(command, args) {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [], errors = [];
    child.stdout.on("data", (data) => out.push(data));
    child.stderr.on("data", (data) => errors.push(data));
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `${command}: ${Buffer.concat(errors).toString()}`);
    return Buffer.concat(out);
}

function datasetBuffer() {
    const positions = new Float32Array([0, 0, 1, 90, 0, 1, 180, 0, 1, 270, 0, 1]);
    const left = new Float32Array(32);
    const right = new Float32Array(32);
    for (let index = 0; index < 4; index++) { left[index * 8] = 1; right[index * 8] = 1; }
    const buffer = Buffer.alloc(24 + (positions.length + left.length + right.length) * 4);
    buffer.write("VMEHRTF1", 0, "ascii");
    buffer.writeUInt32LE(1, 8);
    buffer.writeUInt32LE(48000, 12);
    buffer.writeUInt32LE(4, 16);
    buffer.writeUInt32LE(8, 20);
    let offset = 24;
    for (const values of [positions, left, right]) {
        for (const value of values) { buffer.writeFloatLE(value, offset); offset += 4; }
    }
    return buffer;
}

async function decodeAudio(file) {
    const raw = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]);
    return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

function toneMagnitude(samples, frequency, startMs, endMs) {
    const rate = 48000;
    const start = Math.round(startMs * rate / 1000);
    const end = Math.min(samples.length, Math.round(endMs * rate / 1000));
    let re = 0, im = 0;
    const frequencyStep = 2 * Math.PI * frequency / rate;
    for (let i = start; i < end; i++) {
        re += samples[i] * Math.cos(frequencyStep * (i - start));
        im += samples[i] * Math.sin(frequencyStep * (i - start));
    }
    return 2 * Math.hypot(re, im) / (end - start);
}

const tempRoot = await mkdtemp(join(tmpdir(), "vme2-directional-silence-"));
try {
    const sessionId = "c216d876-ecb4-4ecf-a196-646cb53a809d";
    const sessionDirectory = join(tempRoot, sessionId);
    const participantDirectory = join(sessionDirectory, "participants");
    await mkdir(participantDirectory, { recursive: true });
    const users = ["a", "b", "c"];
    const frequencies = [400, 700, 1000];
    const startMs = 1700000000000;
    const durationMs = 3000;
    const participants = users.map((user) => ({
        userId: `user-${user}`,
        connectionId: `conn-${user}`,
        intervals: [{ startOffsetMs: 0, endOffsetMs: durationMs }]
    }));
    for (let i = 0; i < users.length; i++) {
        await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
            `sine=frequency=${frequencies[i]}:sample_rate=48000:duration=3`,
            "-af", "volume=0.12", "-c:a", "libopus", "-b:a", "64000", "-y",
            join(participantDirectory, `conn-${users[i]}.ogg`)]);
    }
    const metadata = {
        sessionId,
        startedAtMs: startMs,
        endedAtMs: startMs + durationMs,
        durationMs,
        participants
    };
    await writeFile(join(sessionDirectory, "session.json"), JSON.stringify(metadata));
    const timeline = [
        { type: "spatial_timeline_start", version: 1, sessionId, roomId: "test-room", serverId: "test-server", startedAtMs: startMs }
    ];
    for (const ms of [0, 1000, 2000, 3000]) {
        for (let i = 0; i < users.length; i++) {
            timeline.push({ type: "spatial_state", sessionId, atMs: startMs + ms, relativeMs: ms,
                userId: `user-${users[i]}`, sequence: 1 + ms / 1000,
                position: { x: i * 0.4, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
        }
    }
    timeline.push({ type: "spatial_timeline_end", endedAtMs: startMs + durationMs });
    await writeFile(join(sessionDirectory, "spatial-timeline.jsonl"), timeline.map((event) => JSON.stringify(event)).join("\n"));
    const events = [
        { senderConnectionId: "conn-a", receiverConnectionId: "conn-b", source: "sender_mic", blocked: true, changedAtMs: startMs + 1000 },
        { senderConnectionId: "conn-a", receiverConnectionId: "conn-b", source: "sender_mic", blocked: false, changedAtMs: startMs + 2000 }
    ];
    const planB = buildDirectionalDownloadPlan({ metadata, receiverMemberships: [participants[1]], events });
    const planC = buildDirectionalDownloadPlan({ metadata, receiverMemberships: [participants[2]], events });
    assert.equal(planB.hasBlockedIntervals, true);
    assert.deepEqual(planB.blockedIntervalsBySenderConnectionId.get("conn-a"), [{ startOffsetMs: 1000, endOffsetMs: 2000 }]);
    assert.equal(planC.hasBlockedIntervals, false);

    const authorizedIntervals = [{ startOffsetMs: 0, endOffsetMs: durationMs }];
    await writeFile(join(sessionDirectory, "directional-events.ndjson"), events.map((event) => JSON.stringify({ ...event, sessionId })).join("\n"));
    VoiceRecordingDownloadService.prototype.resolveDownload = async () => ({
        sessionId, metadataPath: join(sessionDirectory, "session.json"), authorizedIntervals,
        recordingPath: join(sessionDirectory, "session.ogg"), fileName: "session.ogg"
    });
    applyVoiceDirectionalDownloadExtension();
    const wrapperDownload = await VoiceRecordingDownloadService.prototype.resolveDownload.call(
        { clipService: { ffmpegPath: "ffmpeg" } }, { sessionId, userId: "user-b" });
    const wrapperPcm = await decodeAudio(wrapperDownload.recordingPath);
    assert.ok(Math.abs(wrapperPcm.length / 48 - durationMs) < 80,
        `Directional download wrapper cut the session timeline: ${(wrapperPcm.length / 48).toFixed(2)}ms`);
    console.log(`VOICE_DIRECTIONAL_DOWNLOAD_WRAPPER_SYNTHETIC=PASS | durationMs=${(wrapperPcm.length / 48).toFixed(2)}`);

    const direct = await createDirectionalPersonalizedRecording({ sessionDirectory, metadata,
        userId: "user-b", authorizedIntervals, directionalPlan: planB });
    const directPcm = await decodeAudio(direct.recordingPath);
    assert.ok(Math.abs(directPcm.length / 48 - durationMs) < 80, "Directional output duration changed");
    const beforeA = toneMagnitude(directPcm, 400, 200, 800);
    const blockedA = toneMagnitude(directPcm, 400, 1200, 1800);
    const blockedC = toneMagnitude(directPcm, 1000, 1200, 1800);
    const beforeC = toneMagnitude(directPcm, 1000, 200, 800);
    assert.ok(beforeA > 0.004, `Sender A missing outside block: ${beforeA}`);
    assert.ok(blockedA < beforeA * 0.07, `Sender A leaked during block: ${blockedA}/${beforeA}`);
    assert.ok(blockedC > beforeC * 0.65, `Sender C lost during A block: ${blockedC}/${beforeC}`);
    console.log(`VOICE_DIRECTIONAL_MIX_SYNTHETIC=PASS | durationMs=${(directPcm.length / 48).toFixed(2)} | ABlockedRatio=${(blockedA / beforeA).toFixed(3)} | CPreservedRatio=${(blockedC / beforeC).toFixed(3)}`);

    const datasetPath = join(tempRoot, "synthetic.vmehrtf");
    await writeFile(datasetPath, datasetBuffer());
    const renderer = new VoicePersonalHrtfRecordingRenderer({ storageRoot: tempRoot, datasetPath });
    const pathB = join(sessionDirectory, "test-b.ogg");
    const pathC = join(sessionDirectory, "test-c.ogg");
    await renderer.render({ sessionId, listenerUserId: "user-b", outputPath: pathB,
        speakerBlockedIntervalsByConnectionId: planB.blockedIntervalsBySenderConnectionId, authorizedIntervals });
    await renderer.render({ sessionId, listenerUserId: "user-c", outputPath: pathC,
        speakerBlockedIntervalsByConnectionId: planC.blockedIntervalsBySenderConnectionId, authorizedIntervals });
    const audioB = await decodeAudio(pathB);
    const audioC = await decodeAudio(pathC);
    assert.ok(Math.abs(audioB.length / 48 - durationMs) < 80, "HRTF B output duration changed");
    assert.ok(Math.abs(audioC.length / 48 - durationMs) < 80, "HRTF C output duration changed");
    const outsideB = toneMagnitude(audioB, 400, 200, 800);
    const deniedB = toneMagnitude(audioB, 400, 1200, 1800);
    const allowedC = toneMagnitude(audioB, 1000, 1200, 1800);
    const outsideC = toneMagnitude(audioB, 1000, 200, 800);
    const senderForC = toneMagnitude(audioC, 400, 1200, 1800);
    assert.ok(outsideB > 0.001, `HRTF baseline A missing: ${outsideB}`);
    assert.ok(deniedB < outsideB * 0.07, `HRTF A leaked to B: ${deniedB}/${outsideB}`);
    assert.ok(allowedC > outsideC * 0.65, `HRTF C lost to B during A mute: ${allowedC}/${outsideC}`);
    assert.ok(senderForC > outsideB * 0.65, `HRTF A lost for C without block: ${senderForC}/${outsideB}`);
    console.log(`VOICE_PERSONAL_HRTF_DIRECTIONAL_SYNTHETIC=PASS | durationBMs=${(audioB.length / 48).toFixed(2)} | durationCMs=${(audioC.length / 48).toFixed(2)} | deniedToBaseline=${(deniedB / outsideB).toFixed(3)} | otherPreserved=${(allowedC / outsideC).toFixed(3)} | unaffectedListener=${(senderForC / outsideB).toFixed(3)}`);
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}
