// File => src/realTime/test/realtimeLoginConnectHold.js

import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { WebSocket } from "ws";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ProjectRoot = path.resolve(__dirname, "../../..");
const ProtoRoot = path.resolve(ProjectRoot, "protos");

const GrpcTarget = process.env.REALTIME_TEST_GRPC_TARGET || process.env.GRPC_TARGET || `127.0.0.1:${process.env.GRPC_PORT || "50051"}`;
const WsUrl = process.env.REALTIME_TEST_WS_URL || process.env.REALTIME_WS_URL || `ws://127.0.0.1:${process.env.WS_PORT || "8080"}/ws`;
const Email = process.env.REALTIME_TEST_EMAIL || process.env.TEST_EMAIL || "";
const Password = process.env.REALTIME_TEST_PASSWORD || process.env.TEST_PASSWORD || "";
const UserName = process.env.REALTIME_TEST_USERNAME || "";
const HoldMs = Number(process.env.REALTIME_TEST_HOLD_MS || 45000);
const AppPingIntervalMs = Number(process.env.REALTIME_TEST_APP_PING_INTERVAL_MS || 0);
const AuthTimeoutMs = Number(process.env.REALTIME_TEST_AUTH_TIMEOUT_MS || 8000);
const OpenTimeoutMs = Number(process.env.REALTIME_TEST_OPEN_TIMEOUT_MS || 8000);
const TestRunId = process.env.REALTIME_TEST_RUN_ID || crypto.randomUUID();

function nowMs() { return Date.now(); }
function elapsedMs(startedAt) { return Date.now() - startedAt; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function makeMessageId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function log(message, data = null) { console.log(`[login-connect-hold] ${message}`, data ?? ""); }
function fail(message, data = null) { throw new Error(`${message}${data ? ` | ${JSON.stringify(data)}` : ""}`); }

function makeEnvelope({ ch, t, room = "", payload = null, requiresAck = false, replyTo = "" }) {
    return { v: 1, ch, t, id: makeMessageId(t), ts: nowMs(), room, payload, requiresAck, replyTo };
}

function parseMessage(data) {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data ?? "");
    return JSON.parse(text);
}

function loadAuthClient() {
    const packageDefinition = protoLoader.loadSync([
        path.join(ProtoRoot, "auth/auth.proto"),
        path.join(ProtoRoot, "common/user.proto"),
        path.join(ProtoRoot, "common/common.proto")
    ], {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [ProtoRoot]
    });

    const loaded = grpc.loadPackageDefinition(packageDefinition);
    const AuthService = loaded?.metaverse?.v1?.AuthService;
    if (!AuthService) fail("AuthService was not found in loaded proto");
    return new AuthService(GrpcTarget, grpc.credentials.createInsecure());
}

function callUnary(client, methodName, request, metadata = new grpc.Metadata()) {
    return new Promise((resolve, reject) => {
        client[methodName](request, metadata, (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
}

async function loginAndGetAccessToken() {
    if (!Email || !Password) fail("REALTIME_TEST_EMAIL and REALTIME_TEST_PASSWORD are required");

    const client = loadAuthClient();
    const metadata = new grpc.Metadata();
    metadata.set("x-test-client", "realtime-login-connect-hold");

    log("gRPC login started", { target: GrpcTarget, email: Email, hasUserName: Boolean(UserName) });
    const response = await callUnary(client, "Login", { email: Email, password: Password, userName: UserName }, metadata);

    if (!response?.success || !response?.accessToken) fail("gRPC login failed", { success: response?.success, message: response?.message });
    log("gRPC login passed", { userId: response?.user?.id ?? "", expiresIn: response?.expiresIn ?? 0 });
    client.close?.();
    return response.accessToken;
}

function openWebSocket(url) {
    const startedAt = Date.now();
    const receivedMessages = [];
    const ws = new WebSocket(url);

    ws.on("message", (data) => {
        try {
            const message = parseMessage(data);
            receivedMessages.push(message);
            log("message", message);
        } catch (error) {
            log("message_parse_failed", { error: error?.message ?? String(error) });
        }
    });

    ws.on("ping", (data) => log("protocol_ping_received", { bytes: data?.length ?? 0, elapsedMs: elapsedMs(startedAt) }));
    ws.on("pong", (data) => log("protocol_pong_received", { bytes: data?.length ?? 0, elapsedMs: elapsedMs(startedAt) }));
    ws.on("close", (code, reason) => log("closed", { code, reason: String(reason ?? ""), elapsedMs: elapsedMs(startedAt) }));
    ws.on("error", (error) => log("error", { error: error?.message ?? String(error), elapsedMs: elapsedMs(startedAt) }));

    const opened = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`WebSocket open timeout after ${OpenTimeoutMs}ms`)), OpenTimeoutMs);
        ws.once("open", () => { clearTimeout(timer); resolve(true); });
        ws.once("error", (error) => { clearTimeout(timer); reject(error); });
    });

    return { ws, receivedMessages, opened, startedAt };
}

function sendEnvelope(ws, envelope) {
    if (ws.readyState !== WebSocket.OPEN) fail("WebSocket is not open before send", { readyState: ws.readyState });
    ws.send(JSON.stringify(envelope));
    log("sent", envelope);
    return envelope;
}

function waitForMessage(receivedMessages, predicate, label, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            const found = receivedMessages.find(predicate);
            if (found) {
                clearInterval(timer);
                resolve(found);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                reject(new Error(`Timeout while waiting for ${label}`));
            }
        }, 25);
    });
}

async function authRealtime(ws, receivedMessages, accessToken) {
    const authEnvelope = sendEnvelope(ws, makeEnvelope({ ch: "system", t: "auth", payload: { accessToken } }));
    const result = await waitForMessage(
        receivedMessages,
        (m) => m.ch === "system" && (m.t === "auth_ok" || m.t === "auth_failed") && m.replyTo === authEnvelope.id,
        "system/auth result",
        AuthTimeoutMs
    );

    if (result.t !== "auth_ok") fail("Realtime auth failed", result);
    log("realtime_auth_passed", { userId: result?.payload?.userId ?? "", connectionId: result?.payload?.connectionId ?? "" });
    return result;
}

async function runHold(ws, receivedMessages) {
    const startedAt = Date.now();
    let appPingTimer = null;
    let closed = false;
    let closeInfo = null;

    ws.once("close", (code, reason) => {
        closed = true;
        closeInfo = { code, reason: String(reason ?? ""), elapsedMs: elapsedMs(startedAt) };
    });

    if (AppPingIntervalMs > 0) {
        appPingTimer = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            sendEnvelope(ws, makeEnvelope({ ch: "system", t: "ping", payload: { runId: TestRunId, clientTs: nowMs() } }));
        }, AppPingIntervalMs);
    }

    log("hold_started", { holdMs: HoldMs, appPingIntervalMs: AppPingIntervalMs });

    while (elapsedMs(startedAt) < HoldMs) {
        if (closed || ws.readyState !== WebSocket.OPEN) {
            if (appPingTimer) clearInterval(appPingTimer);
            fail("WebSocket closed before hold completed", closeInfo ?? { readyState: ws.readyState, elapsedMs: elapsedMs(startedAt) });
        }
        await sleep(250);
    }

    if (appPingTimer) clearInterval(appPingTimer);
    log("hold_passed", { holdMs: HoldMs, messages: receivedMessages.length });
}

async function closeGracefully(ws) {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, "login_connect_hold_done");
    await sleep(250);
}

async function main() {
    log("test_started", { grpcTarget: GrpcTarget, wsUrl: WsUrl, holdMs: HoldMs, runId: TestRunId });

    const accessToken = await loginAndGetAccessToken();
    const { ws, receivedMessages, opened } = openWebSocket(WsUrl);

    await opened;
    log("websocket_opened", { url: WsUrl });

    try {
        await authRealtime(ws, receivedMessages, accessToken);
        await runHold(ws, receivedMessages);
        log("test_passed", { ok: true });
    } finally {
        await closeGracefully(ws);
    }
}

main().catch((error) => {
    console.error("[login-connect-hold] test_failed", error?.stack ?? error?.message ?? String(error));
    process.exit(1);
});
