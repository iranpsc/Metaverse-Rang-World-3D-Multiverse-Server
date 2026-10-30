import {
    spawn
} from "node:child_process";

import {
    once
} from "node:events";

import {
    mkdir,
    readFile,
    rm,
    stat
} from "node:fs/promises";

import {
    basename,
    dirname,
    join
} from "node:path";

import {
    VoiceSpatialTimelineReader
} from "../recordingSpatial/voiceSpatialTimelineReader.js";

import {
    VoiceSpatialTimelineSampler
} from "../recordingSpatial/voiceSpatialTimelineSampler.js";

import {
    VoiceHrtfTrackRenderer
} from "./voiceHrtfTrackRenderer.js";

import {
    VoiceHrtfDatasetStore
} from "./voiceHrtfDatasetStore.js";

function cleanText(value) {
    return String(value ?? "").trim();
}

function resolveFfmpegPath() {
    return (
        process.env
            .VOICE_RECORDING_FFMPEG_PATH ||
        "ffmpeg"
    );
}

function appendBoundedText(
    current,
    chunk,
    maximum = 65536
) {
    const next =
        current +
        String(
            chunk ?? ""
        );

    return next.length >
        maximum
        ? next.slice(
            next.length -
            maximum
        )
        : next;
}

async function runProcess(
    command,
    args
) {
    const child =
        spawn(
            command,
            args,
            {
                stdio:
                    [
                        "ignore",
                        "ignore",
                        "pipe"
                    ]
            }
        );

    let stderr = "";

    child.stderr.on(
        "data",
        (chunk) => {
            stderr =
                appendBoundedText(
                    stderr,
                    chunk
                );
        }
    );

    const [code] =
        await once(
            child,
            "exit"
        );

    if (
        code !== 0
    ) {
        throw new Error(
            command +
            " exited with code " +
            code +
            ": " +
            stderr
        );
    }
}

function validateSessionMetadata(
    metadata,
    expectedSessionId = ""
) {
    const sessionId =
        cleanText(
            metadata?.sessionId
        ).toLowerCase();

    if (
        !sessionId ||
        (
            expectedSessionId &&
            sessionId !==
                cleanText(
                    expectedSessionId
                ).toLowerCase()
        ) ||
        !Array.isArray(
            metadata?.participants
        ) ||
        !Number.isFinite(
            Number(
                metadata?.durationMs
            )
        )
    ) {
        throw new Error(
            "Voice recording session metadata is invalid for Personal HRTF rendering."
        );
    }

    return Object.freeze({
        sessionId,
        durationMs:
            Math.max(
                0,
                Number(
                    metadata.durationMs
                )
            ),
        participants:
            Object.freeze(
                metadata.participants.map(
                    (participant) =>
                        Object.freeze({
                            userId:
                                cleanText(
                                    participant?.userId
                                ),
                            connectionId:
                                cleanText(
                                    participant?.connectionId
                                ).toLowerCase()
                        })
                )
            )
    });
}


function normalizeIntervals(
    intervals,
    durationMs
) {
    const duration =
        Math.max(
            0,
            Number(durationMs) || 0
        );

    const normalized =
        (Array.isArray(intervals) ? intervals : [])
            .map(
                (interval) => ({
                    startOffsetMs:
                        Math.max(
                            0,
                            Math.min(
                                duration,
                                Number(
                                    interval?.startOffsetMs
                                ) || 0
                            )
                        ),
                    endOffsetMs:
                        Math.max(
                            0,
                            Math.min(
                                duration,
                                Number(
                                    interval?.endOffsetMs
                                ) || duration
                            )
                        )
                })
            )
            .filter(
                (interval) =>
                    interval.endOffsetMs >
                    interval.startOffsetMs
            )
            .sort(
                (left, right) =>
                    left.startOffsetMs -
                        right.startOffsetMs ||
                    left.endOffsetMs -
                        right.endOffsetMs
            );

    if (normalized.length === 0) {
        return Object.freeze([]);
    }

    const merged = [
        {
            ...normalized[0]
        }
    ];

    for (
        let index = 1;
        index < normalized.length;
        index += 1
    ) {
        const current =
            normalized[index];

        const previous =
            merged[
                merged.length -
                1
            ];

        if (
            current.startOffsetMs <=
            previous.endOffsetMs
        ) {
            previous.endOffsetMs =
                Math.max(
                    previous.endOffsetMs,
                    current.endOffsetMs
                );

            continue;
        }

        merged.push({
            ...current
        });
    }

    return Object.freeze(
        merged.map(
            (interval) =>
                Object.freeze(
                    interval
                )
        )
    );
}

function intervalsCoverFullDuration(
    intervals,
    durationMs
) {
    const duration =
        Math.max(
            0,
            Number(durationMs) || 0
        );

    if (duration === 0) {
        return true;
    }

    const normalized =
        normalizeIntervals(
            intervals,
            duration
        );

    if (
        normalized.length ===
        0
    ) {
        return false;
    }

    let coveredUntilMs = 0;

    for (
        const interval of
        normalized
    ) {
        if (
            interval.startOffsetMs >
            coveredUntilMs
        ) {
            return false;
        }

        coveredUntilMs =
            Math.max(
                coveredUntilMs,
                interval.endOffsetMs
            );

        if (
            coveredUntilMs >=
            duration
        ) {
            return true;
        }
    }

    return false;
}

function formatSeconds(
    valueMs
) {
    return (
        Math.max(
            0,
            Number(valueMs) || 0
        ) /
        1000
    ).toFixed(3);
}

function readBlockedIntervals(
    source,
    connectionId
) {
    if (
        source instanceof Map
    ) {
        return (
            source.get(
                connectionId
            ) ??
            []
        );
    }

    if (
        source &&
        typeof source ===
            "object"
    ) {
        return (
            source[
                connectionId
            ] ??
            []
        );
    }

    return [];
}

class VoicePersonalHrtfRecordingRenderer {
    constructor({
        storageRoot,
        dataset = null,
        datasetPath = process.env.VOICE_HRTF_DATASET_PATH || "",
        renderPolicy = null
    } = {}) {
        this.storageRoot =
            cleanText(
                storageRoot
            );

        if (
            !this.storageRoot
        ) {
            throw new TypeError(
                "VoicePersonalHrtfRecordingRenderer requires storageRoot."
            );
        }

        if (!dataset && !cleanText(datasetPath)) {
            throw new TypeError(
                "VoicePersonalHrtfRecordingRenderer requires dataset or datasetPath."
            );
        }

        this.dataset = dataset;
        this.datasetPath = cleanText(datasetPath);
        this.renderPolicy = renderPolicy;
    }

    async render({
        sessionId,
        listenerUserId,
        outputPath = null,
        speakerBlockedIntervalsByConnectionId = null,
        authorizedIntervals = null
    } = {}) {
        const normalizedSessionId =
            cleanText(
                sessionId
            ).toLowerCase();

        const normalizedListenerUserId =
            cleanText(
                listenerUserId
            );

        if (
            !normalizedSessionId ||
            !normalizedListenerUserId
        ) {
            throw new TypeError(
                "sessionId and listenerUserId are required."
            );
        }

        const sessionDirectory =
            join(
                this.storageRoot,
                normalizedSessionId
            );

        const metadataPath =
            join(
                sessionDirectory,
                "session.json"
            );

        const spatialTimelinePath =
            join(
                sessionDirectory,
                "spatial-timeline.jsonl"
            );

        const metadata =
            JSON.parse(
                await readFile(
                    metadataPath,
                    "utf8"
                )
            );

        const normalizedMetadata =
            validateSessionMetadata(
                metadata,
                normalizedSessionId
            );

        const listenerMembership =
            normalizedMetadata
                .participants
                .find(
                    (participant) =>
                        participant.userId ===
                        normalizedListenerUserId
                );

        if (!listenerMembership) {
            throw new Error(
                "Listener is not a participant in this Voice recording."
            );
        }

        const reader =
            new VoiceSpatialTimelineReader();

        const timeline =
            await reader.readFile(
                spatialTimelinePath
            );

        if (
            !timeline.statesByUserId.has(
                normalizedListenerUserId
            )
        ) {
            throw new Error(
                "Spatial timeline does not contain the listener."
            );
        }

        const sampler =
            new VoiceSpatialTimelineSampler(
                timeline,
                {
                    maximumInterpolationGapMs:
                        1000,
                    maximumHoldMs:
                        2000
                }
            );

        const hrtfDataset =
            this.dataset ??
            await VoiceHrtfDatasetStore.fromFile(
                this.datasetPath
            );

        if (!hrtfDataset) {
            throw new Error(
                "HRTF dataset is not available."
            );
        }

        const trackRenderer =
            new VoiceHrtfTrackRenderer({
                sampler,
                dataset:
                    hrtfDataset,
                policy:
                    this.renderPolicy
            });

        const finalOutputPath =
            outputPath ||
            join(
                sessionDirectory,
                "personal-hrtf",
                normalizedListenerUserId +
                    ".ogg"
            );

        const temporaryDirectory =
            join(
                sessionDirectory,
                ".personal-hrtf-work",
                normalizedListenerUserId +
                    "-" +
                    process.pid +
                    "-" +
                    Date.now()
            );

        await mkdir(
            temporaryDirectory,
            {
                recursive: true
            }
        );

        await mkdir(
            dirname(
                finalOutputPath
            ),
            {
                recursive: true
            }
        );

        const renderedTracks = [];
        const trackStats = [];

        try {
            for (
                const participant of
                normalizedMetadata.participants
            ) {
                if (
                    !participant.userId ||
                    !participant.connectionId
                ) {
                    continue;
                }

                const inputPath =
                    join(
                        sessionDirectory,
                        "participants",
                        participant.connectionId +
                            ".ogg"
                    );

                const inputStat =
                    await stat(
                        inputPath
                    );

                if (
                    !inputStat.isFile()
                ) {
                    throw new Error(
                        "Participant recording is missing: " +
                        inputPath
                    );
                }

                if (
                    participant.userId !==
                        normalizedListenerUserId &&
                    !timeline.statesByUserId.has(
                        participant.userId
                    )
                ) {
                    throw new Error(
                        "Spatial timeline does not contain participant " +
                        participant.userId
                    );
                }

                const trackOutputPath =
                    join(
                        temporaryDirectory,
                        participant.connectionId +
                            ".stereo.ogg"
                    );

                const result =
                    await trackRenderer.render({
                        inputPath,
                        outputPath:
                            trackOutputPath,
                        listenerUserId:
                            normalizedListenerUserId,
                        speakerUserId:
                            participant.userId,
                        durationMs:
                            normalizedMetadata.durationMs,
                        // Directional restrictions belong to this sender only.
                        // The self track remains untouched by route mutes.
                        mutedIntervals: participant.userId === normalizedListenerUserId
                            ? []
                            : normalizeIntervals(
                                readBlockedIntervals(
                                    speakerBlockedIntervalsByConnectionId,
                                    participant.connectionId
                                ),
                                normalizedMetadata.durationMs
                            )
                    });

                renderedTracks.push(
                    trackOutputPath
                );

                trackStats.push(
                    Object.freeze({
                        userId:
                            participant.userId,
                        connectionId:
                            participant.connectionId,
                        result
                    })
                );
            }

            if (
                renderedTracks.length ===
                0
            ) {
                throw new Error(
                    "No participant tracks are available for Personal HRTF rendering."
                );
            }

            const ffmpegArgs = [
                "-hide_banner",
                "-nostdin",
                "-loglevel", "error",
                "-y"
            ];

            for (
                const path of
                renderedTracks
            ) {
                ffmpegArgs.push(
                    "-i",
                    path
                );
            }

            const filterParts = [];
            const participantLabels = [];

            trackStats.forEach(
                (
                    track,
                    index
                ) => {
                    const label =
                        `p${index}`;

                    const blockedIntervals =
                        normalizeIntervals(
                            readBlockedIntervals(
                                speakerBlockedIntervalsByConnectionId,
                                track.connectionId
                            ),
                            normalizedMetadata.durationMs
                        );

                    // Speaker-specific restriction was already applied
                    // sample-by-sample to this HRTF track before encoding.
                    // FFmpeg only aligns and mixes full-length tracks here;
                    // no global timeline cuts or FFmpeg timed mute filters.
                    filterParts.push(
                        `[${index}:a]asetpts=PTS-STARTPTS,apad,` +
                        `atrim=duration=${formatSeconds(normalizedMetadata.durationMs)},` +
                        `anull[${label}]`
                    );

                    participantLabels.push(
                        `[${label}]`
                    );
                }
            );

            filterParts.push(
                `${participantLabels.join("")}amix=inputs=${participantLabels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,aresample=48000[mixed]`
            );

            const normalizedAuthorizedIntervals =
                authorizedIntervals ===
                null
                    ? Object.freeze([
                        Object.freeze({
                            startOffsetMs: 0,
                            endOffsetMs:
                                normalizedMetadata.durationMs
                        })
                    ])
                    : normalizeIntervals(
                        authorizedIntervals,
                        normalizedMetadata.durationMs
                    );

            if (
                normalizedAuthorizedIntervals.length ===
                0
            ) {
                throw new Error(
                    "Personal HRTF rendering has no authorized interval."
                );
            }

            if (
                intervalsCoverFullDuration(
                    normalizedAuthorizedIntervals,
                    normalizedMetadata.durationMs
                )
            ) {
                filterParts.push(
                    "[mixed]anull[aout]"
                );
            } else if (
                normalizedAuthorizedIntervals.length ===
                1
            ) {
                const interval =
                    normalizedAuthorizedIntervals[0];

                filterParts.push(
                    `[mixed]atrim=start=${formatSeconds(interval.startOffsetMs)}:end=${formatSeconds(interval.endOffsetMs)},asetpts=PTS-STARTPTS[aout]`
                );
            } else {
                const splitLabels =
                    normalizedAuthorizedIntervals
                        .map(
                            (
                                _,
                                index
                            ) =>
                                `[s${index}]`
                        )
                        .join("");

                filterParts.push(
                    `[mixed]asplit=${normalizedAuthorizedIntervals.length}${splitLabels}`
                );

                normalizedAuthorizedIntervals
                    .forEach(
                        (
                            interval,
                            index
                        ) => {
                            filterParts.push(
                                `[s${index}]atrim=start=${formatSeconds(interval.startOffsetMs)}:end=${formatSeconds(interval.endOffsetMs)},asetpts=PTS-STARTPTS[c${index}]`
                            );
                        }
                    );

                const clipLabels =
                    normalizedAuthorizedIntervals
                        .map(
                            (
                                _,
                                index
                            ) =>
                                `[c${index}]`
                        )
                        .join("");

                filterParts.push(
                    `${clipLabels}concat=n=${normalizedAuthorizedIntervals.length}:v=0:a=1[aout]`
                );
            }

            ffmpegArgs.push(
                "-filter_complex",
                filterParts.join(";"),
                "-map", "[aout]",
                "-vn",
                "-ar", "48000",
                "-ac", "2",
                "-c:a", "libopus",
                "-b:a", "96000",
                "-application", "audio",
                "-vbr", "on",
                "-f", "ogg",
                finalOutputPath
            );

            await runProcess(
                resolveFfmpegPath(),
                ffmpegArgs
            );

            const outputStat =
                await stat(
                    finalOutputPath
                );

            const mutedTracks = trackStats.filter((track) => track.result.mutedSamples > 0);
            console.log(
                `VOICE_PERSONAL_HRTF_SPEAKER_PCM_MUTE | sessionId=${normalizedSessionId}` +
                ` | mutedSpeakerCount=${mutedTracks.length}` +
                ` | mutedSampleCount=${mutedTracks.reduce((sum, track) => sum + track.result.mutedSamples, 0)}` +
                ` | timelineCutMs=0 | participantTrackCount=${renderedTracks.length}`
            );

            return Object.freeze({
                sessionId:
                    normalizedSessionId,
                listenerUserId:
                    normalizedListenerUserId,
                outputPath:
                    finalOutputPath,
                outputBytes:
                    outputStat.size,
                participantTrackCount:
                    renderedTracks.length,
                durationMs:
                    normalizedMetadata.durationMs,
                tracks:
                    Object.freeze(
                        trackStats
                    )
            });
        } finally {
            await rm(
                temporaryDirectory,
                {
                    recursive: true,
                    force: true
                }
            );
        }
    }
}

export {
    VoicePersonalHrtfRecordingRenderer,
    validateSessionMetadata,
    normalizeIntervals,
    intervalsCoverFullDuration
};
