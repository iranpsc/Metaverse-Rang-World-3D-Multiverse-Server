import {
    once
} from "node:events";

import {
    spawn
} from "node:child_process";

import {
    mkdir
} from "node:fs/promises";

import {
    dirname
} from "node:path";

import {
    VoiceSpatialPerspectiveResolver
} from "./voiceSpatialPerspectiveResolver.js";

import {
    createVoiceSpatialRenderPolicy,
    resolveDistanceGain,
    resolveRearCue,
    resolveEqualPowerPan
} from "./voiceSpatialRenderPolicy.js";

function appendBoundedText(
    current,
    chunk,
    maximum = 65536
) {
    const next =
        (
            current +
            String(
                chunk ?? ""
            )
        );

    return next.length >
        maximum
        ? next.slice(
            next.length -
            maximum
        )
        : next;
}

function createFloat32View(
    buffer
) {
    if (
        buffer.byteLength %
        4 !==
        0
    ) {
        throw new Error(
            "PCM buffer is not aligned to Float32 samples."
        );
    }

    return new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength /
            4
    );
}

function float32ArrayToBuffer(
    values
) {
    return Buffer.from(
        values.buffer,
        values.byteOffset,
        values.byteLength
    );
}

async function writeWithBackpressure(
    writable,
    buffer
) {
    if (
        writable.destroyed ||
        writable.writableEnded
    ) {
        throw new Error(
            "Spatial renderer encoder stdin is not writable."
        );
    }

    if (
        writable.write(
            buffer
        )
    ) {
        return;
    }

    await once(
        writable,
        "drain"
    );
}

function resolveFrameSpatialState({
    resolver,
    listenerUserId,
    speakerUserId,
    relativeMs,
    policy
}) {
    if (
        String(
            listenerUserId
        ) ===
        String(
            speakerUserId
        )
    ) {
        return Object.freeze({
            distance: 0,
            pan: 0,
            frontness: 1,
            sector: "self",
            isBehind: false,
            distanceGain: 1,
            rearCue: Object.freeze({
                amount: 0,
                lowPassHz:
                    policy.rearLowPassFrontHz,
                gain: 1
            }),
            panGain:
                resolveEqualPowerPan(
                    0
                )
        });
    }

    const perspective =
        resolver.resolveAt(
            listenerUserId,
            speakerUserId,
            relativeMs
        );

    if (!perspective) {
        return null;
    }

    return Object.freeze({
        ...perspective,
        distanceGain:
            resolveDistanceGain(
                perspective.distance,
                policy
            ),
        rearCue:
            resolveRearCue(
                perspective.frontness,
                policy
            ),
        panGain:
            resolveEqualPowerPan(
                perspective.pan
            )
    });
}

class VoiceSpatialTrackRenderer {
    constructor({
        sampler,
        policy = null
    } = {}) {
        if (
            !sampler ||
            typeof sampler.sampleUser !==
                "function"
        ) {
            throw new TypeError(
                "VoiceSpatialTrackRenderer requires a timeline sampler."
            );
        }

        this.sampler =
            sampler;

        this.resolver =
            new VoiceSpatialPerspectiveResolver(
                sampler
            );

        this.policy =
            createVoiceSpatialRenderPolicy(
                policy ?? {}
            );
    }

    async render({
        inputPath,
        outputPath,
        listenerUserId,
        speakerUserId,
        durationMs = null
    } = {}) {
        if (
            !inputPath ||
            !outputPath ||
            !listenerUserId ||
            !speakerUserId
        ) {
            throw new TypeError(
                "Spatial track render input/output/listener/speaker are required."
            );
        }

        await mkdir(
            dirname(
                outputPath
            ),
            {
                recursive: true
            }
        );

        const decoderArgs = [
            "-hide_banner",
            "-nostdin",
            "-loglevel", "error",
            "-i", inputPath,
            "-vn",
            "-ac", "1",
            "-ar",
            String(
                this.policy.sampleRate
            ),
            "-f", "f32le",
            "pipe:1"
        ];

        const encoderArgs = [
            "-hide_banner",
            "-nostdin",
            "-loglevel", "error",
            "-y",
            "-f", "f32le",
            "-ar",
            String(
                this.policy.sampleRate
            ),
            "-ac", "2",
            "-i", "pipe:0",
            "-vn",
            "-c:a", "libopus",
            "-b:a",
            String(
                this.policy.opusBitrate
            ),
            "-application", "audio",
            "-vbr", "on",
            "-ar",
            String(
                this.policy.sampleRate
            ),
            "-ac", "2",
            "-f", "ogg",
            outputPath
        ];

        const decoder =
            spawn(
                this.policy.ffmpegPath,
                decoderArgs,
                {
                    stdio:
                        [
                            "ignore",
                            "pipe",
                            "pipe"
                        ]
                }
            );

        const decoderExitPromise =
            once(
                decoder,
                "exit"
            );

        const encoder =
            spawn(
                this.policy.ffmpegPath,
                encoderArgs,
                {
                    stdio:
                        [
                            "pipe",
                            "ignore",
                            "pipe"
                        ]
                }
            );

        const encoderExitPromise =
            once(
                encoder,
                "exit"
            );

        let decoderErrorText = "";
        let encoderErrorText = "";

        decoder.stderr.on(
            "data",
            (chunk) => {
                decoderErrorText =
                    appendBoundedText(
                        decoderErrorText,
                        chunk
                    );
            }
        );

        encoder.stderr.on(
            "data",
            (chunk) => {
                encoderErrorText =
                    appendBoundedText(
                        encoderErrorText,
                        chunk
                    );
            }
        );

        const frameSamples =
            Math.round(
                this.policy.sampleRate *
                this.policy.frameDurationMs /
                1000
            );

        const frameBytes =
            frameSamples *
            4;

        let pending =
            Buffer.alloc(0);

        let frameIndex = 0;
        let renderedSamples = 0;
        let lowPassState = 0;
        let lastLeftGain = null;
        let lastRightGain = null;

        const stats = {
            listenerUserId:
                String(
                    listenerUserId
                ),
            speakerUserId:
                String(
                    speakerUserId
                ),
            frames:
                0,
            samples:
                0,
            frontFrames:
                0,
            rightFrames:
                0,
            backFrames:
                0,
            leftFrames:
                0,
            selfFrames:
                0,
            minimumDistance:
                null,
            maximumDistance:
                null
        };

        const processFrame =
            async (
                monoBuffer,
                sampleCount
            ) => {
                const relativeMs =
                    frameIndex *
                    this.policy.frameDurationMs;

                if (
                    Number.isFinite(
                        Number(
                            durationMs
                        )
                    ) &&
                    relativeMs >=
                        Number(
                            durationMs
                        )
                ) {
                    return false;
                }

                const spatial =
                    resolveFrameSpatialState({
                        resolver:
                            this.resolver,
                        listenerUserId,
                        speakerUserId,
                        relativeMs:
                            relativeMs +
                            this.policy.frameDurationMs /
                                2,
                        policy:
                            this.policy
                    });

                if (!spatial) {
                    throw new Error(
                        "Spatial timeline is incomplete for listener=" +
                        listenerUserId +
                        " speaker=" +
                        speakerUserId +
                        " at relativeMs=" +
                        relativeMs
                    );
                }

                if (
                    spatial.sector ===
                    "front"
                ) {
                    stats.frontFrames += 1;
                } else if (
                    spatial.sector ===
                    "right"
                ) {
                    stats.rightFrames += 1;
                } else if (
                    spatial.sector ===
                    "back"
                ) {
                    stats.backFrames += 1;
                } else if (
                    spatial.sector ===
                    "left"
                ) {
                    stats.leftFrames += 1;
                } else if (
                    spatial.sector ===
                    "self"
                ) {
                    stats.selfFrames += 1;
                }

                const distance =
                    Number(
                        spatial.distance
                    ) || 0;

                if (
                    stats.minimumDistance ===
                    null ||
                    distance <
                    stats.minimumDistance
                ) {
                    stats.minimumDistance =
                        distance;
                }

                if (
                    stats.maximumDistance ===
                    null ||
                    distance >
                    stats.maximumDistance
                ) {
                    stats.maximumDistance =
                        distance;
                }

                const mono =
                    createFloat32View(
                        monoBuffer
                    );

                const stereo =
                    new Float32Array(
                        sampleCount *
                        2
                    );

                const rearAmount =
                    spatial.rearCue.amount;

                const rearGain =
                    spatial.rearCue.gain;

                const cutoff =
                    Math.max(
                        500,
                        Math.min(
                            this.policy.sampleRate /
                                2 -
                                100,
                            spatial.rearCue
                                .lowPassHz
                        )
                    );

                const alpha =
                    1 -
                    Math.exp(
                        -2 *
                        Math.PI *
                        cutoff /
                        this.policy.sampleRate
                    );

                const targetLeftGain =
                    spatial.distanceGain *
                    rearGain *
                    spatial.panGain.left;

                const targetRightGain =
                    spatial.distanceGain *
                    rearGain *
                    spatial.panGain.right;

                const startLeftGain =
                    lastLeftGain ===
                        null
                        ? targetLeftGain
                        : lastLeftGain;

                const startRightGain =
                    lastRightGain ===
                        null
                        ? targetRightGain
                        : lastRightGain;

                for (
                    let index = 0;
                    index < sampleCount;
                    index += 1
                ) {
                    const source =
                        mono[index];

                    lowPassState +=
                        alpha *
                        (
                            source -
                            lowPassState
                        );

                    const rearProcessed =
                        source *
                            (
                                1 -
                                rearAmount
                            ) +
                        lowPassState *
                            rearAmount;

                    const amount =
                        sampleCount <= 1
                            ? 1
                            : index /
                                (
                                    sampleCount -
                                    1
                                );

                    const leftGain =
                        startLeftGain +
                        (
                            targetLeftGain -
                            startLeftGain
                        ) *
                        amount;

                    const rightGain =
                        startRightGain +
                        (
                            targetRightGain -
                            startRightGain
                        ) *
                        amount;

                    stereo[
                        index *
                            2
                    ] =
                        rearProcessed *
                        leftGain;

                    stereo[
                        index *
                            2 +
                            1
                    ] =
                        rearProcessed *
                        rightGain;
                }

                lastLeftGain =
                    targetLeftGain;

                lastRightGain =
                    targetRightGain;

                await writeWithBackpressure(
                    encoder.stdin,
                    float32ArrayToBuffer(
                        stereo
                    )
                );

                frameIndex += 1;
                renderedSamples +=
                    sampleCount;

                stats.frames += 1;
                stats.samples +=
                    sampleCount;

                return true;
            };

        let pipelineError = null;

        try {
            for await (
                const chunk of
                decoder.stdout
            ) {
                pending =
                    pending.length === 0
                        ? chunk
                        : Buffer.concat(
                            [
                                pending,
                                chunk
                            ]
                        );

                while (
                    pending.length >=
                    frameBytes
                ) {
                    const frame =
                        pending.subarray(
                            0,
                            frameBytes
                        );

                    pending =
                        pending.subarray(
                            frameBytes
                        );

                    const shouldContinue =
                        await processFrame(
                            frame,
                            frameSamples
                        );

                    if (
                        !shouldContinue
                    ) {
                        pending =
                            Buffer.alloc(
                                0
                            );

                        decoder.kill(
                            "SIGTERM"
                        );

                        break;
                    }
                }
            }

            if (
                pending.length >= 4
            ) {
                const alignedLength =
                    pending.length -
                    (
                        pending.length %
                        4
                    );

                const finalBuffer =
                    pending.subarray(
                        0,
                        alignedLength
                    );

                const finalSamples =
                    finalBuffer.length /
                    4;

                await processFrame(
                    finalBuffer,
                    finalSamples
                );
            }
        } catch (error) {
            pipelineError =
                error;

            decoder.kill(
                "SIGTERM"
            );

            encoder.kill(
                "SIGTERM"
            );
        } finally {
            if (
                !encoder.stdin.destroyed &&
                !encoder.stdin.writableEnded
            ) {
                encoder.stdin.end();
            }
        }

        const [
            decoderExit,
            encoderExit
        ] =
            await Promise.all([
                decoderExitPromise.catch(
                    () => [
                        null,
                        null
                    ]
                ),
                encoderExitPromise.catch(
                    () => [
                        null,
                        null
                    ]
                )
            ]);

        if (pipelineError) {
            throw pipelineError;
        }

        const decoderCode =
            decoderExit?.[0];

        const encoderCode =
            encoderExit?.[0];

        if (
            decoderCode !== 0 &&
            decoderCode !== null
        ) {
            throw new Error(
                "Spatial decoder failed with code " +
                decoderCode +
                ": " +
                decoderErrorText
            );
        }

        if (
            encoderCode !== 0
        ) {
            throw new Error(
                "Spatial encoder failed with code " +
                encoderCode +
                ": " +
                encoderErrorText
            );
        }

        return Object.freeze({
            ...stats,
            renderedSamples,
            outputPath
        });
    }
}

export {
    VoiceSpatialTrackRenderer,
    resolveFrameSpatialState
};
