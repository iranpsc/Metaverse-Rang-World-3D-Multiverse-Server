import {
    createHash
} from "node:crypto";

import {
    spawn
} from "node:child_process";

import {
    createReadStream
} from "node:fs";

import {
    mkdir,
    rename,
    rm,
    stat
} from "node:fs/promises";

import {
    join
} from "node:path";

function normalizeClipMilliseconds(value, fallback = 0) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return Math.max(0, Math.floor(numericValue));
}

function formatClipSeconds(value) {
    return (
        normalizeClipMilliseconds(value) / 1000
    ).toFixed(3);
}

function resolveVoiceRecordingFfmpegPath() {
    return process.env.VOICE_RECORDING_FFMPEG_PATH || "ffmpeg";
}

async function calculateClipFileChecksum(filePath) {
    const hash = createHash("sha256");

    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }

    return hash.digest("hex");
}

async function runVoiceRecordingProcess(command, args, timeoutMs = 120000) {
    return await new Promise((resolve, reject) => {
        let settled = false;
        let stdout = "";
        let stderr = "";

        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"]
        });

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };

        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            const error = new Error(`${command} timed out.`);
            error.code = "VOICE_RECORDING_PROCESS_TIMEOUT";
            finish(reject, error);
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
            if (stdout.length > 8000) stdout = stdout.slice(-8000);
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
            if (stderr.length > 8000) stderr = stderr.slice(-8000);
        });

        child.on("error", (error) => {
            finish(reject, error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                finish(resolve, { stdout, stderr });
                return;
            }

            const error =
                new Error(`${command} failed with exit code ${code}: ${stderr}`);
            error.code = "VOICE_RECORDING_PROCESS_FAILED";
            finish(reject, error);
        });
    });
}

function normalizeClipIntervals(intervals, durationMs) {
    const normalizedDurationMs =
        normalizeClipMilliseconds(durationMs);

    if (!Array.isArray(intervals)) {
        return Object.freeze([]);
    }

    const normalizedIntervals = [];

    for (const interval of intervals) {
        const startOffsetMs =
            Math.min(
                normalizedDurationMs,
                normalizeClipMilliseconds(
                    interval?.startOffsetMs,
                    0
                )
            );

        const endOffsetMs =
            Math.min(
                normalizedDurationMs,
                normalizeClipMilliseconds(
                    interval?.endOffsetMs,
                    normalizedDurationMs
                )
            );

        if (endOffsetMs <= startOffsetMs) {
            continue;
        }

        normalizedIntervals.push(
            Object.freeze({
                startOffsetMs,
                endOffsetMs
            })
        );
    }

    normalizedIntervals.sort(
        (left, right) =>
            left.startOffsetMs -
                right.startOffsetMs ||
            left.endOffsetMs -
                right.endOffsetMs
    );

    return Object.freeze(normalizedIntervals);
}

function createClipSignature({
    sessionId,
    userId,
    sourceChecksumSha256,
    intervals,
    durationMs
} = {}) {
    return createHash("sha256")
        .update(
            JSON.stringify({
                sessionId,
                userId,
                sourceChecksumSha256,
                intervals,
                durationMs
            })
        )
        .digest("hex");
}

class VoiceRecordingClipService {
    constructor({
        storageRoot = "",
        ffmpegPath = null
    } = {}) {
        this.storageRoot = String(storageRoot ?? "");
        this.ffmpegPath =
            ffmpegPath || resolveVoiceRecordingFfmpegPath();
    }

    async createAuthorizedClip({
        sessionId,
        userId,
        sessionDirectory,
        recordingPath,
        metadata,
        authorizedIntervals,
        durationMs
    } = {}) {
        const normalizedSessionId =
            String(sessionId ?? "").trim().toLowerCase();

        const normalizedUserId =
            String(userId ?? "").trim();

        if (!normalizedSessionId || !normalizedUserId) {
            throw new TypeError(
                "Voice recording clip requires sessionId and userId."
            );
        }

        const intervals =
            normalizeClipIntervals(
                authorizedIntervals,
                durationMs
            );

        if (intervals.length === 0) {
            const error =
                new Error("Voice recording clip has no valid intervals.");
            error.code = "VOICE_RECORDING_CLIP_FAILED";
            throw error;
        }

        const sourceChecksumSha256 =
            String(metadata?.checksumSha256 ?? "");

        const clipsDirectory =
            join(sessionDirectory, "clips");

        await mkdir(clipsDirectory, {
            recursive: true,
            mode: 0o750
        });

        const signature =
            createClipSignature({
                sessionId: normalizedSessionId,
                userId: normalizedUserId,
                sourceChecksumSha256,
                intervals,
                durationMs
            });

        const fileName =
            `voice-session-${normalizedSessionId}-clip-${signature.slice(0, 16)}.ogg`;

        const finalPath =
            join(clipsDirectory, fileName);

        try {
            const existingStat =
                await stat(finalPath);

            if (existingStat.isFile()) {
                return Object.freeze({
                    recordingPath: finalPath,
                    fileName,
                    contentType: "audio/ogg",
                    contentLength: existingStat.size,
                    checksumSha256:
                        await calculateClipFileChecksum(finalPath),
                    downloadMode: "authorized_clip",
                    authorizedIntervals: intervals
                });
            }
        } catch {
        }

        const partialPath =
            `${finalPath}.${process.pid}.${Date.now()}.partial`;

        try {
            await this.createClipFile({
                inputPath: recordingPath,
                outputPath: partialPath,
                intervals
            });

            await rename(partialPath, finalPath);
        } catch (error) {
            await rm(partialPath, {
                force: true
            }).catch(() => {});

            const wrapped =
                new Error(
                    "Voice recording authorized clip creation failed."
                );
            wrapped.code = "VOICE_RECORDING_CLIP_FAILED";
            wrapped.cause = error;
            throw wrapped;
        }

        const fileStat =
            await stat(finalPath);

        if (!fileStat.isFile()) {
            const error =
                new Error("Voice recording clip output is not a file.");
            error.code = "VOICE_RECORDING_CLIP_FAILED";
            throw error;
        }

        return Object.freeze({
            recordingPath: finalPath,
            fileName,
            contentType: "audio/ogg",
            contentLength: fileStat.size,
            checksumSha256:
                await calculateClipFileChecksum(finalPath),
            downloadMode: "authorized_clip",
            authorizedIntervals: intervals
        });
    }

    async createClipFile({
        inputPath,
        outputPath,
        intervals
    } = {}) {
        const filters = [];

        for (let index = 0; index < intervals.length; index += 1) {
            const interval = intervals[index];

            filters.push(
                `[0:a]atrim=start=${formatClipSeconds(interval.startOffsetMs)}:end=${formatClipSeconds(interval.endOffsetMs)},asetpts=PTS-STARTPTS[a${index}]`
            );
        }

        let filterComplex = "";
        let outputLabel = "";

        if (intervals.length === 1) {
            filterComplex = filters[0];
            outputLabel = "[a0]";
        } else {
            const labels =
                intervals
                    .map((_, index) => `[a${index}]`)
                    .join("");

            filterComplex =
                `${filters.join(";")};${labels}concat=n=${intervals.length}:v=0:a=1[aout]`;
            outputLabel = "[aout]";
        }

        const args = [
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            inputPath,
            "-filter_complex",
            filterComplex,
            "-map",
            outputLabel,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-c:a",
            "libopus",
            "-b:a",
            "32000",
            "-application",
            "voip",
            "-f",
            "ogg",
            outputPath
        ];

        await runVoiceRecordingProcess(
            this.ffmpegPath,
            args
        );
    }
}

export {
    VoiceRecordingClipService,
    calculateClipFileChecksum,
    normalizeClipIntervals
};
