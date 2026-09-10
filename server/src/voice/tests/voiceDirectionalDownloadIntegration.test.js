import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { VoiceRecordingDownloadService } from "../recording/voiceRecordingDownloadService.js";
import {
    applyVoiceDirectionalDownloadExtension,
    createDirectionalPersonalizedRecording
} from "../directional/voiceDirectionalDownloadExtension.js";

applyVoiceDirectionalDownloadExtension();

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk.toString("utf8"));
        child.stderr.on("data", (chunk) => stderr += chunk.toString("utf8"));
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr)));
    });
}

async function checksum(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
}

const root = await mkdtemp(join(tmpdir(), "voice-directional-download-int-"));
const sessionId = "33333333-3333-4333-8333-333333333333";
const dir = join(root, sessionId);
const participantsDir = join(dir, "participants");
await mkdir(participantsDir, { recursive: true });

const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=4", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32000", join(participantsDir, `${a}.ogg`)]);
    for (const id of [b, c]) {
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "4", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32000", join(participantsDir, `${id}.ogg`)]);
    }

    const sessionPath = join(dir, "session.ogg");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", join(participantsDir, `${a}.ogg`), "-i", join(participantsDir, `${b}.ogg`), "-i", join(participantsDir, `${c}.ogg`), "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:duration=longest:normalize=0[a]", "-map", "[a]", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32000", sessionPath]);

    const startedAtMs = 100000;
    const endedAtMs = 104000;
    const metadata = {
        version: 2,
        recordingContract: "G4.RD1",
        authorizationModel: "user_intervals_from_session_json",
        sessionId,
        roomId: "room-test",
        serverId: "server-test",
        startedAtMs,
        endedAtMs,
        durationMs: 4000,
        checksumSha256: await checksum(sessionPath),
        participants: [
            { userId: "user-a", connectionId: a, intervals: [{ joinedAtMs: startedAtMs, leftAtMs: endedAtMs, startOffsetMs: 0, endOffsetMs: 4000 }] },
            { userId: "user-b", connectionId: b, intervals: [{ joinedAtMs: startedAtMs, leftAtMs: endedAtMs, startOffsetMs: 0, endOffsetMs: 4000 }] },
            { userId: "user-c", connectionId: c, intervals: [{ joinedAtMs: startedAtMs, leftAtMs: endedAtMs, startOffsetMs: 0, endOffsetMs: 4000 }] }
        ]
    };
    await writeFile(join(dir, "session.json"), JSON.stringify(metadata, null, 2));
    await writeFile(join(dir, "directional-events.ndjson"), [
        JSON.stringify({ version: 1, sessionId, source: "sender_mic", senderConnectionId: a, receiverConnectionId: b, blocked: true, changedAtMs: 101000, offsetMs: 1000 }),
        JSON.stringify({ version: 1, sessionId, source: "sender_mic", senderConnectionId: a, receiverConnectionId: b, blocked: false, changedAtMs: 102500, offsetMs: 2500 })
    ].join("\n") + "\n");

    const service = new VoiceRecordingDownloadService({ storageRoot: root });
    const bDownload = await service.resolveDownload({ sessionId, userId: "user-b" });
    const cDownload = await service.resolveDownload({ sessionId, userId: "user-c" });

    assert.equal(bDownload.downloadMode, "directional_personalized_mix");
    assert.notEqual(bDownload.recordingPath, sessionPath);
    assert.equal(cDownload.downloadMode, "full_session_passthrough");
    assert.equal(cDownload.recordingPath, sessionPath);
    assert.notEqual(bDownload.checksumSha256, cDownload.checksumSha256);

    const duration = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", bDownload.recordingPath]);
    const durationSeconds = Number.parseFloat(duration.stdout.trim());
    assert.ok(durationSeconds >= 2.45 && durationSeconds <= 2.60);

    const fakeFfmpegPath = join(root, "counted-ffmpeg.mjs");
    const invocationPath = join(root, "counted-ffmpeg-invocations.log");
    await writeFile(fakeFfmpegPath, [
        "#!/usr/bin/env node",
        "import { appendFile } from \"node:fs/promises\";",
        "import { spawn } from \"node:child_process\";",
        `await appendFile(${JSON.stringify(invocationPath)}, \"1\\n\");`,
        "await new Promise((resolve) => setTimeout(resolve, 150));",
        "const child = spawn(\"ffmpeg\", process.argv.slice(2), { stdio: \"inherit\" });",
        "child.on(\"error\", (error) => { console.error(error); process.exit(1); });",
        "child.on(\"close\", (code) => process.exit(code ?? 1));"
    ].join("\n") + "\n");
    await chmod(fakeFfmpegPath, 0o750);

    const concurrentPlan = {
        durationMs: 4000,
        blockedIntervalsBySenderConnectionId: new Map([
            [a, [{ startOffsetMs: 1000, endOffsetMs: 2500 }]]
        ])
    };
    const concurrentAuthorizedIntervals = [
        { startOffsetMs: 0, endOffsetMs: 1000 },
        { startOffsetMs: 2500, endOffsetMs: 4000 }
    ];
    const concurrentResults = await Promise.all(
        Array.from({ length: 10 }, () =>
            createDirectionalPersonalizedRecording({
                sessionDirectory: dir,
                metadata,
                userId: "user-b-single-flight",
                authorizedIntervals: concurrentAuthorizedIntervals,
                directionalPlan: concurrentPlan,
                ffmpegPath: fakeFfmpegPath
            })
        )
    );

    const invocations = (await readFile(invocationPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean);
    assert.equal(invocations.length, 1);
    assert.equal(new Set(concurrentResults.map((result) => result.recordingPath)).size, 1);
    assert.equal(new Set(concurrentResults.map((result) => result.checksumSha256)).size, 1);
    assert.equal(new Set(concurrentResults.map((result) => result.contentLength)).size, 1);

    const directionalDownloadFiles = await readdir(
        join(dir, "directional-downloads")
    );
    assert.equal(
        directionalDownloadFiles.some((name) => name.endsWith(".partial")),
        false
    );

    console.log("VOICE_DIRECTIONAL_DOWNLOAD_INTEGRATION=PASS");
    console.log("VOICE_DIRECTIONAL_DOWNLOAD_SINGLE_FLIGHT=PASS");
} finally {
    await rm(root, { recursive: true, force: true });
}
