import { VoiceRoutingApplication } from "../routing/voiceRoutingApplication.js";
import { createVoiceMediaNodeBackendBridgeServer } from "./backendBridgeServer.js";
import { resolveAccessTokenVerifier } from "./backendBridgeCore.js";

const enabled = String(process.env.VOICE_MEDIA_NODE_ENABLED ?? "").trim().toLowerCase() === "true";
const runtimeKey = Symbol.for("network_a.voice.media_node.backend_bridge");
const inProcessMediaRuntimeKey = Symbol.for("network_a.voice.media_v2.phase9.runtime");

if (enabled) {
    const originalSetGateway = VoiceRoutingApplication.prototype.setGateway;

    //* این تابع هنگام دریافت درگاه کنترل، پل داخلی فاز ده را فقط یک بار روی همان هسته زنده نصب می کند.
    VoiceRoutingApplication.prototype.setGateway = function setGatewayWithVoiceMediaNode(gateway) {
        if (gateway?.__voiceMediaNodeRemoteComposite === true) {
            originalSetGateway.call(this, gateway);
            return;
        }

        originalSetGateway.call(this, gateway);
        if (globalThis[runtimeKey]) return;
        if (globalThis[inProcessMediaRuntimeKey]) throw new Error("Phase 9 in-process media runtime must not run together with voice media node mode.");

        const accessTokenVerifier = resolveAccessTokenVerifier(gateway);
        if (!accessTokenVerifier || !this.voiceConnectionRegistry) return;

        const runtime = createVoiceMediaNodeBackendBridgeServer({
            routingApplication: this,
            controlGateway: gateway,
            voiceConnectionRegistry: this.voiceConnectionRegistry,
            accessTokenVerifier,
            host: String(process.env.VOICE_MEDIA_NODE_BRIDGE_HOST ?? "127.0.0.1").trim(),
            port: Number(process.env.VOICE_MEDIA_NODE_BRIDGE_PORT ?? 51003),
            secret: process.env.VOICE_MEDIA_NODE_BRIDGE_SECRET,
            logger: console
        });

        globalThis[runtimeKey] = runtime;
        void runtime.start().then(() => {
            console.log("VME2_PHASE10_BACKEND_BRIDGE=PASS");
        }).catch((error) => {
            console.error("VME2_PHASE10_BACKEND_BRIDGE=FAIL", error);
            process.exit(1);
        });
    };
}
