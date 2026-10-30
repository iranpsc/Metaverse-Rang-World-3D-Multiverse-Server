import "dotenv/config";

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { tokenService } from "../../../core/auth/auth.instance.js";
import { readVoiceDirectionalTimeline } from "../../directional/voiceDirectionalRecordingTimeline.js";
import {
    buildDirectionalDownloadPlan,
    mergeIntervals
} from "../../directional/voiceDirectionalDownloadExtension.js";

const storageRoot = String(
    process.env.METAVERSE_VOICE_RECORDING_STORAGE_ROOT ??
    "/home/world3d/data/metaverse-voice-recordings"
).trim();

const sessionId = String(process.env.SID ?? "").trim().toLowerCase();
if (!sessionId) throw new Error("SID is required for directional HRTF regression test.");

const sessionDirectory = join(storageRoot, sessionId);
const metadata = JSON.parse(await readFile(join(sessionDirectory, "session.json"), "utf8"));
const events = await readVoiceDirectionalTimeline({ sessionDirectory, sessionId });
if (!events.length) throw new Error("Selected session has no directional events.");

const firstDirectionalEvent = events.find((event) =>
    event?.senderConnectionId && event?.receiverConnectionId
);
if (!firstDirectionalEvent) throw new Error("No usable directional event found.");

const receiverConnectionId = String(firstDirectionalEvent.receiverConnectionId).trim().toLowerCase();
const receiver = metadata.participants.find(
    (participant) => String(participant?.connectionId ?? "").trim().toLowerCase() === receiverConnectionId
);
if (!receiver?.userId) throw new Error("Directional receiver participant not found.");

const receiverMemberships = metadata.participants.filter(
    (participant) => String(participant?.userId ?? "").trim() === String(receiver.userId).trim()
);
const plan = buildDirectionalDownloadPlan({ metadata, receiverMemberships, events });
if (!plan.hasBlockedIntervals) throw new Error("Directional plan contains no blocked interval.");

const mergedBlocked = mergeIntervals(plan.blockedIntervalsForReceiver);
const blockedDurationMs = mergedBlocked.reduce(
    (total, interval) => total + Math.max(0, interval.endOffsetMs - interval.startOffsetMs),
    0
);
const expectedDurationMs = Number(metadata.durationMs);
if (!(expectedDurationMs > 0 && blockedDurationMs > 0 && blockedDurationMs <= expectedDurationMs)) {
    throw new Error("Directional session duration or blocked intervals are invalid.");
}

const token = tokenService.createAccessToken({ id: receiver.userId });
const baseUrl = String(process.env.VOICE_PRIMARY_DOWNLOAD_TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const response = await fetch(`${baseUrl}/voice/recordings/${sessionId}/download`, {
    headers: {
        Authorization: `Bearer ${token}`,
        Accept: "audio/ogg"
    }
});
const bytes = Buffer.from(await response.arrayBuffer());
const mode = String(response.headers.get("x-voice-recording-download-mode") ?? "");
const renderer = String(response.headers.get("x-voice-recording-primary-renderer") ?? "");

if (response.status !== 200 || mode !== "personal_hrtf_binaural" || renderer !== "hrtf") {
    throw new Error(`Primary HRTF download failed: status=${response.status} mode=${mode} renderer=${renderer}`);
}

const outputPath = `/tmp/vme2-hrtf-directional-cut-${sessionId}-${receiver.userId}.ogg`;
await writeFile(outputPath, bytes);

const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size",
    "-of", "default=noprint_wrappers=1",
    outputPath
], { encoding: "utf8" });
if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);

const durationLine = probe.stdout.split(/\r?\n/).find((line) => line.startsWith("duration="));
const actualDurationMs = Number(durationLine?.slice("duration=".length)) * 1000;
const durationErrorMs = Math.abs(actualDurationMs - expectedDurationMs);

console.log(
    "VOICE_HRTF_DIRECTIONAL_SILENCE_E2E" +
    ` | sessionId=${sessionId}` +
    ` | receiver=${receiver.userId}` +
    ` | originalDurationMs=${metadata.durationMs}` +
    ` | blockedMs=${blockedDurationMs}` +
    ` | expectedDurationMs=${expectedDurationMs}` +
    ` | actualDurationMs=${actualDurationMs.toFixed(1)}` +
    ` | errorMs=${durationErrorMs.toFixed(1)}` +
    ` | output=${outputPath}`
);

if (durationErrorMs > 250) {
    throw new Error("HRTF download changed the original session timeline duration.");
}

console.log("VME2_HRTF_DIRECTIONAL_TIMELINE_REGRESSION=PASS");
