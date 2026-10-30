function clamp01(value) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function lerp(
    first,
    second,
    amount
) {
    return (
        first +
        (second - first) *
        amount
    );
}

function lerpVector3(
    first,
    second,
    amount
) {
    return Object.freeze({
        x:
            lerp(
                first.x,
                second.x,
                amount
            ),
        y:
            lerp(
                first.y,
                second.y,
                amount
            ),
        z:
            lerp(
                first.z,
                second.z,
                amount
            )
    });
}

function dotQuaternion(
    first,
    second
) {
    return (
        first.x * second.x +
        first.y * second.y +
        first.z * second.z +
        first.w * second.w
    );
}

function normalizeQuaternion(
    value
) {
    const magnitude =
        Math.sqrt(
            value.x * value.x +
            value.y * value.y +
            value.z * value.z +
            value.w * value.w
        );

    if (
        !Number.isFinite(magnitude) ||
        magnitude <= 1e-9
    ) {
        return Object.freeze({
            x: 0,
            y: 0,
            z: 0,
            w: 1
        });
    }

    return Object.freeze({
        x:
            value.x /
            magnitude,
        y:
            value.y /
            magnitude,
        z:
            value.z /
            magnitude,
        w:
            value.w /
            magnitude
    });
}

function slerpQuaternion(
    first,
    second,
    amount
) {
    let secondAdjusted =
        second;

    let cosine =
        dotQuaternion(
            first,
            second
        );

    if (cosine < 0) {
        cosine = -cosine;

        secondAdjusted = {
            x: -second.x,
            y: -second.y,
            z: -second.z,
            w: -second.w
        };
    }

    const t =
        clamp01(
            amount
        );

    if (
        cosine >
        0.9995
    ) {
        return normalizeQuaternion({
            x:
                lerp(
                    first.x,
                    secondAdjusted.x,
                    t
                ),
            y:
                lerp(
                    first.y,
                    secondAdjusted.y,
                    t
                ),
            z:
                lerp(
                    first.z,
                    secondAdjusted.z,
                    t
                ),
            w:
                lerp(
                    first.w,
                    secondAdjusted.w,
                    t
                )
        });
    }

    const angle =
        Math.acos(
            Math.max(
                -1,
                Math.min(
                    1,
                    cosine
                )
            )
        );

    const sine =
        Math.sin(
            angle
        );

    if (
        Math.abs(sine) <=
        1e-9
    ) {
        return normalizeQuaternion(
            first
        );
    }

    const firstWeight =
        Math.sin(
            (1 - t) *
            angle
        ) /
        sine;

    const secondWeight =
        Math.sin(
            t *
            angle
        ) /
        sine;

    return normalizeQuaternion({
        x:
            first.x *
                firstWeight +
            secondAdjusted.x *
                secondWeight,
        y:
            first.y *
                firstWeight +
            secondAdjusted.y *
                secondWeight,
        z:
            first.z *
                firstWeight +
            secondAdjusted.z *
                secondWeight,
        w:
            first.w *
                firstWeight +
            secondAdjusted.w *
                secondWeight
    });
}

function quaternionForward(
    quaternion
) {
    const x =
        quaternion.x;

    const y =
        quaternion.y;

    const z =
        quaternion.z;

    const w =
        quaternion.w;

    const forward = {
        x:
            2 *
            (
                x * z +
                w * y
            ),
        y:
            2 *
            (
                y * z -
                w * x
            ),
        z:
            1 -
            2 *
            (
                x * x +
                y * y
            )
    };

    const magnitude =
        Math.sqrt(
            forward.x *
                forward.x +
            forward.y *
                forward.y +
            forward.z *
                forward.z
        );

    if (
        !Number.isFinite(magnitude) ||
        magnitude <= 1e-9
    ) {
        return Object.freeze({
            x: 0,
            y: 0,
            z: 1
        });
    }

    return Object.freeze({
        x:
            forward.x /
            magnitude,
        y:
            forward.y /
            magnitude,
        z:
            forward.z /
            magnitude
    });
}

function findStateIndexAtOrBefore(
    states,
    relativeMs
) {
    let low = 0;
    let high =
        states.length - 1;
    let result = -1;

    while (
        low <= high
    ) {
        const middle =
            (low + high) >>
            1;

        if (
            states[middle]
                .relativeMs <=
            relativeMs
        ) {
            result =
                middle;
            low =
                middle + 1;
        } else {
            high =
                middle - 1;
        }
    }

    return result;
}

class VoiceSpatialTimelineSampler {
    constructor(
        timeline,
        {
            maximumInterpolationGapMs = 1000,
            maximumHoldMs = 2000
        } = {}
    ) {
        if (
            !timeline ||
            !(timeline.statesByUserId instanceof Map)
        ) {
            throw new TypeError(
                "A parsed spatial timeline is required."
            );
        }

        this.timeline =
            timeline;

        this.maximumInterpolationGapMs =
            Math.max(
                0,
                Number(
                    maximumInterpolationGapMs
                ) || 0
            );

        this.maximumHoldMs =
            Math.max(
                0,
                Number(
                    maximumHoldMs
                ) || 0
            );
    }

    hasUser(
        userId
    ) {
        const states =
            this.timeline
                .statesByUserId
                .get(
                    String(
                        userId ??
                        ""
                    ).trim()
                );

        return Boolean(
            states &&
            states.length > 0
        );
    }

    sampleUser(
        userId,
        relativeMs
    ) {
        const normalizedUserId =
            String(
                userId ??
                ""
            ).trim();

        const targetMs =
            Number(
                relativeMs
            );

        if (
            !normalizedUserId ||
            !Number.isFinite(
                targetMs
            ) ||
            targetMs < 0
        ) {
            return null;
        }

        const states =
            this.timeline
                .statesByUserId
                .get(
                    normalizedUserId
                );

        if (
            !states ||
            states.length === 0
        ) {
            return null;
        }

        const previousIndex =
            findStateIndexAtOrBefore(
                states,
                targetMs
            );

        if (
            previousIndex < 0
        ) {
            const first =
                states[0];

            if (
                first.relativeMs -
                    targetMs >
                this.maximumHoldMs
            ) {
                return null;
            }

            return this.buildSample({
                previous:
                    first,
                next:
                    first,
                amount:
                    0,
                targetMs,
                mode:
                    "hold_first"
            });
        }

        const previous =
            states[
                previousIndex
            ];

        const next =
            previousIndex + 1 <
            states.length
                ? states[
                    previousIndex + 1
                ]
                : null;

        if (!next) {
            if (
                targetMs -
                    previous.relativeMs >
                this.maximumHoldMs
            ) {
                return null;
            }

            return this.buildSample({
                previous,
                next:
                    previous,
                amount:
                    0,
                targetMs,
                mode:
                    "hold_last"
            });
        }

        const gapMs =
            next.relativeMs -
            previous.relativeMs;

        if (
            gapMs <= 0
        ) {
            return this.buildSample({
                previous:
                    next,
                next,
                amount:
                    0,
                targetMs,
                mode:
                    "exact_or_duplicate"
            });
        }

        if (
            gapMs >
            this.maximumInterpolationGapMs
        ) {
            const previousDistance =
                targetMs -
                previous.relativeMs;

            const nextDistance =
                next.relativeMs -
                targetMs;

            const nearest =
                previousDistance <=
                nextDistance
                    ? previous
                    : next;

            const nearestDistance =
                Math.min(
                    Math.abs(
                        targetMs -
                        nearest.relativeMs
                    ),
                    Math.abs(
                        targetMs -
                        (
                            nearest ===
                                previous
                                ? previous.relativeMs
                                : next.relativeMs
                        )
                    )
                );

            if (
                nearestDistance >
                this.maximumHoldMs
            ) {
                return null;
            }

            return this.buildSample({
                previous:
                    nearest,
                next:
                    nearest,
                amount:
                    0,
                targetMs,
                mode:
                    "gap_hold"
            });
        }

        const amount =
            clamp01(
                (
                    targetMs -
                    previous.relativeMs
                ) /
                gapMs
            );

        return this.buildSample({
            previous,
            next,
            amount,
            targetMs,
            mode:
                amount <= 0
                    ? "exact_previous"
                    : amount >= 1
                        ? "exact_next"
                        : "interpolated"
        });
    }

    sampleAll(
        relativeMs
    ) {
        const result =
            new Map();

        for (
            const userId of
            this.timeline
                .statesByUserId
                .keys()
        ) {
            const sample =
                this.sampleUser(
                    userId,
                    relativeMs
                );

            if (sample) {
                result.set(
                    userId,
                    sample
                );
            }
        }

        return result;
    }

    audioCapturedAtToRelativeMs(
        capturedAtMs,
        recordingStartedAtMs
    ) {
        const captured =
            Number(
                capturedAtMs
            );

        const started =
            Number(
                recordingStartedAtMs
            );

        if (
            !Number.isFinite(
                captured
            ) ||
            !Number.isFinite(
                started
            )
        ) {
            return null;
        }

        return Math.max(
            0,
            captured -
            started
        );
    }

    audioFrameIndexToRelativeMs(
        frameIndex,
        {
            frameDurationMs = 20
        } = {}
    ) {
        const index =
            Number(
                frameIndex
            );

        const duration =
            Number(
                frameDurationMs
            );

        if (
            !Number.isFinite(
                index
            ) ||
            index < 0 ||
            !Number.isFinite(
                duration
            ) ||
            duration <= 0
        ) {
            return null;
        }

        return (
            index *
            duration
        );
    }

    buildSample({
        previous,
        next,
        amount,
        targetMs,
        mode
    }) {
        const position =
            previous === next
                ? previous.position
                : lerpVector3(
                    previous.position,
                    next.position,
                    amount
                );

        const rotation =
            previous === next
                ? previous.rotation
                : slerpQuaternion(
                    previous.rotation,
                    next.rotation,
                    amount
                );

        return Object.freeze({
            userId:
                previous.userId,
            relativeMs:
                targetMs,
            mode,
            previousRelativeMs:
                previous.relativeMs,
            nextRelativeMs:
                next.relativeMs,
            interpolationAmount:
                amount,
            position,
            rotation,
            forward:
                quaternionForward(
                    rotation
                )
        });
    }
}

export {
    VoiceSpatialTimelineSampler,
    clamp01,
    lerpVector3,
    slerpQuaternion,
    quaternionForward,
    findStateIndexAtOrBefore
};
