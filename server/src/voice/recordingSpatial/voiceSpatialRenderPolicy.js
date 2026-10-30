const DEFAULT_VOICE_SPATIAL_RENDER_POLICY =
    Object.freeze({
        sampleRate: 48000,
        frameDurationMs: 20,
        referenceDistanceMeters: 1.0,
        minimumDistanceGain: 0.03,
        maximumDistanceGain: 1.0,
        rearLowPassFrontHz: 18000,
        rearLowPassBackHz: 4500,
        rearMinimumGain: 0.85,
        opusBitrate: 96000,
        ffmpegPath:
            process.env.VOICE_RECORDING_FFMPEG_PATH ||
            "ffmpeg"
    });

function clamp(
    value,
    minimum,
    maximum
) {
    return Math.max(
        minimum,
        Math.min(
            maximum,
            value
        )
    );
}

function resolveDistanceGain(
    distanceMeters,
    policy =
        DEFAULT_VOICE_SPATIAL_RENDER_POLICY
) {
    const distance =
        Math.max(
            0,
            Number(
                distanceMeters
            ) || 0
        );

    const reference =
        Math.max(
            0.001,
            Number(
                policy.referenceDistanceMeters
            ) || 1
        );

    const raw =
        distance <=
            reference
            ? 1
            : reference /
                distance;

    return clamp(
        raw,
        Number(
            policy.minimumDistanceGain
        ),
        Number(
            policy.maximumDistanceGain
        )
    );
}

function resolveRearCue(
    frontness,
    policy =
        DEFAULT_VOICE_SPATIAL_RENDER_POLICY
) {
    const normalizedFrontness =
        clamp(
            Number(
                frontness
            ) || 0,
            -1,
            1
        );

    const amount =
        clamp(
            (
                1 -
                normalizedFrontness
            ) /
            2,
            0,
            1
        );

    const frontHz =
        Math.max(
            1000,
            Number(
                policy.rearLowPassFrontHz
            ) || 18000
        );

    const backHz =
        Math.max(
            500,
            Math.min(
                frontHz,
                Number(
                    policy.rearLowPassBackHz
                ) || 4500
            )
        );

    const lowPassHz =
        frontHz +
        (
            backHz -
            frontHz
        ) *
        amount;

    const minimumGain =
        clamp(
            Number(
                policy.rearMinimumGain
            ) || 0.85,
            0,
            1
        );

    const gain =
        1 -
        (
            1 -
            minimumGain
        ) *
        amount;

    return Object.freeze({
        amount,
        lowPassHz,
        gain
    });
}

function resolveEqualPowerPan(
    pan
) {
    const normalized =
        clamp(
            Number(
                pan
            ) || 0,
            -1,
            1
        );

    const angle =
        (
            normalized +
            1
        ) *
        Math.PI /
        4;

    return Object.freeze({
        left:
            Math.cos(
                angle
            ),
        right:
            Math.sin(
                angle
            )
    });
}

function createVoiceSpatialRenderPolicy(
    overrides = {}
) {
    return Object.freeze({
        ...DEFAULT_VOICE_SPATIAL_RENDER_POLICY,
        ...overrides
    });
}

export {
    DEFAULT_VOICE_SPATIAL_RENDER_POLICY,
    createVoiceSpatialRenderPolicy,
    resolveDistanceGain,
    resolveRearCue,
    resolveEqualPowerPan
};
