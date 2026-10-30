const DEFAULT_VOICE_HRTF_RENDER_POLICY = Object.freeze({
    sampleRate: 48000,
    frameDurationMs: 20,
    interpolationNeighbors: 4,
    filterSmoothingMs: 35,
    referenceDistanceMeters: 1.0,
    minimumDistanceGain: 0.03,
    maximumDistanceGain: 1.0,
    hrtfOutputGain: 1.0,
    opusBitrate: 96000,
    ffmpegPath: process.env.VOICE_RECORDING_FFMPEG_PATH || "ffmpeg",
    datasetPath: process.env.VOICE_HRTF_DATASET_PATH || ""
});

function createVoiceHrtfRenderPolicy(overrides = {}) {
    return Object.freeze({
        ...DEFAULT_VOICE_HRTF_RENDER_POLICY,
        ...overrides
    });
}

export {
    DEFAULT_VOICE_HRTF_RENDER_POLICY,
    createVoiceHrtfRenderPolicy
};
