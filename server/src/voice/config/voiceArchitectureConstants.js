// File: src/voice/config/voiceArchitectureConstants.js

//* این تابع آبجکت و اعضای داخلی آن را قفل می‌کند.
function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;

    Object.freeze(value);

    for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
    }

    return value;
}

//* این ثابت تصمیم‌های معماری فعلی Voice را نگه می‌دارد.
const VoiceArchitectureConstants = deepFreeze({
    officialPhases: {
        backend: "F",
        unity: "G"
    },

    internalRoadmap: {
        first: "V0",
        last: "V9"
    },

    locations: {
        server: "/home/world3d/apps/metaverse-server/src/voice",
        unity: "Assets/Scripts/Network_A/Voice"
    },

    transports: {
        webgl: "binary_opus_over_wss",
        windows: "binary_opus_over_grpc_bidirectional_streaming",
        quest: "binary_opus_over_grpc_bidirectional_streaming"
    },

    audio: {
        codec: "opus",
        sampleRateHz: 48000,
        channels: 1,
        channelMode: "mono",
        frameDurationMs: 20,
        vbrEnabled: true,
        dtxEnabled: true,
        fecEnabledInitially: false,
        bitrateCandidatesKbps: [28, 32, 40]
    },

    reconnect: {
        firstRetryMode: "immediate",
        clientDeadlineSeconds: 180,
        serverRetentionSeconds: 210
    },

    developmentVoiceSceneRouting: {
        temporary: true,
        reason: "protect_current_3d_scenes_during_voice_development",

        selectionValues: {
            currentScene: "normal",
            voiceTestScene: "voice"
        },

        native: {
            currentScene: "Grpc_Enviroment",
            voiceTestScene: "Grpc_Enviromrnt_Voice"
        },

        webgl: {
            currentScene: "WebGL_Enviroment",
            voiceTestScene: "WebGL_Enviroment_Voice"
        },

        finalTarget: "primary_3d_scenes_with_voice"
    },

    existingBinders: {
        native: "DedicatedGameServerRealtimeRoomBinder",
        webgl: "DedicatedGameServerRealtimeRoomBinderWebGL",
        createNewVoiceBinder: false,
        copyBinderLogic: false,
        integrationMethod: "wrapper"
    },

    authoritativeMovement: {
        incomingRoute: "game/player_input",
        serverBridge: "MetaverseNetworkPlayerMovementBridge",
        outgoingRoute: "game/network_transform",
        clientReportedPlayerStateIsAuthoritative: false
    },

    serverIntegration: {
        sameVps: true,
        sameBackendProject: true,
        separateBackendProject: false,
        existingServerFilesMustRemainUnchanged: true,
        integrationMethods: [
            "adapter",
            "wrapper",
            "bridge",
            "bootstrap",
            "facade"
        ]
    },

    excludedTechnologies: [
        "webrtc",
        "stun",
        "turn",
        "sfu",
        "mirror",
        "vivox",
        "agora",
        "commercial_cloud_voice"
    ]
});

export {
    VoiceArchitectureConstants,
    deepFreeze
};
