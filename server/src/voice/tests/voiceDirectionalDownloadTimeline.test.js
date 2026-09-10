import assert from "node:assert/strict";
import {
    mkdtemp,
    mkdir,
    rm,
    stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
    buildDirectionalDownloadPlan,
    buildEffectiveBlockedIntervals,
    createDirectionalPersonalizedRecording
} from "../directional/voiceDirectionalDownloadExtension.js";

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk) => stderr += chunk.toString("utf8"));
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
}

const startedAtMs = 100000;
const endedAtMs = 104000;
const events = [
    { source: "sender_mic", senderConnectionId: "a", receiverConnectionId: "b", blocked: true, changedAtMs: 101000 },
    { source: "receiver_speaker", senderConnectionId: "a", receiverConnectionId: "b", blocked: true, changedAtMs: 101500 },
    { source: "sender_mic", senderConnectionId: "a", receiverConnectionId: "b", blocked: false, changedAtMs: 102000 },
    { source: "receiver_speaker", senderConnectionId: "a", receiverConnectionId: "b", blocked: false, changedAtMs: 102500 }
];

assert.deepEqual(
    buildEffectiveBlockedIntervals({ events, startedAtMs, endedAtMs }),
    [{ startOffsetMs: 1000, endOffsetMs: 2500 }]
);

const metadata = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    startedAtMs,
    endedAtMs,
    durationMs: 4000,
    checksumSha256: "source-checksum",
    participants: [
        { userId: "user-a", connectionId: "a", intervals: [{ startOffsetMs: 0, endOffsetMs: 4000 }] },
        { userId: "user-b", connectionId: "b", intervals: [{ startOffsetMs: 0, endOffsetMs: 4000 }] },
        { userId: "user-c", connectionId: "c", intervals: [{ startOffsetMs: 0, endOffsetMs: 4000 }] }
    ]
};

const planB = buildDirectionalDownloadPlan({
    metadata,
    receiverMemberships: [metadata.participants[1]],
    events
});
assert.equal(planB.hasBlockedIntervals, true);
assert.deepEqual(planB.blockedIntervalsBySenderConnectionId.get("a"), [
    { startOffsetMs: 1000, endOffsetMs: 2500 }
]);

const planC = buildDirectionalDownloadPlan({
    metadata,
    receiverMemberships: [metadata.participants[2]],
    events
});
assert.equal(planC.hasBlockedIntervals, false);

const root = await mkdtemp(join(tmpdir(), "voice-directional-download-"));
try {
    const participantsDir = join(root, "participants");
    await mkdir(participantsDir, { recursive: true });

    await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=4",
        "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32000",
        join(participantsDir, "a.ogg")
    ]);
    for (const id of ["b", "c"]) {
        await run("ffmpeg", [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
            "-t", "4", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32000",
            join(participantsDir, `${id}.ogg`)
        ]);
    }

    const result = await createDirectionalPersonalizedRecording({
        sessionDirectory: root,
        metadata,
        userId: "user-b",
        authorizedIntervals: [{ startOffsetMs: 0, endOffsetMs: 4000 }],
        directionalPlan: planB,
        ffmpegPath: "ffmpeg"
    });

    const outputStat = await stat(result.recordingPath);
    assert.equal(outputStat.isFile(), true);
    assert.ok(outputStat.size > 0);

    console.log("VOICE_DIRECTIONAL_DOWNLOAD_TIMELINE=PASS");
} finally {
    await rm(root, { recursive: true, force: true });
}
