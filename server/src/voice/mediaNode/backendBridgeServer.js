import http from "node:http";
import { WebSocketServer } from "ws";
import { VoiceMediaNodeBridgeRpcPeer } from "./bridgeRpcPeer.js";
import { createVoiceMediaNodeBackendBridgeCore } from "./backendBridgeCore.js";

//* این تابع سرور داخلی نود رسانه را با مالکیت کامل مسیر کنترل موجود ایجاد می کند.
function createVoiceMediaNodeBackendBridgeServer({
    routingApplication,
    controlGateway,
    voiceConnectionRegistry,
    accessTokenVerifier = null,
    host = "127.0.0.1",
    port = 51003,
    secret,
    logger = null,
    requestTimeoutMs = 3000
} = {}) {
    const safeSecret = String(secret ?? "");
    if (safeSecret.length < 32) throw new Error("Voice media node bridge secret must be at least 32 characters.");
    const core = createVoiceMediaNodeBackendBridgeCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier });
    let peer = null;
    let stopped = false;
    const httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, status: "healthy", mediaNodeConnected: Boolean(peer && !peer.closed) }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    const wss = new WebSocketServer({ noServer: true });

    //* این تابع درخواست اتصال داخلی را فقط با مسیر و راز مشترک معتبر می پذیرد.
    function handleUpgrade(request, socket, head) {
        const parsed = new URL(String(request?.url ?? "/"), "http://127.0.0.1");
        const authorization = String(request?.headers?.authorization ?? "");
        if (parsed.pathname !== "/voice-media-node-bridge" || authorization !== `Bearer ${safeSecret}`) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
    }

    //* این تابع اتصال نود رسانه را ثبت و اتصال قبلی را در صورت وجود جایگزین می کند.
    function handleConnection(socket) {
        if (peer && !peer.closed) peer.close();
        peer = new VoiceMediaNodeBridgeRpcPeer({ socket, requestTimeoutMs, handlers: core.handlers, logger });
        core.setPeer(peer);
        socket.once("close", () => {
            if (peer?.socket === socket) {
                peer = null;
                core.setPeer(null);
            }
        });
        logger?.info?.("VME2_PHASE10_BACKEND_BRIDGE=CONNECTED");
    }

    httpServer.on("upgrade", handleUpgrade);
    wss.on("connection", handleConnection);

    //* این تابع شنونده داخلی را روی آدرس حلقه محلی فعال می کند.
    async function start() {
        if (stopped) throw new Error("Phase 10 backend bridge is stopped.");
        if (httpServer.listening) return httpServer.address();
        await new Promise((resolve, reject) => {
            const onError = (error) => { httpServer.off("listening", onListening); reject(error); };
            const onListening = () => { httpServer.off("error", onError); resolve(); };
            httpServer.once("error", onError);
            httpServer.once("listening", onListening);
            httpServer.listen(port, host);
        });
        logger?.info?.("VME2_PHASE10_BACKEND_BRIDGE=READY", { address: httpServer.address() });
        return httpServer.address();
    }

    //* این تابع اتصال داخلی و شنونده را بدون بستن مسیر کنترل اصلی متوقف می کند.
    async function stop() {
        if (stopped) return;
        stopped = true;
        peer?.close();
        peer = null;
        core.stop();
        if (httpServer.listening) await new Promise((resolve) => httpServer.close(() => resolve()));
        wss.close();
    }

    //* این تابع وضعیت محدود پل داخلی را برای پایش برمی گرداند.
    function getStats() {
        return Object.freeze({ listening: httpServer.listening, mediaNodeConnected: Boolean(peer && !peer.closed), stopped });
    }

    return Object.freeze({ start, stop, getStats, remoteCompositeGateway: core.remoteCompositeGateway, httpServer });
}

export {
    createVoiceMediaNodeBackendBridgeServer
};
