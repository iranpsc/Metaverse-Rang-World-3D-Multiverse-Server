import {
    installVoiceWebGLRealtimeRegistryCleanupGuard
} from "./voiceWebGLRealtimeRegistryCleanupGuard.js";

import {
    ClientsRegistry
} from "../../../realTime/clientsRegistry.js";

const guard = installVoiceWebGLRealtimeRegistryCleanupGuard(
    ClientsRegistry
);

console.log(
    "VOICE_WEBGL_REALTIME_REGISTRY_CLEANUP_HOOK=READY" +
    " | installed=" + (guard?.installed === true) +
    " | staleCloseScope=websocket" +
    " | windowsPathChanged=false" +
    " | questPathChanged=false"
);
