import "dotenv/config";
import http from "node:http";
import grpc from "@grpc/grpc-js";
import { WebSocketServer } from "ws";
import { acceptVoiceMediaV2WebSocketConnection, isVoiceMediaV2WebSocketRequest } from "../mediaV2/voiceMediaV2WebSocketTransport.js";
import { registerVoiceMediaV2GrpcTransport } from "../mediaV2/voiceMediaV2GrpcTransport.js";
import { VoiceMediaNodeBridgeClient } from "./mediaNodeBridgeClient.js";
import { createVoiceMediaNodeRuntime } from "./mediaNodeRuntime.js";

//* این تابع یک شماره پورت را از تنظیمات محیطی با بازه معتبر می خواند.
function readPort(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new RangeError(`${name} is invalid.`);
    return value;
}

//* این تابع نود رسانه مستقل را با دو شنونده رسانه و یک پل حلقه محلی اجرا می کند.
async function main() {
    const wsHost = String(process.env.VOICE_MEDIA_NODE_WS_HOST ?? "127.0.0.1").trim();
    const grpcHost = String(process.env.VOICE_MEDIA_NODE_GRPC_HOST ?? "127.0.0.1").trim();
    const bridgeHost = String(process.env.VOICE_MEDIA_NODE_BRIDGE_HOST ?? "127.0.0.1").trim();
    const wsPort = readPort("VOICE_MEDIA_NODE_WS_PORT", 51001);
    const grpcPort = readPort("VOICE_MEDIA_NODE_GRPC_PORT", 51002);
    const bridgePort = readPort("VOICE_MEDIA_NODE_BRIDGE_PORT", 51003);
    const bridgeSecret = String(process.env.VOICE_MEDIA_NODE_BRIDGE_SECRET ?? "");
    if (bridgeSecret.length < 32) throw new Error("VOICE_MEDIA_NODE_BRIDGE_SECRET must contain at least 32 characters.");

    const bridgeClient = new VoiceMediaNodeBridgeClient({
        url: `ws://${bridgeHost}:${bridgePort}/voice-media-node-bridge`,
        secret: bridgeSecret,
        logger: console
    });
    const runtime = createVoiceMediaNodeRuntime({ bridgeClient, logger: console });
    bridgeClient.setRuntime(runtime);
    bridgeClient.connect();
    const bridgeReady = await bridgeClient.waitUntilReady(5000);
    if (!bridgeReady) throw new Error("Voice media node backend bridge did not become ready before media listeners started.");

    const httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            const bridge = bridgeClient.getStats();
            const healthy = bridge.connected === true;
            res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: healthy, status: healthy ? "healthy" : "unhealthy", bridge, media: runtime.getStats() }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    const wss = new WebSocketServer({ noServer: true });

    //* این تابع فقط درخواست وب سوکت رسانه نسل دوم را به نود رسانه تحویل می دهد.
    function handleUpgrade(request, socket, head) {
        if (!isVoiceMediaV2WebSocketRequest(request)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
    }

    //* این تابع اتصال وب سوکت تایید شده را با راه انتقال قفل شده فاز نه ثبت می کند.
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
        grpcServer.bindAsync(`${grpcHost}:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (error) => {
            if (error) { reject(error); return; }
            resolve();
        });
    });

    console.log(`VME2_PHASE10_MEDIA_NODE=READY | ws=${wsHost}:${wsPort} | grpc=${grpcHost}:${grpcPort} | bridge=${bridgeHost}:${bridgePort}`);

    let stopping = false;

    //* این تابع همه شنونده ها و اتصال های نود را به ترتیب امن متوقف می کند.
    async function stop(reason) {
        if (stopping) return;
        stopping = true;
        console.log(`VME2_PHASE10_MEDIA_NODE=STOPPING | reason=${reason}`);
        bridgeClient.stop();
        await runtime.stop();
        await new Promise((resolve) => httpServer.close(() => resolve()));
        await new Promise((resolve) => grpcServer.tryShutdown(() => resolve()));
        wss.close();
        console.log("VME2_PHASE10_MEDIA_NODE=STOPPED");
    }

    process.once("SIGTERM", () => { void stop("sigterm").finally(() => process.exit(0)); });
    process.once("SIGINT", () => { void stop("sigint").finally(() => process.exit(0)); });
}

await main().catch((error) => {
    console.error("VME2_PHASE10_MEDIA_NODE=FAIL", error);
    process.exit(1);
});
