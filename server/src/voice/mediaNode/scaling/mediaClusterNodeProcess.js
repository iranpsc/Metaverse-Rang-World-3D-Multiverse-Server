import "dotenv/config";
import http from "node:http";
import grpc from "@grpc/grpc-js";
import { WebSocketServer } from "ws";
import { acceptVoiceMediaV2WebSocketConnection, isVoiceMediaV2WebSocketRequest } from "../../mediaV2/voiceMediaV2WebSocketTransport.js";
import { registerVoiceMediaV2GrpcTransport } from "../../mediaV2/voiceMediaV2GrpcTransport.js";
import { VoiceMediaNodeBridgeClient } from "../mediaNodeBridgeClient.js";
import { createVoiceMediaNodeRuntime } from "../mediaNodeRuntime.js";
import { createMediaNodeTelemetryRuntimeAdapter } from "./mediaNodeTelemetryRuntimeAdapter.js";
import { createMediaNodeTelemetryReporter } from "./mediaNodeTelemetryReporter.js";
import { createVoiceMediaPacketSecurityRuntimeAdapter } from "../../security/voiceMediaPacketSecurityRuntimeAdapter.js";
import { createVoiceMediaFloodProtectionRuntimeAdapter } from "../../security/voiceMediaFloodProtectionRuntimeAdapter.js";

//* این تابع متن اجباری تنظیمات محیطی را می خواند.
function readRequiredText(name, maximumLength = 128) {
    const value = String(process.env[name] ?? "").trim();
    if (!value || value.length > maximumLength) throw new TypeError(`${name} is invalid.`);
    return value;
}

//* این تابع متن اختیاری تنظیمات محیطی را می خواند.
function readOptionalText(name, maximumLength = 128) {
    const value = String(process.env[name] ?? "").trim();
    if (value.length > maximumLength) throw new TypeError(`${name} is invalid.`);
    return value;
}

//* این تابع شماره پورت اجباری تنظیمات محیطی را می خواند.
function readRequiredPort(name) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new RangeError(`${name} is invalid.`);
    return value;
}

//* این تابع نشانی پل چند نودی را همراه شناسه و محل نود می سازد.
function buildBridgeUrl({ bridgeHost, bridgePort, nodeId, region, zone, advertiseHost, wsPort, grpcPort }) {
    const url = new URL(`ws://${bridgeHost}:${bridgePort}/voice-media-node-bridge`);
    url.searchParams.set("nodeId", nodeId);
    url.searchParams.set("region", region);
    url.searchParams.set("zone", zone);
    url.searchParams.set("advertiseHost", advertiseHost);
    url.searchParams.set("wsPort", String(wsPort));
    url.searchParams.set("grpcPort", String(grpcPort));
    return url.toString();
}

//* این تابع یک نمونه مستقل نود رسانه فاز یازده را با پورت های صریح اجرا می کند.
async function main() {
    const nodeId = readRequiredText("VOICE_MEDIA_P11_NODE_ID");
    const region = readRequiredText("VOICE_MEDIA_P11_REGION", 64);
    const zone = readOptionalText("VOICE_MEDIA_P11_ZONE", 64);
    const wsHost = String(process.env.VOICE_MEDIA_P11_WS_HOST ?? "127.0.0.1").trim();
    const grpcHost = String(process.env.VOICE_MEDIA_P11_GRPC_HOST ?? "127.0.0.1").trim();
    const bridgeHost = String(process.env.VOICE_MEDIA_P11_BACKEND_HOST ?? "127.0.0.1").trim();
    const advertiseHost = readRequiredText("VOICE_MEDIA_P11_ADVERTISE_HOST", 255);
    const wsPort = readRequiredPort("VOICE_MEDIA_P11_WS_PORT");
    const grpcPort = readRequiredPort("VOICE_MEDIA_P11_GRPC_PORT");
    const bridgePort = readRequiredPort("VOICE_MEDIA_P11_BACKEND_PORT");
    const bridgeSecret = String(process.env.VOICE_MEDIA_NODE_BRIDGE_SECRET ?? "");
    if (bridgeSecret.length < 32) throw new Error("VOICE_MEDIA_NODE_BRIDGE_SECRET must contain at least 32 characters.");

    const bridgeClient = new VoiceMediaNodeBridgeClient({
        url: buildBridgeUrl({ bridgeHost, bridgePort, nodeId, region, zone, advertiseHost, wsPort, grpcPort }),
        secret: bridgeSecret,
        logger: console
    });
    const baseRuntime = createVoiceMediaNodeRuntime({ bridgeClient, logger: console });
    const telemetryRuntime = createMediaNodeTelemetryRuntimeAdapter({ runtime: baseRuntime });
    const packetSecurityEnabled = String(process.env.VOICE_MEDIA_PACKET_SECURITY_ENABLED ?? "").trim().toLowerCase() === "true";
    const packetSecurityRuntime = packetSecurityEnabled ? createVoiceMediaPacketSecurityRuntimeAdapter({ runtime: telemetryRuntime, logger: console }) : telemetryRuntime;
    const floodProtectionEnabled = String(process.env.VOICE_MEDIA_FLOOD_PROTECTION_ENABLED ?? "").trim().toLowerCase() === "true";
    const runtime = floodProtectionEnabled ? createVoiceMediaFloodProtectionRuntimeAdapter({ runtime: packetSecurityRuntime, logger: console }) : packetSecurityRuntime;
    const telemetryReporter = createMediaNodeTelemetryReporter({ host: bridgeHost, port: bridgePort, secret: bridgeSecret, nodeId, telemetryRuntime: runtime, logger: console });
    bridgeClient.setRuntime(runtime);
    bridgeClient.connect();
    const bridgeReady = await bridgeClient.waitUntilReady(5000);
    if (!bridgeReady) throw new Error("Phase 11 backend bridge did not become ready before media listeners started.");

    const httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            const bridge = bridgeClient.getStats();
            const healthy = bridge.connected === true;
            res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: healthy, status: healthy ? "healthy" : "unhealthy", nodeId, region, zone, bridge, media: runtime.getStats(), telemetryReporter: telemetryReporter.getStats() }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    const wss = new WebSocketServer({ noServer: true });

    //* این تابع فقط درخواست وب سوکت رسانه نسل دوم را برای همین نود می پذیرد.
    function handleUpgrade(request, socket, head) {
        if (!isVoiceMediaV2WebSocketRequest(request)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
    }

    //* این تابع اتصال وب سوکت را بدون تغییر قرارداد فاز نه به رانتایم نود تحویل می دهد.
    function handleWebSocketConnection(socket, request) {
        acceptVoiceMediaV2WebSocketConnection({ socket, request, runtime, logger: console });
    }

    httpServer.on("upgrade", handleUpgrade);
    wss.on("connection", handleWebSocketConnection);
    const grpcServer = new grpc.Server();
    registerVoiceMediaV2GrpcTransport({ grpcServer, runtime, logger: console });

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(wsPort, wsHost, () => { httpServer.off("error", reject); resolve(); });
    });
    await new Promise((resolve, reject) => {
        grpcServer.bindAsync(`${grpcHost}:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (error) => error ? reject(error) : resolve());
    });

    telemetryReporter.start();
    console.log(`VME2_PHASE11_MEDIA_NODE=READY | nodeId=${nodeId} | region=${region} | zone=${zone} | ws=${wsHost}:${wsPort} | grpc=${grpcHost}:${grpcPort} | packetSecurity=${packetSecurityEnabled ? "enabled" : "disabled"} | floodProtection=${floodProtectionEnabled ? "enabled" : "disabled"}`);
    let stopping = false;

    //* این تابع همه شنونده ها و اتصال های همین نود را به ترتیب امن متوقف می کند.
    async function stop(reason) {
        if (stopping) return;
        stopping = true;
        console.log(`VME2_PHASE11_MEDIA_NODE=STOPPING | nodeId=${nodeId} | reason=${reason}`);
        telemetryReporter.stop();
        bridgeClient.stop();
        await runtime.stop();
        await new Promise((resolve) => httpServer.close(() => resolve()));
        await new Promise((resolve) => grpcServer.tryShutdown(() => resolve()));
        wss.close();
        console.log(`VME2_PHASE11_MEDIA_NODE=STOPPED | nodeId=${nodeId}`);
    }

    process.once("SIGTERM", () => { void stop("sigterm").finally(() => process.exit(0)); });
    process.once("SIGINT", () => { void stop("sigint").finally(() => process.exit(0)); });
}

await main().catch((error) => {
    console.error("VME2_PHASE11_MEDIA_NODE=FAIL", error);
    process.exit(1);
});

export {
    buildBridgeUrl
};
