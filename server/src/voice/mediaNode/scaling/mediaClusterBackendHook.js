import { VoiceRoutingApplication } from "../../routing/voiceRoutingApplication.js";
import { createPhase11BackendRuntime } from "./mediaClusterBackendRuntime.js";
import { resolveAccessTokenVerifier } from "./mediaClusterBackendCore.js";

const enabled = String(process.env.VME2_PHASE11_SCALING_ENABLED ?? "").trim().toLowerCase() === "true";
const runtimeKey = Symbol.for("network_a.voice.media_node.phase11.backend_runtime");
const inProcessMediaRuntimeKey = Symbol.for("network_a.voice.media_v2.phase9.runtime");

//* این تابع مقدار پورت اجباری را از تنظیمات محیطی می خواند.
function readRequiredPort(name) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new RangeError(`${name} is invalid.`);
    return value;
}

if (enabled) {
    if (String(process.env.VOICE_MEDIA_NODE_ENABLED ?? "").trim().toLowerCase() === "true") throw new Error("Phase 10 and Phase 11 backend hooks must not run together.");
    const originalSetGateway = VoiceRoutingApplication.prototype.setGateway;

    //* این تابع هنگام آماده شدن درگاه کنترل رانتایم چند نودی را فقط یک بار نصب می کند.
    VoiceRoutingApplication.prototype.setGateway = function setGatewayWithPhase11(gateway) {
        if (gateway?.__voiceMediaP11Composite === true) {
            originalSetGateway.call(this, gateway);
            return;
        }
        originalSetGateway.call(this, gateway);
        if (globalThis[runtimeKey]) return;
        if (globalThis[inProcessMediaRuntimeKey]) throw new Error("Phase 9 in-process media runtime must not run together with Phase 11 mode.");
        const accessTokenVerifier = resolveAccessTokenVerifier(gateway);
        if (!accessTokenVerifier || !this.voiceConnectionRegistry) return;
        const runtime = createPhase11BackendRuntime({
            routingApplication: this,
            controlGateway: gateway,
            voiceConnectionRegistry: this.voiceConnectionRegistry,
            accessTokenVerifier,
            host: String(process.env.VOICE_MEDIA_P11_BACKEND_HOST ?? "127.0.0.1").trim(),
            port: readRequiredPort("VOICE_MEDIA_P11_BACKEND_PORT"),
            secret: process.env.VOICE_MEDIA_NODE_BRIDGE_SECRET,
            logger: console
        });
        globalThis[runtimeKey] = runtime;
        void runtime.start().then(() => {
            console.log("VME2_PHASE11_BACKEND_RUNTIME=PASS");
        }).catch((error) => {
            console.error("VME2_PHASE11_BACKEND_RUNTIME=FAIL", error);
            process.exit(1);
        });
    };
}
