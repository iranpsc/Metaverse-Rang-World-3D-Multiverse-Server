import http from "node:http";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { acceptVoiceMediaV2WebSocketConnection, isVoiceMediaV2WebSocketRequest } from "../mediaV2/voiceMediaV2WebSocketTransport.js";
import { createVoiceMediaNodeRuntime } from "../mediaNode/mediaNodeRuntime.js";
import { createMediaNodeTelemetryRuntimeAdapter } from "../mediaNode/scaling/mediaNodeTelemetryRuntimeAdapter.js";
import { MEDIA_PACKET_SECURITY_CAPABILITY, createVoiceMediaPacketSecurityRuntimeAdapter, requestsPacketSecurity } from "../security/voiceMediaPacketSecurityRuntimeAdapter.js";
import { createVoiceMediaFloodProtectionRuntimeAdapter } from "../security/voiceMediaFloodProtectionRuntimeAdapter.js";
import { createVoiceMediaPacketIntegrityPolicy } from "../security/voiceMediaPacketIntegrityPolicy.js";
import { createVoiceMediaPayloadCipher } from "../security/voiceMediaPayloadCipher.js";
import { decodeVoiceMediaSecurityHandshake, deriveVoiceMediaSecurityKeys } from "../security/voiceMediaSecurityHandshake.js";

const CHILD_ARG = "--voice-media-impairment-child";
const PROBE_VERSION = "p20.8-network-impair-v4";
const CLIENT_BUILD = `local-impair;${MEDIA_PACKET_SECURITY_CAPABILITY}`;
const DEFAULT_CONNECTIONS = 40;
const DEFAULT_STAGE_SECONDS = 8;
const DEFAULT_FRAME_INTERVAL_MS = 20;
const DEFAULT_PAYLOAD_BYTES = 81;
const BIND_TIMEOUT_MS = 5000;
const DRAIN_MS = 1000;

const DEFAULT_SCENARIOS = Object.freeze([
    Object.freeze({ name: "clean", lossPercent: 0, baseDelayMs: 0, jitterMs: 0, burstEveryFrames: 0, burstFrames: 0 }),
    Object.freeze({ name: "delay120_jitter20", lossPercent: 0, baseDelayMs: 120, jitterMs: 20, burstEveryFrames: 0, burstFrames: 0 }),
    Object.freeze({ name: "delay200_jitter60", lossPercent: 0, baseDelayMs: 200, jitterMs: 60, burstEveryFrames: 0, burstFrames: 0 }),
    Object.freeze({ name: "loss2_delay100_jitter30", lossPercent: 2, baseDelayMs: 100, jitterMs: 30, burstEveryFrames: 0, burstFrames: 0 }),
    Object.freeze({ name: "loss5_delay150_jitter50", lossPercent: 5, baseDelayMs: 150, jitterMs: 50, burstEveryFrames: 0, burstFrames: 0 }),
    Object.freeze({ name: "burst_loss_100ms_every2s", lossPercent: 0, baseDelayMs: 80, jitterMs: 20, burstEveryFrames: 100, burstFrames: 5 })
]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function positiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function percentileToMs(histogram, percentile) {
    if (!histogram || histogram.count === 0) return 0;
    return Number(histogram.percentile(percentile)) / 1_000_000;
}

function histogramMaxToMs(histogram) {
    return histogram && histogram.count > 0 ? Number(histogram.max) / 1_000_000 : 0;
}

function deterministicUnit(clientIndex, sequence, salt = 0) {
    let x = (((clientIndex + 1) * 0x9e3779b1) ^ ((sequence + 11) * 0x85ebca6b) ^ (salt * 0xc2b2ae35)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
}

function impairmentDecision(client, scenario) {
    const seq = client.mediaSequence;
    const inBurst = scenario.burstEveryFrames > 0 && scenario.burstFrames > 0 && ((seq - 1) % scenario.burstEveryFrames) < scenario.burstFrames;
    const randomDrop = scenario.lossPercent > 0 && deterministicUnit(client.index, seq, 1) < scenario.lossPercent / 100;
    const dropped = inBurst || randomDrop;
    const jitter = scenario.jitterMs > 0 ? Math.round((deterministicUnit(client.index, seq, 2) * 2 - 1) * scenario.jitterMs) : 0;
    const delayMs = Math.max(0, scenario.baseDelayMs + jitter);
    return { dropped, delayMs, reason: inBurst ? "burst" : randomDrop ? "loss" : "none" };
}

function validateImpairmentGenerator() {
    const samples = 40000;
    let loss2 = 0;
    let loss5 = 0;
    let jitterMin = Infinity;
    let jitterMax = -Infinity;
    for (let i = 0; i < samples; i += 1) {
        const clientIndex = i % 40;
        const sequence = Math.floor(i / 40) + 1;
        const uLoss = deterministicUnit(clientIndex, sequence, 1);
        const uJitter = deterministicUnit(clientIndex, sequence, 2);
        if (!(uLoss >= 0 && uLoss < 1) || !(uJitter >= 0 && uJitter < 1)) {
            throw new Error(`Impairment generator range check failed. uLoss=${uLoss}; uJitter=${uJitter}`);
        }
        if (uLoss < 0.02) loss2 += 1;
        if (uLoss < 0.05) loss5 += 1;
        const jitter = (uJitter * 2) - 1;
        jitterMin = Math.min(jitterMin, jitter);
        jitterMax = Math.max(jitterMax, jitter);
    }
    const loss2Percent = (loss2 / samples) * 100;
    const loss5Percent = (loss5 / samples) * 100;
    if (loss2Percent < 1.5 || loss2Percent > 2.5 || loss5Percent < 4.3 || loss5Percent > 5.7 || jitterMin >= -0.8 || jitterMax <= 0.8) {
        throw new Error(`Impairment generator distribution check failed. loss2=${loss2Percent.toFixed(3)}; loss5=${loss5Percent.toFixed(3)}; jitterMin=${jitterMin.toFixed(3)}; jitterMax=${jitterMax.toFixed(3)}`);
    }
    return { loss2Percent, loss5Percent, jitterMin, jitterMax };
}

function deterministicRoomSessionId(roomId) {
    const match = String(roomId).match(/-(\d+)$/);
    const suffix = Number(match?.[1]) || 1;
    const hex = (suffix >>> 0).toString(16).padStart(12, "0").slice(-12);
    return `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
}

function createServerStack() {
    const roomMembers = new Map();
    let finalRuntime = null;
    let routeFrames = 0;
    let routeErrors = 0;

    const bridgeClient = {
        async authorizeBind({ accessToken, roomId, controlConnectionId } = {}) {
            const token = String(accessToken ?? "").trim();
            const room = String(roomId ?? "").trim();
            const connectionId = String(controlConnectionId ?? "").trim().toLowerCase();
            if (!token.startsWith("local-impair-token-") || !room.startsWith("local-impair-room-") || !connectionId) return Object.freeze({ success: false });
            let members = roomMembers.get(room);
            if (!members) {
                members = new Set();
                roomMembers.set(room, members);
            }
            members.add(connectionId);
            return Object.freeze({ success: true, controlConnectionId: connectionId, userId: `local-user-${connectionId}`, roomId: room });
        },
        async routeFrame({ controlConnectionId, flags, mediaSequence, mediaTimestamp100Ns, streamId, payload } = {}) {
            routeFrames += 1;
            const senderId = String(controlConnectionId ?? "").trim().toLowerCase();
            let senderRoom = "";
            let listenerId = "";
            for (const [roomId, members] of roomMembers) {
                if (!members.has(senderId)) continue;
                senderRoom = roomId;
                for (const memberId of members) {
                    if (memberId !== senderId) { listenerId = memberId; break; }
                }
                break;
            }
            if (!senderRoom || !listenerId) {
                routeErrors += 1;
                return Object.freeze({ success: true, accepted: false, dropReason: "local_listener_missing" });
            }
            try {
                await finalRuntime.deliverMedia({
                    listenerConnectionId: listenerId,
                    flags,
                    mediaSequence,
                    mediaTimestamp100Ns: String(mediaTimestamp100Ns),
                    sessionId: deterministicRoomSessionId(senderRoom),
                    streamId,
                    senderId,
                    payload
                });
                return Object.freeze({ success: true, accepted: true });
            } catch (error) {
                routeErrors += 1;
                return Object.freeze({ success: true, accepted: false, dropReason: error?.message ?? "local_route_failure" });
            }
        }
    };

    const baseRuntime = createVoiceMediaNodeRuntime({ bridgeClient });
    const telemetryRuntime = createMediaNodeTelemetryRuntimeAdapter({ runtime: baseRuntime });
    const securityRuntime = createVoiceMediaPacketSecurityRuntimeAdapter({ runtime: telemetryRuntime });
    finalRuntime = createVoiceMediaFloodProtectionRuntimeAdapter({ runtime: securityRuntime });

    return Object.freeze({
        runtime: finalRuntime,
        getRouteStats() { return Object.freeze({ routeFrames, routeErrors, roomsObserved: roomMembers.size }); }
    });
}

async function runChildServer() {
    const stack = createServerStack();
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();

    const httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, stats: stack.runtime.getStats(), telemetry: stack.runtime.sampleTelemetry?.() ?? null, routes: stack.getRouteStats() }));
            return;
        }
        res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
        if (!isVoiceMediaV2WebSocketRequest(request)) { socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
    });
    wss.on("connection", (socket, request) => acceptVoiceMediaV2WebSocketConnection({ socket, request, runtime: stack.runtime }));

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", () => { httpServer.off("error", reject); resolve(); });
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Local impairment server address is invalid.");
    process.send?.({ type: "ready", port: address.port });

    process.on("message", async (message) => {
        try {
            if (message?.type === "stageStart") {
                stack.runtime.sampleTelemetry?.();
                eventLoop.reset();
                process.send?.({ type: "stageStarted", requestId: message.requestId });
                return;
            }
            if (message?.type === "stageStats") {
                process.send?.({
                    type: "stageStats",
                    requestId: message.requestId,
                    stats: stack.runtime.getStats(),
                    telemetry: stack.runtime.sampleTelemetry?.() ?? null,
                    routes: stack.getRouteStats(),
                    process: {
                        rssBytes: process.memoryUsage().rss,
                        eventLoopP95Ms: percentileToMs(eventLoop, 95),
                        eventLoopP99Ms: percentileToMs(eventLoop, 99),
                        eventLoopMaxMs: histogramMaxToMs(eventLoop)
                    }
                });
                return;
            }
            if (message?.type === "stop") {
                eventLoop.disable();
                await stack.runtime.stop();
                await new Promise((resolve) => httpServer.close(() => resolve()));
                wss.close();
                process.send?.({ type: "stopped", requestId: message.requestId });
                process.exit(0);
            }
        } catch (error) {
            process.send?.({ type: "childError", requestId: message?.requestId, error: error?.stack ?? error?.message ?? String(error) });
        }
    });
}

function waitForChildMessage(child, predicate, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for local impairment child.")); }, timeoutMs);
        function cleanup() { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); }
        function onMessage(message) {
            if (message?.type === "childError") { cleanup(); reject(new Error(message.error)); return; }
            if (!predicate(message)) return;
            cleanup(); resolve(message);
        }
        function onExit(code, signal) { cleanup(); reject(new Error(`Local impairment child exited early. code=${code} signal=${signal ?? ""}`)); }
        child.on("message", onMessage); child.once("exit", onExit);
    });
}

let requestSequence = 0;
async function childRequest(child, type, timeoutMs = 10000) {
    const requestId = ++requestSequence;
    const expectedType = type === "stageStart" ? "stageStarted" : type === "stageStats" ? "stageStats" : type === "stop" ? "stopped" : type;
    const response = waitForChildMessage(child, (message) => message?.type === expectedType && message?.requestId === requestId, timeoutMs);
    child.send({ type, requestId });
    return await response;
}

function buildPlainMediaPacket(client, transportSequence, mediaSequence, payload) {
    return decodeVoiceMediaV2Packet(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.MEDIA,
        codec: VoiceMediaV2Codec.OPUS,
        transportSequence,
        mediaSequence,
        mediaTimestamp100Ns: BigInt(mediaSequence) * 200000n,
        streamId: client.streamId,
        payload
    }));
}

function disposeClientCrypto(client) {
    for (const item of [client.outboundIntegrity, client.inboundIntegrity, client.outboundCipher, client.inboundCipher]) {
        try { item?.dispose?.(); } catch { }
    }
    if (client.keys) for (const value of Object.values(client.keys)) try { value?.fill?.(0); } catch { }
}

async function createClient({ url, index, stageId }) {
    const controlConnectionId = randomUUID().toLowerCase();
    const streamId = randomUUID().toLowerCase();
    const pairIndex = Math.floor(index / 2);
    const roomId = `local-impair-room-${stageId}-${pairIndex + 1}`;
    const accessToken = `local-impair-token-${stageId}-${index + 1}-${randomUUID()}`;
    const client = {
        index, controlConnectionId, streamId, roomId, accessToken,
        ws: null, bound: false, closed: false, closeCode: 0,
        transportSequence: 1, mediaSequence: 0,
        attemptedMedia: 0, intentionalDrops: 0, burstDrops: 0, randomDrops: 0,
        scheduledMedia: 0, sentOnWire: 0, receivedMedia: 0, invalidInbound: 0, sendErrors: 0,
        pending: new Set(), outboundIntegrity: null, inboundIntegrity: null, outboundCipher: null, inboundCipher: null, keys: null
    };
    const socket = new WebSocket(url); client.ws = socket;
    const bindPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Bind timeout for client ${index}.`)), BIND_TIMEOUT_MS);
        socket.once("open", () => {
            const bindPayload = encodeVoiceMediaV2BindRequest({ accessToken, roomId, controlConnectionId, platform: 2, clientBuild: CLIENT_BUILD });
            socket.send(encodeVoiceMediaV2Packet({ kind: VoiceMediaV2PacketKind.BIND_REQUEST, codec: VoiceMediaV2Codec.NONE, transportSequence: client.transportSequence, streamId, payload: bindPayload }), { binary: true });
        });
        socket.on("message", (data, isBinary) => {
            if (!isBinary) { client.invalidInbound += 1; return; }
            try {
                if (!client.bound) {
                    const packet = decodeVoiceMediaV2Packet(Buffer.from(data));
                    if (packet.kind !== VoiceMediaV2PacketKind.BIND_RESULT) return;
                    const result = decodeVoiceMediaV2BindResult(packet.payload);
                    if (!result.success) throw new Error(`Media bind rejected for client ${index}: ${result.message}`);
                    if (!requestsPacketSecurity(CLIENT_BUILD)) throw new Error(`Probe security capability self-check failed. clientBuild=${CLIENT_BUILD}`);
                    if (!String(result.message ?? "").startsWith(`media_bind_ok|${MEDIA_PACKET_SECURITY_CAPABILITY}|`)) {
                        throw new Error(`Media security handshake missing. probeVersion=${PROBE_VERSION}; clientBuild=${CLIENT_BUILD}; securityRequested=${requestsPacketSecurity(CLIENT_BUILD)}; bindMessage=${JSON.stringify(result.message)}`);
                    }
                    const handshake = decodeVoiceMediaSecurityHandshake(result.message);
                    const keys = deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId, streamId, securityContextId: handshake.securityContextId, nonce: handshake.nonce });
                    client.keys = keys;
                    client.outboundIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.clientToServerKey });
                    client.inboundIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.serverToClientKey });
                    client.outboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.clientToServerEncryptionKey });
                    client.inboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.serverToClientEncryptionKey });
                    client.bound = true; clearTimeout(timer); resolve(); return;
                }
                const verified = client.inboundIntegrity.verifyAndUnwrap(Buffer.from(data));
                if (!verified.accepted) { client.invalidInbound += 1; return; }
                const decrypted = client.inboundCipher.decrypt(verified.packet);
                if (decrypted.kind === VoiceMediaV2PacketKind.MEDIA) client.receivedMedia += 1;
            } catch (error) {
                client.invalidInbound += 1;
                if (!client.bound) { clearTimeout(timer); reject(error); }
            }
        });
        socket.once("error", (error) => { if (!client.bound) { clearTimeout(timer); reject(error); } });
    });
    socket.on("close", (code) => { client.closed = true; client.closeCode = code; });
    await bindPromise;
    return client;
}

function scheduleImpairedFrame(client, payload, scenario) {
    if (!client.bound || client.closed || client.ws?.readyState !== WebSocket.OPEN) return;
    client.transportSequence += 1;
    client.mediaSequence += 1;
    client.attemptedMedia += 1;
    const decision = impairmentDecision(client, scenario);
    if (decision.dropped) {
        client.intentionalDrops += 1;
        if (decision.reason === "burst") client.burstDrops += 1;
        if (decision.reason === "loss") client.randomDrops += 1;
        return;
    }
    let protectedPacket;
    try {
        const plain = buildPlainMediaPacket(client, client.transportSequence, client.mediaSequence, payload);
        protectedPacket = client.outboundIntegrity.protect(client.outboundCipher.encrypt(plain));
    } catch {
        client.sendErrors += 1;
        return;
    }
    client.scheduledMedia += 1;
    const pending = new Promise((resolve) => {
        setTimeout(() => {
            try {
                if (client.closed || client.ws?.readyState !== WebSocket.OPEN) { client.sendErrors += 1; resolve(); return; }
                client.ws.send(protectedPacket, { binary: true }, (error) => { if (error) client.sendErrors += 1; });
                client.sentOnWire += 1;
            } catch { client.sendErrors += 1; }
            resolve();
        }, decision.delayMs);
    });
    client.pending.add(pending);
    pending.finally(() => client.pending.delete(pending));
}

async function closeClients(clients) {
    for (const client of clients) try { client.ws?.close(1000, "impairment_stage_complete"); } catch { }
    await sleep(500);
    for (const client of clients) disposeClientCrypto(client);
}

function delta(after, before, path) {
    const read = (root) => path.reduce((value, key) => value?.[key], root);
    return Number(read(after) ?? 0) - Number(read(before) ?? 0);
}

async function runScenario({ child, url, scenario, connections, stageSeconds, frameIntervalMs, payloadBytes, stageIndex }) {
    const stageId = `${Date.now()}-${stageIndex}`;
    const clients = [];
    for (let i = 0; i < connections; i += 1) clients.push(await createClient({ url, index: i, stageId }));
    await sleep(250);
    const before = await childRequest(child, "stageStats");
    await childRequest(child, "stageStart");

    const payload = Buffer.alloc(payloadBytes, 0x6b);
    const deadline = Date.now() + stageSeconds * 1000;
    let nextTickAt = Date.now();
    while (Date.now() < deadline) {
        nextTickAt += frameIntervalMs;
        for (const client of clients) scheduleImpairedFrame(client, payload, scenario);
        const waitMs = nextTickAt - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        else {
            if (waitMs < -frameIntervalMs) nextTickAt = Date.now();
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    const allPending = clients.flatMap((client) => Array.from(client.pending));
    if (allPending.length) await Promise.allSettled(allPending);
    await sleep(DRAIN_MS);

    const after = await childRequest(child, "stageStats");
    const sum = (key) => clients.reduce((total, client) => total + Number(client[key] ?? 0), 0);
    const attempted = sum("attemptedMedia");
    const intentionalDrops = sum("intentionalDrops");
    const burstDrops = sum("burstDrops");
    const randomDrops = sum("randomDrops");
    const sentOnWire = sum("sentOnWire");
    const received = sum("receivedMedia");
    const invalidInbound = sum("invalidInbound");
    const sendErrors = sum("sendErrors");
    const unexpectedClosed = clients.filter((client) => client.closed && client.closeCode !== 1000).length;
    const wireReceiveRatio = sentOnWire > 0 ? received / sentOnWire : 0;
    const appliedLossPercent = attempted > 0 ? (intentionalDrops / attempted) * 100 : 0;
    const floodClosedDelta = delta(after.stats, before.stats, ["floodProtection", "closedFloodConnections"]);
    const floodBurstDelta = delta(after.stats, before.stats, ["floodProtection", "droppedPacketsByReason", "burst"]);
    const floodRateDelta = delta(after.stats, before.stats, ["floodProtection", "droppedPacketsByReason", "packet_rate"]);
    const securityRejectDelta = delta(after.stats, before.stats, ["packetSecurity", "rejectedProtectedPackets"]);
    const routeErrorDelta = Number(after.routes?.routeErrors ?? 0) - Number(before.routes?.routeErrors ?? 0);
    const pass = attempted > 0 && sentOnWire > 0 && wireReceiveRatio >= 0.99 && invalidInbound === 0 && sendErrors === 0 && unexpectedClosed === 0 && floodClosedDelta === 0 && floodBurstDelta === 0 && floodRateDelta === 0 && securityRejectDelta === 0 && routeErrorDelta === 0 && Number(after.stats?.bound ?? -1) === connections && Number(after.stats?.packetSecurity?.activeContexts ?? -1) === connections;

    const result = {
        name: scenario.name, pass, connections, rooms: connections / 2,
        lossPercent: scenario.lossPercent, baseDelayMs: scenario.baseDelayMs, jitterMs: scenario.jitterMs,
        burstEveryFrames: scenario.burstEveryFrames, burstFrames: scenario.burstFrames,
        attempted, intentionalDrops, burstDrops, randomDrops, appliedLossPercent, sentOnWire, received, wireReceiveRatio,
        bound: Number(after.stats?.bound ?? 0), securityContexts: Number(after.stats?.packetSecurity?.activeContexts ?? 0),
        floodClosedDelta, floodBurstDelta, floodRateDelta, securityRejectDelta, routeErrorDelta,
        cpuPercent: Number(after.telemetry?.cpuPercent ?? 0), outboundKbps: Number(after.telemetry?.outboundKbps ?? 0),
        rssMiB: Number(after.process?.rssBytes ?? 0) / 1048576,
        eventLoopP95Ms: Number(after.process?.eventLoopP95Ms ?? 0), eventLoopP99Ms: Number(after.process?.eventLoopP99Ms ?? 0), eventLoopMaxMs: Number(after.process?.eventLoopMaxMs ?? 0)
    };
    await closeClients(clients);
    await sleep(300);
    return result;
}

function printResult(r) {
    console.log([
        `VOICE_MEDIA_NETWORK_IMPAIRMENT_STAGE=${r.pass ? "PASS" : "FAIL"}`,
        `scenario=${r.name}`, `connections=${r.connections}`, `rooms=${r.rooms}`,
        `configuredLossPercent=${r.lossPercent.toFixed(3)}`, `appliedLossPercent=${r.appliedLossPercent.toFixed(3)}`,
        `baseDelayMs=${r.baseDelayMs}`, `jitterMs=${r.jitterMs}`, `burstFrames=${r.burstFrames}`, `burstEveryFrames=${r.burstEveryFrames}`,
        `attempted=${r.attempted}`, `intentionalDrops=${r.intentionalDrops}`, `sentOnWire=${r.sentOnWire}`, `received=${r.received}`,
        `wireReceivePercent=${(r.wireReceiveRatio * 100).toFixed(3)}`, `bound=${r.bound}`, `securityContexts=${r.securityContexts}`,
        `floodClosedDelta=${r.floodClosedDelta}`, `floodBurstDelta=${r.floodBurstDelta}`, `floodRateDelta=${r.floodRateDelta}`,
        `securityRejectDelta=${r.securityRejectDelta}`, `routeErrors=${r.routeErrorDelta}`,
        `cpuPercent=${r.cpuPercent.toFixed(3)}`, `outboundKbps=${r.outboundKbps.toFixed(3)}`, `rssMiB=${r.rssMiB.toFixed(2)}`,
        `eventLoopP95Ms=${r.eventLoopP95Ms.toFixed(3)}`, `eventLoopP99Ms=${r.eventLoopP99Ms.toFixed(3)}`, `eventLoopMaxMs=${r.eventLoopMaxMs.toFixed(3)}`
    ].join(" | "));
}

async function runParent() {
    if (!requestsPacketSecurity(CLIENT_BUILD)) throw new Error(`Probe security capability self-check failed. clientBuild=${CLIENT_BUILD}`);
    const impairmentGenerator = validateImpairmentGenerator();
    console.log(`VOICE_MEDIA_NETWORK_IMPAIRMENT_GENERATOR=PASS | probeVersion=${PROBE_VERSION} | loss2SamplePercent=${impairmentGenerator.loss2Percent.toFixed(3)} | loss5SamplePercent=${impairmentGenerator.loss5Percent.toFixed(3)} | jitterUnitMin=${impairmentGenerator.jitterMin.toFixed(3)} | jitterUnitMax=${impairmentGenerator.jitterMax.toFixed(3)}`);
    const connections = positiveInteger(process.env.VOICE_MEDIA_IMPAIRMENT_CONNECTIONS, DEFAULT_CONNECTIONS, 2, 200);
    if (connections % 2 !== 0) throw new RangeError("VOICE_MEDIA_IMPAIRMENT_CONNECTIONS must be even.");
    const stageSeconds = positiveInteger(process.env.VOICE_MEDIA_IMPAIRMENT_STAGE_SECONDS, DEFAULT_STAGE_SECONDS, 4, 60);
    const frameIntervalMs = positiveInteger(process.env.VOICE_MEDIA_IMPAIRMENT_FRAME_INTERVAL_MS, DEFAULT_FRAME_INTERVAL_MS, 10, 1000);
    const payloadBytes = positiveInteger(process.env.VOICE_MEDIA_IMPAIRMENT_PAYLOAD_BYTES, DEFAULT_PAYLOAD_BYTES, 1, 1000);

    const child = fork(fileURLToPath(import.meta.url), [CHILD_ARG], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const ready = await waitForChildMessage(child, (message) => message?.type === "ready", 10000);
    const url = `ws://127.0.0.1:${ready.port}/ws?transport=voice-media-v2`;
    console.log(`VOICE_MEDIA_NETWORK_IMPAIRMENT=START | probeVersion=${PROBE_VERSION} | clientBuild=${CLIENT_BUILD} | securityCapabilityRequested=${requestsPacketSecurity(CLIENT_BUILD)} | childPid=${child.pid} | endpoint=${url} | connections=${connections} | rooms=${connections / 2} | scenarios=${DEFAULT_SCENARIOS.map((s) => s.name).join(",")} | stageSeconds=${stageSeconds} | frameIntervalMs=${frameIntervalMs} | packetSecurity=True | encryption=True | floodProtection=True | externalNetwork=False | productionProcessesChanged=False`);

    const results = [];
    let overallPass = true;
    try {
        for (let i = 0; i < DEFAULT_SCENARIOS.length; i += 1) {
            const result = await runScenario({ child, url, scenario: DEFAULT_SCENARIOS[i], connections, stageSeconds, frameIntervalMs, payloadBytes, stageIndex: i + 1 });
            results.push(result); printResult(result);
            if (!result.pass) { overallPass = false; break; }
        }
    } finally {
        try { await childRequest(child, "stop", 10000); } catch { try { child.kill("SIGTERM"); } catch { } }
    }
    const failed = results.filter((r) => !r.pass).map((r) => r.name).join(",") || "none";
    const peakCpu = Math.max(0, ...results.map((r) => r.cpuPercent));
    const peakP99 = Math.max(0, ...results.map((r) => r.eventLoopP99Ms));
    console.log(`VOICE_MEDIA_NETWORK_IMPAIRMENT=${overallPass ? "PASS" : "FAIL"} | stagesCompleted=${results.length}/${DEFAULT_SCENARIOS.length} | failedScenarios=${failed} | connections=${connections} | peakCpuPercent=${peakCpu.toFixed(3)} | peakEventLoopP99Ms=${peakP99.toFixed(3)} | packetSecurity=True | aes256Ctr=True | hmacSha256128=True | floodProtection=True | websocketMediaV2=True | externalNetwork=False | productionProcessesChanged=False`);
    if (!overallPass) process.exitCode = 1;
}

if (process.argv.includes(CHILD_ARG)) await runChildServer();
else await runParent().catch((error) => { console.error(`VOICE_MEDIA_NETWORK_IMPAIRMENT=FAIL | error=${JSON.stringify(error?.message ?? String(error))}`); process.exitCode = 1; });
