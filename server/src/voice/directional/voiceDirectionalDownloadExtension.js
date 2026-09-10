import {
    createHash
} from "node:crypto";

import {
    createReadStream
} from "node:fs";

import {
    mkdir,
    readFile,
    rename,
    rm,
    stat
} from "node:fs/promises";

import {
    dirname,
    join
} from "node:path";

import {
    spawn
} from "node:child_process";

import {
    VoiceRecordingDownloadService,
    authorizedIntervalsCoverFullRecording
} from "../recording/voiceRecordingDownloadService.js";

import {
    readVoiceDirectionalTimeline
} from "./voiceDirectionalRecordingTimeline.js";

const DIRECTIONAL_DOWNLOAD_EXTENSION_APPLIED = Symbol.for(
    "network_a.voice.directional.download_extension.applied"
);

const directionalPersonalizedRecordingCreationByPath = new Map();

function applyVoiceDirectionalDownloadExtension() {
    const prototype = VoiceRecordingDownloadService.prototype;
    if (prototype[DIRECTIONAL_DOWNLOAD_EXTENSION_APPLIED] === true) return;

    const originalResolveDownload = prototype.resolveDownload;

    prototype.resolveDownload = async function resolveDownloadWithDirectionalTimeline(args = {}) {
        const baseDownload = await originalResolveDownload.call(this, args);

        const sessionDirectory = dirname(baseDownload.metadataPath);
        const metadata = JSON.parse(
            await readFile(baseDownload.metadataPath, "utf8")
        );

        const events = await readVoiceDirectionalTimeline({
            sessionDirectory,
            sessionId: baseDownload.sessionId
        });

        if (events.length === 0) {
            return baseDownload;
        }

        const normalizedUserId = String(args?.userId ?? "").trim();
        const receiverMemberships = metadata.participants.filter(
            (participant) =>
                String(participant?.userId ?? "").trim() === normalizedUserId
        );

        if (receiverMemberships.length === 0) {
            return baseDownload;
        }

        const directionalPlan = buildDirectionalDownloadPlan({
            metadata,
            receiverMemberships,
            events
        });

        if (!directionalPlan.hasBlockedIntervals) {
            return baseDownload;
        }

        for (const [senderConnectionId, intervals] of directionalPlan.blockedIntervalsBySenderConnectionId) {
            console.log(
                `VOICE_DIRECTIONAL_DOWNLOAD_ROUTE | sessionId=${baseDownload.sessionId}` +
                ` | receiverConnectionIds=${directionalPlan.receiverConnectionIds.join(",")}` +
                ` | senderConnectionId=${senderConnectionId}` +
                ` | blockedIntervalsMs=${intervals.map((interval) => `${interval.startOffsetMs}-${interval.endOffsetMs}`).join(",")}`
            );
        }

        const compactedAuthorizedIntervals = subtractIntervals(
            normalizeAuthorizedIntervals(
                baseDownload.authorizedIntervals,
                directionalPlan.durationMs
            ),
            directionalPlan.blockedIntervalsForReceiver
        );

        if (compactedAuthorizedIntervals.length === 0) {
            const error = new Error(
                "Directional Voice download contains no authorized timeline after directional cuts."
            );
            error.code = "VOICE_DIRECTIONAL_DOWNLOAD_EMPTY";
            throw error;
        }

        const removedDurationMs = directionalPlan.blockedIntervalsForReceiver
            .reduce(
                (total, interval) =>
                    total + Math.max(0, interval.endOffsetMs - interval.startOffsetMs),
                0
            );

        console.log(
            `VOICE_DIRECTIONAL_DOWNLOAD_CUT | sessionId=${baseDownload.sessionId}` +
            ` | receiverConnectionIds=${directionalPlan.receiverConnectionIds.join(",")}` +
            ` | cutIntervalsMs=${directionalPlan.blockedIntervalsForReceiver.map((interval) => `${interval.startOffsetMs}-${interval.endOffsetMs}`).join(",")}` +
            ` | removedDurationMs=${removedDurationMs}`
        );

        const personalized = await createDirectionalPersonalizedRecording({
            sessionDirectory,
            metadata,
            userId: normalizedUserId,
            authorizedIntervals: compactedAuthorizedIntervals,
            directionalPlan,
            ffmpegPath: this.clipService?.ffmpegPath ??
                process.env.VOICE_RECORDING_FFMPEG_PATH ??
                "ffmpeg"
        });

        console.log(
            `VOICE_DIRECTIONAL_DOWNLOAD_READY | sessionId=${baseDownload.sessionId}` +
            ` | receiverUserIdHash=${hashLogValue(normalizedUserId)}` +
            ` | blockedRouteCount=${directionalPlan.blockedRouteCount}` +
            ` | blockedIntervalCount=${directionalPlan.blockedIntervalCount}` +
            ` | output=${personalized.fileName}`
        );

        return Object.freeze({
            ...baseDownload,
            recordingPath: personalized.recordingPath,
            fileName: personalized.fileName,
            contentType: "audio/ogg",
            contentLength: personalized.contentLength,
            checksumSha256: personalized.checksumSha256,
            downloadMode: "directional_personalized_mix",
            sourceChecksumSha256:
                baseDownload.sourceChecksumSha256 ??
                metadata.checksumSha256 ??
                null
        });
    };

    Object.defineProperty(prototype, DIRECTIONAL_DOWNLOAD_EXTENSION_APPLIED, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true
    });

    console.log("VOICE_DIRECTIONAL_DOWNLOAD_EXTENSION=READY");
}

function buildDirectionalDownloadPlan({
    metadata,
    receiverMemberships,
    events
} = {}) {
    const startedAtMs = normalizeMilliseconds(metadata?.startedAtMs);
    const endedAtMs = Math.max(
        startedAtMs,
        normalizeMilliseconds(metadata?.endedAtMs, startedAtMs)
    );
    const durationMs = Math.max(
        0,
        normalizeMilliseconds(
            metadata?.durationMs,
            endedAtMs - startedAtMs
        )
    );

    const receiverByConnectionId = new Map();
    for (const membership of receiverMemberships ?? []) {
        const connectionId = normalizeId(membership?.connectionId);
        if (!connectionId) continue;

        receiverByConnectionId.set(
            connectionId,
            normalizeParticipantMembershipIntervals(
                membership,
                durationMs
            )
        );
    }

    const blockedIntervalsBySenderConnectionId = new Map();
    let blockedRouteCount = 0;
    let blockedIntervalCount = 0;

    for (const participant of metadata?.participants ?? []) {
        const senderConnectionId = normalizeId(
            participant?.connectionId
        );
        if (!senderConnectionId) continue;

        const senderUserId = String(
            participant?.userId ?? ""
        ).trim();

        if (
            receiverMemberships.some(
                (membership) =>
                    normalizeId(membership?.connectionId) ===
                    senderConnectionId
            ) ||
            receiverMemberships.some(
                (membership) =>
                    String(membership?.userId ?? "").trim() === senderUserId &&
                    normalizeId(membership?.connectionId) === senderConnectionId
            )
        ) {
            continue;
        }

        const senderBlockedIntervals = [];

        for (const [receiverConnectionId, receiverIntervals] of receiverByConnectionId) {
            const routeEvents = events.filter(
                (event) =>
                    normalizeId(event?.senderConnectionId) === senderConnectionId &&
                    normalizeId(event?.receiverConnectionId) === receiverConnectionId
            );

            if (routeEvents.length === 0) continue;

            const routeBlockedIntervals = buildEffectiveBlockedIntervals({
                events: routeEvents,
                startedAtMs,
                endedAtMs
            });

            const effectiveIntervals = intersectIntervals(
                routeBlockedIntervals,
                receiverIntervals
            );

            if (effectiveIntervals.length === 0) continue;

            blockedRouteCount += 1;
            blockedIntervalCount += effectiveIntervals.length;
            senderBlockedIntervals.push(...effectiveIntervals);
        }

        const merged = mergeIntervals(senderBlockedIntervals);
        if (merged.length > 0) {
            blockedIntervalsBySenderConnectionId.set(
                senderConnectionId,
                merged
            );
        }
    }

    const blockedIntervalsForReceiver = mergeIntervals(
        Array.from(blockedIntervalsBySenderConnectionId.values()).flat()
    );

    return Object.freeze({
        startedAtMs,
        endedAtMs,
        durationMs,
        receiverConnectionIds: Object.freeze(
            Array.from(receiverByConnectionId.keys())
        ),
        blockedRouteCount,
        blockedIntervalCount,
        hasBlockedIntervals:
            blockedIntervalsBySenderConnectionId.size > 0,
        blockedIntervalsBySenderConnectionId,
        blockedIntervalsForReceiver
    });
}

function buildEffectiveBlockedIntervals({
    events,
    startedAtMs,
    endedAtMs
} = {}) {
    const startMs = normalizeMilliseconds(startedAtMs);
    const endMs = Math.max(
        startMs,
        normalizeMilliseconds(endedAtMs, startMs)
    );

    const orderedEvents = (Array.isArray(events) ? events : [])
        .filter((event) => {
            const changedAtMs = normalizeMilliseconds(event?.changedAtMs);
            return changedAtMs >= startMs && changedAtMs <= endMs;
        })
        .sort(
            (left, right) =>
                normalizeMilliseconds(left.changedAtMs) -
                normalizeMilliseconds(right.changedAtMs)
        );

    let senderMicBlocked = false;
    let receiverSpeakerBlocked = false;
    let effectiveBlocked = false;
    let blockedStartedAtMs = null;
    const intervals = [];

    for (const event of orderedEvents) {
        const changedAtMs = Math.min(
            endMs,
            Math.max(
                startMs,
                normalizeMilliseconds(event.changedAtMs)
            )
        );

        if (event.source === "sender_mic") {
            senderMicBlocked = event.blocked === true;
        } else if (event.source === "receiver_speaker") {
            receiverSpeakerBlocked = event.blocked === true;
        } else {
            continue;
        }

        const nextEffectiveBlocked =
            senderMicBlocked || receiverSpeakerBlocked;

        if (!effectiveBlocked && nextEffectiveBlocked) {
            blockedStartedAtMs = changedAtMs;
        } else if (
            effectiveBlocked &&
            !nextEffectiveBlocked &&
            blockedStartedAtMs !== null &&
            changedAtMs > blockedStartedAtMs
        ) {
            intervals.push({
                startOffsetMs:
                    blockedStartedAtMs - startMs,
                endOffsetMs:
                    changedAtMs - startMs
            });
            blockedStartedAtMs = null;
        }

        effectiveBlocked = nextEffectiveBlocked;
    }

    if (
        effectiveBlocked &&
        blockedStartedAtMs !== null &&
        endMs > blockedStartedAtMs
    ) {
        intervals.push({
            startOffsetMs:
                blockedStartedAtMs - startMs,
            endOffsetMs:
                endMs - startMs
        });
    }

    return mergeIntervals(intervals);
}

async function createDirectionalPersonalizedRecording({
    sessionDirectory,
    metadata,
    userId,
    authorizedIntervals,
    directionalPlan,
    ffmpegPath = "ffmpeg"
} = {}) {
    const participants = Array.isArray(metadata?.participants)
        ? metadata.participants
        : [];

    const inputs = [];

    for (const participant of participants) {
        const connectionId = normalizeId(
            participant?.connectionId
        );
        if (!connectionId) continue;

        const inputPath = join(
            sessionDirectory,
            "participants",
            `${connectionId}.ogg`
        );

        try {
            const inputStat = await stat(inputPath);
            if (!inputStat.isFile()) continue;
        } catch {
            continue;
        }

        inputs.push({
            connectionId,
            inputPath,
            blockedIntervals:
                directionalPlan.blockedIntervalsBySenderConnectionId.get(
                    connectionId
                ) ?? []
        });
    }

    if (inputs.length === 0) {
        throw new Error(
            "Directional Voice download has no participant recordings."
        );
    }

    const sourceChecksumSha256 = String(
        metadata?.checksumSha256 ?? ""
    );

    const signature = createHash("sha256")
        .update(
            JSON.stringify({
                version: 2,
                sessionId: metadata.sessionId,
                userId,
                sourceChecksumSha256,
                authorizedIntervals,
                routes: inputs.map((input) => ({
                    connectionId: input.connectionId,
                    blockedIntervals: input.blockedIntervals
                }))
            })
        )
        .digest("hex");

    const outputDirectory = join(
        sessionDirectory,
        "directional-downloads"
    );

    await mkdir(outputDirectory, {
        recursive: true,
        mode: 0o750
    });

    const fileName =
        `voice-session-${metadata.sessionId}-personal-${signature.slice(0, 16)}.ogg`;
    const finalPath = join(outputDirectory, fileName);

    try {
        const existingStat = await stat(finalPath);
        if (existingStat.isFile()) {
            return Object.freeze({
                recordingPath: finalPath,
                fileName,
                contentLength: existingStat.size,
                checksumSha256:
                    await calculateFileChecksum(finalPath)
            });
        }
    } catch {
    }

    const existingCreation =
        directionalPersonalizedRecordingCreationByPath.get(
            finalPath
        );

    if (existingCreation) {
        console.log(
            `VOICE_DIRECTIONAL_DOWNLOAD_SINGLE_FLIGHT_WAIT | sessionId=${metadata.sessionId}` +
            ` | output=${fileName}`
        );
        return await existingCreation;
    }

    const creation = createDirectionalPersonalizedRecordingFile({
        inputs,
        finalPath,
        fileName,
        authorizedIntervals,
        durationMs: directionalPlan.durationMs,
        ffmpegPath
    });

    directionalPersonalizedRecordingCreationByPath.set(
        finalPath,
        creation
    );

    try {
        return await creation;
    } finally {
        if (
            directionalPersonalizedRecordingCreationByPath.get(
                finalPath
            ) === creation
        ) {
            directionalPersonalizedRecordingCreationByPath.delete(
                finalPath
            );
        }
    }
}

async function createDirectionalPersonalizedRecordingFile({
    inputs,
    finalPath,
    fileName,
    authorizedIntervals,
    durationMs,
    ffmpegPath
} = {}) {
    const partialPath =
        `${finalPath}.${process.pid}.${Date.now()}.partial`;

    try {
        await createDirectionalMixFile({
            inputs,
            outputPath: partialPath,
            authorizedIntervals,
            durationMs,
            ffmpegPath
        });

        await rename(partialPath, finalPath);
    } catch (error) {
        await rm(partialPath, {
            force: true
        }).catch(() => {});
        throw error;
    }

    const outputStat = await stat(finalPath);

    return Object.freeze({
        recordingPath: finalPath,
        fileName,
        contentLength: outputStat.size,
        checksumSha256:
            await calculateFileChecksum(finalPath)
    });
}

async function createDirectionalMixFile({
    inputs,
    outputPath,
    authorizedIntervals,
    durationMs,
    ffmpegPath
} = {}) {
    const args = [
        "-hide_banner",
        "-nostdin",
        "-y"
    ];

    for (const input of inputs) {
        args.push("-i", input.inputPath);
    }

    const filterParts = [];
    const participantLabels = [];

    inputs.forEach((input, index) => {
        const label = `p${index}`;
        const muteFilters = input.blockedIntervals
            .map(
                (interval) =>
                    `volume=volume=0:enable='between(t,${formatSeconds(interval.startOffsetMs)},${formatSeconds(interval.endOffsetMs)})'`
            );

        const chain = muteFilters.length > 0
            ? muteFilters.join(",")
            : "anull";

        filterParts.push(
            `[${index}:a]${chain}[${label}]`
        );
        participantLabels.push(`[${label}]`);
    });

    filterParts.push(
        `${participantLabels.join("")}amix=inputs=${participantLabels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,aresample=48000[mixed]`
    );

    const intervals = normalizeAuthorizedIntervals(
        authorizedIntervals,
        durationMs
    );

    if (
        authorizedIntervalsCoverFullRecording(
            intervals,
            durationMs
        )
    ) {
        filterParts.push("[mixed]anull[aout]");
    } else if (intervals.length === 1) {
        filterParts.push(
            `[mixed]atrim=start=${formatSeconds(intervals[0].startOffsetMs)}:end=${formatSeconds(intervals[0].endOffsetMs)},asetpts=PTS-STARTPTS[aout]`
        );
    } else {
        const splitLabels = intervals
            .map((_, index) => `[s${index}]`)
            .join("");

        filterParts.push(
            `[mixed]asplit=${intervals.length}${splitLabels}`
        );

        intervals.forEach((interval, index) => {
            filterParts.push(
                `[s${index}]atrim=start=${formatSeconds(interval.startOffsetMs)}:end=${formatSeconds(interval.endOffsetMs)},asetpts=PTS-STARTPTS[c${index}]`
            );
        });

        const clipLabels = intervals
            .map((_, index) => `[c${index}]`)
            .join("");

        filterParts.push(
            `${clipLabels}concat=n=${intervals.length}:v=0:a=1[aout]`
        );
    }

    args.push(
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        "[aout]",
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
    );

    await runProcess(
        ffmpegPath,
        args
    );
}

function normalizeParticipantMembershipIntervals(
    participant,
    durationMs
) {
    const rawIntervals = Array.isArray(participant?.intervals)
        ? participant.intervals
        : [];

    return mergeIntervals(
        rawIntervals.map((interval) => ({
            startOffsetMs: Math.min(
                durationMs,
                normalizeMilliseconds(
                    interval?.startOffsetMs
                )
            ),
            endOffsetMs: Math.min(
                durationMs,
                normalizeMilliseconds(
                    interval?.endOffsetMs,
                    durationMs
                )
            )
        }))
    );
}

function normalizeAuthorizedIntervals(intervals, durationMs) {
    return mergeIntervals(
        (Array.isArray(intervals) ? intervals : [])
            .map((interval) => ({
                startOffsetMs: Math.min(
                    durationMs,
                    normalizeMilliseconds(
                        interval?.startOffsetMs
                    )
                ),
                endOffsetMs: Math.min(
                    durationMs,
                    normalizeMilliseconds(
                        interval?.endOffsetMs,
                        durationMs
                    )
                )
            }))
    );
}

function intersectIntervals(leftIntervals, rightIntervals) {
    const result = [];

    for (const left of leftIntervals ?? []) {
        for (const right of rightIntervals ?? []) {
            const startOffsetMs = Math.max(
                left.startOffsetMs,
                right.startOffsetMs
            );
            const endOffsetMs = Math.min(
                left.endOffsetMs,
                right.endOffsetMs
            );

            if (endOffsetMs > startOffsetMs) {
                result.push({
                    startOffsetMs,
                    endOffsetMs
                });
            }
        }
    }

    return mergeIntervals(result);
}

function subtractIntervals(allowedIntervals, blockedIntervals) {
    const allowed = mergeIntervals(allowedIntervals);
    const blocked = mergeIntervals(blockedIntervals);

    if (allowed.length === 0 || blocked.length === 0) {
        return allowed;
    }

    const result = [];

    for (const allowedInterval of allowed) {
        let cursor = allowedInterval.startOffsetMs;

        for (const blockedInterval of blocked) {
            if (blockedInterval.endOffsetMs <= cursor) continue;
            if (blockedInterval.startOffsetMs >= allowedInterval.endOffsetMs) break;

            const cutStart = Math.max(
                cursor,
                blockedInterval.startOffsetMs
            );
            const cutEnd = Math.min(
                allowedInterval.endOffsetMs,
                blockedInterval.endOffsetMs
            );

            if (cutStart > cursor) {
                result.push({
                    startOffsetMs: cursor,
                    endOffsetMs: cutStart
                });
            }

            cursor = Math.max(cursor, cutEnd);
            if (cursor >= allowedInterval.endOffsetMs) break;
        }

        if (cursor < allowedInterval.endOffsetMs) {
            result.push({
                startOffsetMs: cursor,
                endOffsetMs: allowedInterval.endOffsetMs
            });
        }
    }

    return mergeIntervals(result);
}

function mergeIntervals(intervals) {
    const normalized = (Array.isArray(intervals) ? intervals : [])
        .map((interval) => ({
            startOffsetMs: normalizeMilliseconds(
                interval?.startOffsetMs
            ),
            endOffsetMs: normalizeMilliseconds(
                interval?.endOffsetMs
            )
        }))
        .filter(
            (interval) =>
                interval.endOffsetMs > interval.startOffsetMs
        )
        .sort(
            (left, right) =>
                left.startOffsetMs - right.startOffsetMs ||
                left.endOffsetMs - right.endOffsetMs
        );

    if (normalized.length === 0) {
        return Object.freeze([]);
    }

    const merged = [{ ...normalized[0] }];

    for (let index = 1; index < normalized.length; index += 1) {
        const current = normalized[index];
        const previous = merged[merged.length - 1];

        if (current.startOffsetMs <= previous.endOffsetMs) {
            previous.endOffsetMs = Math.max(
                previous.endOffsetMs,
                current.endOffsetMs
            );
            continue;
        }

        merged.push({ ...current });
    }

    return Object.freeze(
        merged.map((interval) => Object.freeze(interval))
    );
}

async function calculateFileChecksum(filePath) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest("hex");
}

async function runProcess(command, args, timeoutMs = 120000) {
    return await new Promise((resolve, reject) => {
        let settled = false;
        let stderr = "";

        const child = spawn(command, args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };

        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            const error = new Error(
                `${command} timed out.`
            );
            error.code = "VOICE_DIRECTIONAL_DOWNLOAD_TIMEOUT";
            finish(reject, error);
        }, timeoutMs);

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
            if (stderr.length > 12000) {
                stderr = stderr.slice(-12000);
            }
        });

        child.on("error", (error) => {
            finish(reject, error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                finish(resolve);
                return;
            }

            const error = new Error(
                `${command} failed with exit code ${code}: ${stderr}`
            );
            error.code = "VOICE_DIRECTIONAL_DOWNLOAD_FAILED";
            finish(reject, error);
        });
    });
}

function formatSeconds(valueMs) {
    return (
        normalizeMilliseconds(valueMs) / 1000
    ).toFixed(3);
}

function normalizeMilliseconds(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return Math.max(0, Math.floor(Number(fallback) || 0));
    }
    return Math.max(0, Math.floor(number));
}

function normalizeId(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase();
}

function hashLogValue(value) {
    return createHash("sha256")
        .update(String(value ?? ""))
        .digest("hex")
        .slice(0, 12);
}

export {
    applyVoiceDirectionalDownloadExtension,
    buildDirectionalDownloadPlan,
    buildEffectiveBlockedIntervals,
    createDirectionalPersonalizedRecording,
    intersectIntervals,
    mergeIntervals,
    subtractIntervals
};
