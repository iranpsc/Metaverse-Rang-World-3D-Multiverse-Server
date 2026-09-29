import "dotenv/config";
import http from "node:http";
import grpc from "@grpc/grpc-js";
import WebSocket, { WebSocketServer } from "ws";
import { loadVoiceMediaV2GrpcDefinition } from "../../mediaV2/voiceMediaV2GrpcTransport.js";
import { createPendingBuffer, inspectPhase11BindPacket } from "./mediaIngressCore.js";

//* این تابع شماره پورت اجباری را از تنظیمات محیطی می خواند.
function readRequiredPort(name) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new RangeError(`${name} is invalid.`);
    return value;
}

//* این تابع درخواست انتخاب نود را به سرویس خصوصی بک اند می فرستد.
function createDirectoryResolver({ host, port, secret, region = "", zone = "" } = {}) {
    const safeSecret = String(secret ?? "");
    if (safeSecret.length < 32) throw new Error("Directory secret is invalid.");

    //* این تابع برای یک روم و راه انتقال نشانی نود مالک را دریافت می کند.
    async function resolve({ roomId, controlConnectionId, accessToken, transport } = {}) {
        const requestBody = Buffer.from(JSON.stringify({ roomId, controlConnectionId, accessToken, transport, region, zone }), "utf8");
        return await new Promise((resolvePromise, reject) => {
            const request = http.request({ host, port, method: "POST", path: "/phase11/resolve-room", headers: { Authorization: `Bearer ${safeSecret}`, "Content-Type": "application/json", "Content-Length": String(requestBody.length) }, timeout: 3000 }, (response) => {
                const chunks = [];
                response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                response.on("end", () => {
                    try {
                        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        if (response.statusCode !== 200 || body?.success !== true) throw new Error(String(body?.reason ?? body?.error ?? "room_resolution_failed"));
                        resolvePromise(body);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            request.once("timeout", () => request.destroy(new Error("Room resolution timed out.")));
            request.once("error", reject);
            request.end(requestBody);
        });
    }

    return Object.freeze({ resolve });
}

//* این تابع فرایند لبه رسانه را با نشانی عمومی ثابت و انتخاب روم آگاه اجرا می کند.
async function main() {
    const wsHost = String(process.env.VOICE_MEDIA_P11_EDGE_WS_HOST ?? "127.0.0.1").trim();
    const grpcHost = String(process.env.VOICE_MEDIA_P11_EDGE_GRPC_HOST ?? "127.0.0.1").trim();
    const directoryHost = String(process.env.VOICE_MEDIA_P11_BACKEND_HOST ?? "127.0.0.1").trim();
    const wsPort = readRequiredPort("VOICE_MEDIA_P11_EDGE_WS_PORT");
    const grpcPort = readRequiredPort("VOICE_MEDIA_P11_EDGE_GRPC_PORT");
    const directoryPort = readRequiredPort("VOICE_MEDIA_P11_BACKEND_PORT");
    const secret = String(process.env.VOICE_MEDIA_NODE_BRIDGE_SECRET ?? "");
    const region = String(process.env.VOICE_MEDIA_P11_EDGE_REGION ?? "").trim();
    const zone = String(process.env.VOICE_MEDIA_P11_EDGE_ZONE ?? "").trim();
    const directory = createDirectoryResolver({ host: directoryHost, port: directoryPort, secret, region, zone });
    let activeWs = 0;
    let activeGrpc = 0;

    const httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, status: "healthy", activeWs, activeGrpc, region, zone }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    const wss = new WebSocketServer({ noServer: true });

    //* این تابع هر وب سوکت ورودی را تا خواندن بایند نگه می دارد و سپس به نود مالک همان روم متصل می کند.
    function handleWebSocketConnection(client) {
        activeWs += 1;
        let upstream = null;
        let routing = false;
        let routed = false;
        let closed = false;
        const pending = createPendingBuffer();

        //* این تابع هر دو سمت وب سوکت را فقط یک بار می بندد.
        function closeBoth(reason = "media_edge_closed") {
            if (closed) return;
            closed = true;
            activeWs = Math.max(0, activeWs - 1);
            try { client.close(1011, reason.slice(0, 120)); } catch { }
            try { upstream?.close(1011, reason.slice(0, 120)); } catch { }
        }

        //* این تابع پس از شناخت روم اتصال بالادست را باز و پیام های معطل را عبور می دهد.
        async function routeFirstPacket(firstPacket) {
            const bind = inspectPhase11BindPacket(firstPacket);
            const target = await directory.resolve({ ...bind, transport: "ws" });
            upstream = new WebSocket(`ws://${target.host}:${target.port}/ws?transport=voice-media-v2`);
            await new Promise((resolve, reject) => {
                upstream.once("open", resolve);
                upstream.once("error", reject);
            });
            upstream.on("message", (data, isBinary) => {
                if (!isBinary) { closeBoth("media_binary_required"); return; }
                client.send(data, { binary: true }, (error) => { if (error) closeBoth("media_edge_send_failed"); });
            });
            upstream.once("close", () => closeBoth("media_upstream_closed"));
            upstream.once("error", () => closeBoth("media_upstream_error"));
            upstream.send(firstPacket, { binary: true });
            for (const queued of pending.drain()) upstream.send(queued, { binary: true });
            routed = true;
        }

        //* این تابع نخستین پیام را برای انتخاب نود و پیام های بعدی را برای عبور مستقیم مدیریت می کند.
        function handleClientMessage(data, isBinary) {
            if (!isBinary) { closeBoth("media_binary_required"); return; }
            const packet = Buffer.from(data);
            if (routed) {
                upstream.send(packet, { binary: true }, (error) => { if (error) closeBoth("media_edge_send_failed"); });
                return;
            }
            if (routing) {
                try { pending.push(packet); } catch { closeBoth("media_edge_buffer_limit"); }
                return;
            }
            routing = true;
            void routeFirstPacket(packet).catch(() => closeBoth("media_edge_route_failed"));
        }

        client.on("message", handleClientMessage);
        client.once("close", () => closeBoth("media_client_closed"));
        client.once("error", () => closeBoth("media_client_error"));
    }

    httpServer.on("upgrade", (request, socket, head) => {
        const parsed = new URL(String(request.url ?? "/"), "http://127.0.0.1");
        if (parsed.searchParams.get("transport") !== "voice-media-v2") { socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
    });
    wss.on("connection", handleWebSocketConnection);

    const servicePackage = loadVoiceMediaV2GrpcDefinition();
    const grpcServer = new grpc.Server();

    //* این تابع یک جریان جی آر پی سی را پس از خواندن بایند به نود مالک همان روم متصل می کند.
    function connectGrpc(call) {
        activeGrpc += 1;
        let upstreamClient = null;
        let upstreamCall = null;
        let routing = false;
        let routed = false;
        let finished = false;
        const pending = createPendingBuffer();

        //* این تابع منابع جریان جی آر پی سی را فقط یک بار آزاد می کند.
        function finish() {
            if (finished) return;
            finished = true;
            activeGrpc = Math.max(0, activeGrpc - 1);
            try { upstreamCall?.cancel(); } catch { }
            try { upstreamClient?.close(); } catch { }
            try { call.end(); } catch { }
        }

        //* این تابع نخستین بسته جی آر پی سی را به جریان نود مالک متصل می کند.
        async function routeFirstMessage(firstMessage) {
            const bind = inspectPhase11BindPacket(firstMessage?.packet);
            const target = await directory.resolve({ ...bind, transport: "grpc" });
            upstreamClient = new servicePackage.VoiceMediaTransport(`${target.host}:${target.port}`, grpc.credentials.createInsecure());
            upstreamCall = upstreamClient.Connect();
            upstreamCall.on("data", (message) => call.write(message));
            upstreamCall.once("end", finish);
            upstreamCall.once("error", finish);
            upstreamCall.write(firstMessage);
            for (const queued of pending.drain()) upstreamCall.write(queued);
            routed = true;
        }

        //* این تابع پیام های ورودی جی آر پی سی را تا آماده شدن مقصد محدود و سپس مستقیم عبور می دهد.
        function handleData(message) {
            if (routed) { upstreamCall.write(message); return; }
            if (routing) {
                try { pending.push(message); } catch { finish(); }
                return;
            }
            routing = true;
            void routeFirstMessage(message).catch(finish);
        }

        call.on("data", handleData);
        call.once("end", () => { try { upstreamCall?.end(); } catch { } if (!routed) finish(); });
        call.once("error", finish);
        call.once("cancelled", finish);
    }

    grpcServer.addService(servicePackage.VoiceMediaTransport.service, { connect: connectGrpc });

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(wsPort, wsHost, () => { httpServer.off("error", reject); resolve(); });
    });
    await new Promise((resolve, reject) => {
        grpcServer.bindAsync(`${grpcHost}:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (error) => error ? reject(error) : resolve());
    });

    console.log(`VME2_PHASE11_MEDIA_EDGE=READY | ws=${wsHost}:${wsPort} | grpc=${grpcHost}:${grpcPort} | region=${region} | zone=${zone}`);
}

await main().catch((error) => {
    console.error("VME2_PHASE11_MEDIA_EDGE=FAIL", error);
    process.exit(1);
});

export {
    createDirectoryResolver,
    createPendingBuffer,
    inspectPhase11BindPacket,
    main
};
