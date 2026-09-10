// File: src/voice/tests/voiceArchitectureConstants.test.js

import assert from "node:assert/strict";

import {
    VoiceArchitectureConstants
} from "../config/voiceArchitectureConstants.js";

const architecture = VoiceArchitectureConstants;

assert.equal(architecture.officialPhases.backend, "F");
assert.equal(architecture.officialPhases.unity, "G");

assert.equal(
    architecture.locations.server,
    "/home/world3d/apps/metaverse-server/src/voice"
);

assert.equal(
    architecture.locations.unity,
    "Assets/Scripts/Network_A/Voice"
);

assert.equal(architecture.transports.webgl, "binary_opus_over_wss");

assert.equal(
    architecture.transports.windows,
    "binary_opus_over_grpc_bidirectional_streaming"
);

assert.equal(
    architecture.transports.quest,
    "binary_opus_over_grpc_bidirectional_streaming"
);

assert.equal(architecture.audio.codec, "opus");
assert.equal(architecture.audio.sampleRateHz, 48000);
assert.equal(architecture.audio.channels, 1);
assert.equal(architecture.audio.channelMode, "mono");
assert.equal(architecture.audio.frameDurationMs, 20);
assert.deepEqual(architecture.audio.bitrateCandidatesKbps, [28, 32, 40]);

assert.equal(architecture.reconnect.firstRetryMode, "immediate");
assert.equal(architecture.reconnect.clientDeadlineSeconds, 180);
assert.equal(architecture.reconnect.serverRetentionSeconds, 210);

assert.equal(architecture.developmentVoiceSceneRouting.temporary, true);

assert.equal(
    architecture.developmentVoiceSceneRouting.reason,
    "protect_current_3d_scenes_during_voice_development"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.selectionValues.currentScene,
    "normal"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.selectionValues.voiceTestScene,
    "voice"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.native.currentScene,
    "Grpc_Enviroment"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.native.voiceTestScene,
    "Grpc_Enviromrnt_Voice"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.webgl.currentScene,
    "WebGL_Enviroment"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.webgl.voiceTestScene,
    "WebGL_Enviroment_Voice"
);

assert.equal(
    architecture.developmentVoiceSceneRouting.finalTarget,
    "primary_3d_scenes_with_voice"
);

assert.equal(
    architecture.existingBinders.native,
    "DedicatedGameServerRealtimeRoomBinder"
);

assert.equal(
    architecture.existingBinders.webgl,
    "DedicatedGameServerRealtimeRoomBinderWebGL"
);

assert.equal(architecture.existingBinders.createNewVoiceBinder, false);
assert.equal(architecture.existingBinders.copyBinderLogic, false);
assert.equal(architecture.existingBinders.integrationMethod, "wrapper");

assert.equal(
    architecture.authoritativeMovement.serverBridge,
    "MetaverseNetworkPlayerMovementBridge"
);

assert.equal(
    architecture.authoritativeMovement.clientReportedPlayerStateIsAuthoritative,
    false
);

assert.equal(architecture.serverIntegration.sameVps, true);
assert.equal(architecture.serverIntegration.sameBackendProject, true);
assert.equal(architecture.serverIntegration.separateBackendProject, false);

assert.equal(
    architecture.serverIntegration.existingServerFilesMustRemainUnchanged,
    true
);

assert.equal(architecture.excludedTechnologies.includes("webrtc"), true);
assert.equal(architecture.excludedTechnologies.includes("stun"), true);
assert.equal(architecture.excludedTechnologies.includes("turn"), true);
assert.equal(architecture.excludedTechnologies.includes("sfu"), true);
assert.equal(architecture.excludedTechnologies.includes("mirror"), true);

assert.equal(Object.isFrozen(architecture), true);
assert.equal(Object.isFrozen(architecture.audio), true);
assert.equal(Object.isFrozen(architecture.audio.bitrateCandidatesKbps), true);
assert.equal(Object.isFrozen(architecture.developmentVoiceSceneRouting), true);
assert.equal(Object.isFrozen(architecture.existingBinders), true);

console.log("VOICE_V1_1_ARCHITECTURE_TEST=OK");
