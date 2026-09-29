import http from "node:http";
import { WebSocketServer } from "ws";
import { VoiceMediaNodeBridgeRpcPeer } from "../bridgeRpcPeer.js";
import { createPhase11BackendCore } from "./mediaClusterBackendCore.js";
import { installMediaRoomOwnershipReleaseAdapter } from "./mediaRoomOwnershipReleaseAdapter.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

//* این تابع متن اجباری کوتاه را پاکسازی و اعتبارسنجی می کند.
function normalizeRequiredText(value, fieldName, maximumLength = 128) {
    const text = String(value ?? "").trim();
    if (!text || text.length > maximumLength) throw new TypeError(`${fieldName} is invalid.`);
    return text;
}

//* این تابع متن اختیاری کوتاه را پاکسازی و اعتبارسنجی می کند.
function normalizeOptionalText(value, fieldName, maximumLength = 128) {
    const text = String(value ?? "").trim();
    if (text.length > maximumLength) throw new TypeError(`${fieldName} is invalid.`);
    return text;
}

//* این تابع شماره پورت داخلی را اعتبارسنجی می کند.
function normalizePort(value, fieldName) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError(`${fieldName} is invalid.`);
    return port;
}

//* این تابع نشانی میزبان داخلی را بدون پذیرش مسیر یا فاصله اعتبارسنجی می کند.
function normalizeHost(value) {
    const host = normalizeRequiredText(value, "host", 255);
    if (/\s|\/|\\/.test(host)) throw new TypeError("host is invalid.");
    return host;
}

//* این تابع فراداده نود را از درخواست داخلی خوانده و اعتبارسنجی می کند.
function parseNodeMetadata(request) {
    const parsed = new URL(String(request?.url ?? "/"), "http://127.0.0.1");
    if (parsed.pathname !== "/voice-media-node-bridge") throw new Error("Bridge path is invalid.");
    return Object.freeze({
        nodeId: normalizeRequiredText(parsed.searchParams.get("nodeId"), "nodeId"),
        region: normalizeRequiredText(parsed.searchParams.get("region"), "region", 64),
        zone: normalizeOptionalText(parsed.searchParams.get("zone"), "zone", 64),
        advertiseHost: normalizeHost(parsed.searchParams.get("advertiseHost")),
        wsPort: normalizePort(parsed.searchParams.get("wsPort"), "wsPort"),
        grpcPort: normalizePort(parsed.searchParams.get("grpcPort"), "grpcPort")
    });
}

//* این تابع بدنه کوچک درخواست داخلی را با سقف ثابت می خواند.
async function readJsonBody(req, maximumBytes = 20 * 1024) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maximumBytes) throw new Error("Request body is too large.");
        chunks.push(Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Request body is invalid.");
    return value;
}

//* این تابع شنونده خصوصی چند نودی را پیرامون هسته فاز یازده می سازد.
function createPhase11BackendRuntime({
    routingApplication,
    controlGateway,
    voiceConnectionRegistry,
    accessTokenVerifier = null,
    coordinator,
    host = "127.0.0.1",
    port = 0,
    secret,
    logger = null,
    requestTimeoutMs = 3000,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS
} = {}) {
    const safeSecret = String(secret ?? "");
    if (safeSecret.length < 32) throw new Error("Voice media node bridge secret must be at least 32 characters.");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("port is invalid.");
    if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1000 || heartbeatIntervalMs > 60000) throw new RangeError("heartbeatIntervalMs is invalid.");
    const core = createPhase11BackendCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier, coordinator });
    const roomOwnershipReleaseAdapter = installMediaRoomOwnershipReleaseAdapter({ voiceConnectionRegistry, coordinator: core.coordinator, logger });
    let stopped = false;
    let heartbeatTimer = null;
    const httpServer = http.createServer(handleHttpRequest);
    const wss = new WebSocketServer({ noServer: true });

    //* این تابع درخواست ارتقای وب سوکت داخلی را با راز مشترک و فراداده نود اعتبارسنجی می کند.
    function handleUpgrade(request, socket, head) {
        const authorization = String(request?.headers?.authorization ?? "");
        if (authorization !== `Bearer ${safeSecret}`) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        let metadata;
        try { metadata = parseNodeMetadata(request); }
        catch {
            socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request, metadata));
    }

    //* این تابع یک همتای مستقل برای هر نود رسانه ثبت می کند و نود هم نام قبلی را جایگزین می کند.
    function handleConnection(socket, request, metadata) {
        const previous = core.nodesById.get(metadata.nodeId) ?? null;
        previous?.peer?.close?.();
        const peer = new VoiceMediaNodeBridgeRpcPeer({ socket, requestTimeoutMs, handlers: core.createHandlers(metadata.nodeId), logger });
        core.registerNode({ ...metadata, peer });
        socket.on("pong", () => core.heartbeatNode(metadata.nodeId));
        socket.once("close", () => core.unregisterNode(metadata.nodeId, peer));
        logger?.info?.("VME2_PHASE11_MEDIA_NODE_BRIDGE=CONNECTED", { nodeId: metadata.nodeId, region: metadata.region, zone: metadata.zone });
    }

    //* این تابع درخواست داخلی انتخاب نود و وضعیت سلامت را روی حلقه خصوصی پاسخ می دهد.
    async function handleHttpRequest(req, res) {
        const parsed = new URL(String(req.url ?? "/"), "http://127.0.0.1");
        if (parsed.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, status: "healthy", stopped, ...core.getStats() }));
            return;
        }
        const isMetricsRequest = parsed.pathname === "/media-node/metrics" && req.method === "POST";
        const isResolveRequest = parsed.pathname === "/phase11/resolve-room" && req.method === "POST";
        if (!isMetricsRequest && !isResolveRequest) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "not_found" }));
            return;
        }
        if (String(req.headers.authorization ?? "") !== `Bearer ${safeSecret}`) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "unauthorized" }));
            return;
        }
        try {
            const body = await readJsonBody(req);
            if (isMetricsRequest) {
                const node = core.updateNodeMetrics(body.nodeId, { activeConnections: body.activeConnections, cpuPercent: body.cpuPercent, outboundKbps: body.outboundKbps });
                if (!node) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: false, error: "media_node_not_connected" }));
                    return;
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, node }));
                return;
            }
            const result = await core.resolveAuthorizedRoomTarget({
                accessToken: body.accessToken,
                roomId: body.roomId,
                controlConnectionId: body.controlConnectionId,
                region: body.region ?? "",
                zone: body.zone ?? "",
                transport: body.transport
            });
            res.writeHead(result.success ? 200 : 403, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(error?.message ?? error) }));
        }
    }

    //* این تابع برای هر نود زنده ضربان وب سوکت می فرستد تا تازگی رجیستری مستقل بماند.
    function sendHeartbeats() {
        for (const node of core.nodesById.values()) {
            try { node.peer?.socket?.ping?.(); } catch { }
        }
    }

    //* این تابع شنونده داخلی چند نودی و زمان سنج ضربان را فعال می کند.
    async function start() {
        if (stopped) throw new Error("Phase 11 backend runtime is stopped.");
        if (!httpServer.listening) {
            await new Promise((resolve, reject) => {
                const onError = (error) => { httpServer.off("listening", onListening); reject(error); };
                const onListening = () => { httpServer.off("error", onError); resolve(); };
                httpServer.once("error", onError);
                httpServer.once("listening", onListening);
                httpServer.listen(port, host);
            });
        }
        if (!heartbeatTimer) {
            heartbeatTimer = setInterval(sendHeartbeats, heartbeatIntervalMs);
            heartbeatTimer.unref?.();
        }
        logger?.info?.("VME2_PHASE11_BACKEND_RUNTIME=READY", { address: httpServer.address() });
        return httpServer.address();
    }

    //* این تابع همه همتاها و شنونده داخلی را بدون تغییر مسیرهای قدیمی متوقف می کند.
    async function stop() {
        if (stopped) return;
        stopped = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        for (const node of core.nodesById.values()) node.peer?.close?.();
        core.nodesById.clear();
        roomOwnershipReleaseAdapter.uninstall();
        if (httpServer.listening) await new Promise((resolve) => httpServer.close(() => resolve()));
        wss.close();
    }

    //* این تابع آمار شنونده خصوصی و هسته چند نودی را برمی گرداند.
    function getStats() {
        return Object.freeze({ listening: httpServer.listening, stopped, ...core.getStats() });
    }

    httpServer.on("upgrade", handleUpgrade);
    wss.on("connection", handleConnection);
    return Object.freeze({ start, stop, getStats, resolveAuthorizedRoomTarget: core.resolveAuthorizedRoomTarget, remoteCompositeGateway: core.remoteCompositeGateway, coordinator: core.coordinator, httpServer });
}

export {
    createPhase11BackendRuntime,
    parseNodeMetadata
};
