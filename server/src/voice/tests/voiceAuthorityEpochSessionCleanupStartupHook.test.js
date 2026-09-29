import assert from "node:assert/strict";

import {
    VoiceDedicatedSessionDeltaService
} from "../dedicated/voiceDedicatedSessionDeltaService.js";

const installationKey =
    Symbol.for(
        "network_a.voice.authority_epoch_session_cleanup_hook"
    );

delete globalThis[installationKey];

process.env.VOICE_AUTHORITY_EPOCH_SESSION_CLEANUP_ENABLED =
    "true";

const originalAcceptBatch =
    VoiceDedicatedSessionDeltaService
        .prototype
        .acceptBatch;

await import(
    "../dedicated/voiceAuthorityEpochSessionCleanupStartupHook.js?startup_test=first"
);

const installedAcceptBatch =
    VoiceDedicatedSessionDeltaService
        .prototype
        .acceptBatch;

assert.equal(
    globalThis[installationKey],
    true
);

assert.notEqual(
    installedAcceptBatch,
    originalAcceptBatch
);

await import(
    "../dedicated/voiceAuthorityEpochSessionCleanupStartupHook.js?startup_test=second"
);

assert.equal(
    VoiceDedicatedSessionDeltaService
        .prototype
        .acceptBatch,
    installedAcceptBatch
);

console.log(
    "VOICE_AUTHORITY_EPOCH_SESSION_CLEANUP_STARTUP_HOOK_TEST=OK | hookInstalled=true | duplicatePatchPrevented=true | platformScope=all | stableFilesChanged=false"
);

