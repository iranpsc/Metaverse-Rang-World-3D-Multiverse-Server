import {
    createHash
} from "node:crypto";

import {
    createReadStream
} from "node:fs";

import {
    readFile,
    readdir,
    stat
} from "node:fs/promises";

import {
    join
} from "node:path";

import {
    VoiceRecordingClipService
} from "./voiceRecordingClipService.js";

import {
    normalizeVoiceRecordingRoot
} from "./voiceRecordingService.js";

const SESSION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A user can only request their own early-leaver snapshot. Hashing the
// authenticated userId prevents directory traversal and makes directory
// enumeration unnecessary for single-session status probes.
function resolveRecordingPaths(sessionDirectory, normalizedUserId, early = false) {
    if (!early) return {
        metadataPath: join(sessionDirectory, "session.json"),
        recordingPath: join(sessionDirectory, "session.ogg")
    };
    const userKey = createHash("sha256")
        .update(normalizedUserId, "utf8").digest("hex");
    return {
        metadataPath: join(sessionDirectory, "early-leavers", `${userKey}.json`),
        recordingPath: join(sessionDirectory, "early-leavers", `${userKey}.ogg`)
    };
}

async function readAuthorizedRecordingSource({
    sessionDirectory, sessionId, userId, early = false
}) {
    const {metadataPath, recordingPath} = resolveRecordingPaths(
        sessionDirectory, userId, early
    );
    const [metadataJson, recordingStat] = await Promise.all([
        readFile(metadataPath, "utf8"), stat(recordingPath)
    ]);
    if (!recordingStat.isFile()) return null;
    const metadata = JSON.parse(metadataJson);
    if (
        String(metadata?.sessionId ?? "").toLowerCase() !== sessionId ||
        metadata?.recordingContract !== "G4.RD1" ||
        metadata?.authorizationModel !== "user_intervals_from_session_json" ||
        !Array.isArray(metadata?.participants) ||
        (early && metadata?.recordingVariant !== "early_leaver_snapshot_v1") ||
        (!early && metadata?.recordingVariant === "early_leaver_snapshot_v1")
    ) return null;
    const memberships = metadata.participants.filter(
        (p) => p?.userId === userId
    );
    if (memberships.length === 0) return null;
    const rawIntervals = memberships.flatMap((p) =>
        Array.isArray(p.intervals) ? p.intervals : []);
    if (rawIntervals.length === 0) return null;
    const membership = Object.freeze({
        userId, intervals: Object.freeze(rawIntervals)
    });
    const durationMs = resolveRecordingDurationMs(metadata);
    const authorizedIntervals = normalizeAuthorizedRecordingIntervals({
        metadata, membership
    });
    if (authorizedIntervals.length === 0) return null;
    return {
        metadataPath, recordingPath, metadata, membership,
        memberships, authorizedIntervals, durationMs, recordingStat, early
    };
}

async function chooseAuthorizedRecordingSource({
    sessionDirectory, sessionId, userId
}) {
    // Prefer complete recording when published. Until then, fall back to
    // the private early-leaver clip; never expose another member's file.
    for (const early of [false, true]) {
        try {
            const source = await readAuthorizedRecordingSource({
                sessionDirectory, sessionId, userId, early
            });
            if (source) return source;
        } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
        }
    }
    return null;
}

async function calculateRecordingFileChecksum(filePath) {
    const hash = createHash("sha256");

    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }

    return hash.digest("hex");
}

function normalizeRecordingMilliseconds(value, fallback = 0) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return Math.max(0, Math.floor(numericValue));
}

function resolveRecordingDurationMs(metadata) {
    const explicitDuration =
        normalizeRecordingMilliseconds(
            metadata?.durationMs,
            Number.NaN
        );

    if (Number.isFinite(explicitDuration)) {
        return explicitDuration;
    }

    return Math.max(
        0,
        normalizeRecordingMilliseconds(
            metadata?.endedAtMs
        ) -
            normalizeRecordingMilliseconds(
                metadata?.startedAtMs
            )
    );
}

function normalizeAuthorizedRecordingIntervals({
    metadata,
    membership
} = {}) {
    const durationMs =
        resolveRecordingDurationMs(metadata);

    const rawIntervals =
        Array.isArray(membership?.intervals) &&
        membership.intervals.length > 0
            ? membership.intervals
            : [
                {
                    joinedAtMs:
                        metadata?.startedAtMs,
                    leftAtMs:
                        metadata?.endedAtMs,
                    startOffsetMs: 0,
                    endOffsetMs: durationMs
                }
            ];

    const intervals = [];

    for (const rawInterval of rawIntervals) {
        const startOffsetMs =
            Math.min(
                durationMs,
                normalizeRecordingMilliseconds(
                    rawInterval?.startOffsetMs,
                    0
                )
            );

        const endOffsetMs =
            Math.min(
                durationMs,
                normalizeRecordingMilliseconds(
                    rawInterval?.endOffsetMs,
                    durationMs
                )
            );

        if (endOffsetMs <= startOffsetMs) {
            continue;
        }

        intervals.push(
            Object.freeze({
                joinedAtMs:
                    normalizeRecordingMilliseconds(
                        rawInterval?.joinedAtMs,
                        metadata?.startedAtMs ?? 0
                    ),
                leftAtMs:
                    normalizeRecordingMilliseconds(
                        rawInterval?.leftAtMs,
                        metadata?.endedAtMs ?? 0
                    ),
                startOffsetMs,
                endOffsetMs
            })
        );
    }

    intervals.sort(
        (left, right) =>
            left.startOffsetMs -
                right.startOffsetMs ||
            left.endOffsetMs -
                right.endOffsetMs
    );

    return Object.freeze(intervals);
}

function authorizedIntervalsCoverFullRecording(
    intervals,
    durationMs
) {
    const normalizedDurationMs =
        normalizeRecordingMilliseconds(durationMs);

    if (normalizedDurationMs === 0) {
        return true;
    }

    if (!Array.isArray(intervals) || intervals.length === 0) {
        return false;
    }

    let coveredUntilMs = 0;

    for (const interval of intervals) {
        if (interval.startOffsetMs > coveredUntilMs) {
            return false;
        }

        coveredUntilMs =
            Math.max(
                coveredUntilMs,
                interval.endOffsetMs
            );

        if (coveredUntilMs >= normalizedDurationMs) {
            return true;
        }
    }

    return false;
}

class VoiceRecordingDownloadService {
    constructor({
        storageRoot,
        clipService = null
    } = {}) {
        this.storageRoot =
            normalizeVoiceRecordingRoot(storageRoot);

        this.clipService =
            clipService ||
            new VoiceRecordingClipService({
                storageRoot: this.storageRoot
            });
    }

    async listRecordings({
        userId,
        sessionId = null
    } = {}) {
        const normalizedUserId =
            String(userId ?? "").trim();

        if (!normalizedUserId) {
            throw new TypeError(
                "Authenticated Voice recording userId is required."
            );
        }

        // A session-scoped status probe reads at most one metadata file;
        // the regular list keeps the original all-sessions authorization path.
        const hasSessionFilter = sessionId !== null && sessionId !== undefined;
        const requestedSessionId = hasSessionFilter
            ? String(sessionId).trim().toLowerCase()
            : "";
        if (hasSessionFilter && !SESSION_ID_PATTERN.test(requestedSessionId)) {
            return Object.freeze([]);
        }
        const entries = hasSessionFilter
            ? [{ name: requestedSessionId, isDirectory: () => true }]
            : await readdir(this.storageRoot, { withFileTypes: true });

        const recordings = [];

        for (const entry of entries) {
            if (
                !entry.isDirectory() ||
                !SESSION_ID_PATTERN.test(entry.name)
            ) {
                continue;
            }

            const normalizedSessionId =
                entry.name.toLowerCase();

            const sessionDirectory =
                join(
                    this.storageRoot,
                    entry.name
                );

            try {
                const source = await chooseAuthorizedRecordingSource({
                    sessionDirectory,
                    sessionId: normalizedSessionId,
                    userId: normalizedUserId
                });
                if (!source) continue;
                const fullRecordingAuthorized =
                    authorizedIntervalsCoverFullRecording(
                        source.authorizedIntervals, source.durationMs
                    );
                recordings.push(Object.freeze({
                    sessionId: normalizedSessionId,
                    startedAtMs: normalizeRecordingMilliseconds(
                        source.metadata.startedAtMs
                    ),
                    endedAtMs: normalizeRecordingMilliseconds(
                        source.metadata.endedAtMs
                    ),
                    durationMs: source.durationMs,
                    authorizedIntervalCount: source.authorizedIntervals.length,
                    downloadMode: source.early
                        ? "early_leaver_snapshot"
                        : fullRecordingAuthorized
                            ? "full_session_passthrough" : "authorized_clip"
                }));
            } catch {
                continue;
            }
        }

        recordings.sort(
            (left, right) =>
                right.endedAtMs - left.endedAtMs ||
                left.sessionId.localeCompare(
                    right.sessionId
                )
        );

        return Object.freeze(recordings);
    }

    async resolveDownload({
        sessionId,
        userId
    } = {}) {
        const normalizedSessionId =
            String(sessionId ?? "")
                .trim()
                .toLowerCase();

        const normalizedUserId =
            String(userId ?? "").trim();

        if (!SESSION_ID_PATTERN.test(normalizedSessionId)) {
            throw new TypeError(
                "Voice recording sessionId is invalid."
            );
        }

        if (!normalizedUserId) {
            throw new TypeError(
                "Authenticated Voice recording userId is required."
            );
        }

        const sessionDirectory =
            join(this.storageRoot, normalizedSessionId);

        const source = await chooseAuthorizedRecordingSource({
            sessionDirectory,
            sessionId: normalizedSessionId,
            userId: normalizedUserId
        });
        if (!source) {
            const error = new Error("Voice recording is not ready or is unauthorized.");
            error.code = "VOICE_RECORDING_FORBIDDEN";
            throw error;
        }
        const {
            metadataPath, recordingPath, metadata, durationMs,
            authorizedIntervals
        } = source;
        const memberships = source.memberships;
        const membership = memberships.length === 1
            ? memberships[0]
            : Object.freeze({
                userId: normalizedUserId,
                connectionId: null,
                connectionIds: Object.freeze(memberships.map((e) => e.connectionId)),
                intervals: Object.freeze(memberships.flatMap((e) => e.intervals ?? []))
            });

        const checksumSha256 =
            await calculateRecordingFileChecksum(
                recordingPath
            );

        if (
            checksumSha256 !==
            metadata.checksumSha256
        ) {
            throw new Error(
                "Voice recording checksum verification failed."
            );
        }

        const fileStat = await stat(recordingPath);

        if (!fileStat.isFile()) {
            throw new Error(
                "Voice recording path is not a file."
            );
        }

        const fullRecordingAuthorized =
            authorizedIntervalsCoverFullRecording(
                authorizedIntervals,
                durationMs
            );

        if (!fullRecordingAuthorized) {
            const clip =
                await this.clipService.createAuthorizedClip({
                    sessionId: normalizedSessionId,
                    userId: normalizedUserId,
                    sessionDirectory,
                    recordingPath,
                    metadata,
                    authorizedIntervals,
                    durationMs
                });

            return Object.freeze({
                sessionId: normalizedSessionId,
                recordingPath: clip.recordingPath,
                metadataPath,
                fileName: clip.fileName,
                contentType: clip.contentType,
                contentLength: clip.contentLength,
                checksumSha256: clip.checksumSha256,
                durationMs,
                recordingContract:
                    metadata.recordingContract ?? null,
                authorizationModel:
                    metadata.authorizationModel ??
                    "user_intervals_from_session_json",
                downloadMode: source.early
                    ? "early_leaver_authorized_clip" : clip.downloadMode,
                authorizedIntervals,
                membership:
                    Object.freeze({ ...membership }),
                sourceChecksumSha256:
                    checksumSha256
            });
        }

        return Object.freeze({
            sessionId: normalizedSessionId,
            recordingPath,
            metadataPath,
            fileName: source.early
                ? `voice-session-${normalizedSessionId}-early-leaver.ogg`
                : `voice-session-${normalizedSessionId}.ogg`,
            contentType: "audio/ogg",
            contentLength: fileStat.size,
            checksumSha256,
            durationMs,
            recordingContract:
                metadata.recordingContract ?? null,
            authorizationModel:
                metadata.authorizationModel ??
                "user_intervals_from_session_json",
            downloadMode: source.early
                ? "early_leaver_snapshot"
                : "full_session_passthrough",
            authorizedIntervals,
            membership:
                Object.freeze({ ...membership })
        });
    }
}

export {
    VoiceRecordingDownloadService,
    calculateRecordingFileChecksum,
    normalizeAuthorizedRecordingIntervals,
    authorizedIntervalsCoverFullRecording
};
