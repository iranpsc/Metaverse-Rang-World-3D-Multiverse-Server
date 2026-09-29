import http from "node:http";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { acceptVoiceMediaV2WebSocketConnection, isVoiceMediaV2WebSocketRequest } from "../mediaV2/voiceMediaV2WebSocketTransport.js";
import { createVoiceMediaNodeRuntime } from "../mediaNode/mediaNodeRuntime.js";
import { createMediaNodeTelemetryRuntimeAdapter } from "../mediaNode/scaling/mediaNodeTelemetryRuntimeAdapter.js";
import { createVoiceMediaPacketSecurityRuntimeAdapter } from "../security/voiceMediaPacketSecurityRuntimeAdapter.js";
import { createVoiceMediaFloodProtectionRuntimeAdapter } from "../security/voiceMediaFloodProtectionRuntimeAdapter.js";
import { createVoiceMediaPacketIntegrityPolicy } from "../security/voiceMediaPacketIntegrityPolicy.js";
import { createVoiceMediaPayloadCipher } from "../security/voiceMediaPayloadCipher.js";
import { decodeVoiceMediaSecurityHandshake, deriveVoiceMediaSecurityKeys } from "../security/voiceMediaSecurityHandshake.js";

const CHILD_ARG = "--voice-media-load-child";
const DEFAULT_CONNECTION_STAGES = Object.freeze([4, 10, 20, 40, 80]);
const DEFAULT_STAGE_SECONDS = 8;
const DEFAULT_FRAME_INTERVAL_MS = 20;
const DEFAULT_PAYLOAD_BYTES = 81;
const DRAIN_MS = 750;
const BIND_TIMEOUT_MS = 5000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
    return parsed;
}

function parseStages(value) {
    const text = String(value ?? "").trim();
    if (!text) return Array.from(DEFAULT_CONNECTION_STAGES);
    const stages = text.split(",").map((part) => Number(part.trim()));
    if (stages.length === 0 || stages.some((item) => !Number.isSafeInteger(item) || item < 2 || item > 1000 || item % 2 !== 0)) {
        throw new RangeError("VOICE_MEDIA_LOAD_CONNECTIONS must contain even connection counts between 2 and 1000.");
    }
    return stages;
}

function percentileToMs(histogram, percentile) {
    if (!histogram || histogram.count === 0) return 0;
    return Number(histogram.percentile(percentile)) / 1_000_000;
}

function histogramMaxToMs(histogram) {
    return histogram && histogram.count > 0 ? Number(histogram.max) / 1_000_000 : 0;
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
            if (!token.startsWith("local-load-token-") || !room.startsWith("local-load-room-") || !connectionId) {
                return Object.freeze({ success: false });
            }
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
                    if (memberId !== senderId) {
                        listenerId = memberId;
                        break;
                    }
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
        getRouteStats() {
            return Object.freeze({ routeFrames, routeErrors, roomsObserved: roomMembers.size });
        }
    });
}

function deterministicRoomSessionId(roomId) {
    const suffix = Number(String(roomId).split("-").pop()) || 1;
    const hex = (suffix >>> 0).toString(16).padStart(12, "0").slice(-12);
    return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

async function runChildServer() {
    const stack = createServerStack();
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();

    const httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            const telemetry = stack.runtime.sampleTelemetry?.() ?? null;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, stats: stack.runtime.getStats(), telemetry, routes: stack.getRouteStats() }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
        if (!isVoiceMediaV2WebSocketRequest(request)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
    });
    wss.on("connection", (socket, request) => {
        acceptVoiceMediaV2WebSocketConnection({ socket, request, runtime: stack.runtime });
    });

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", () => {
            httpServer.off("error", reject);
            resolve();
        });
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Local media load server address is invalid.");
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
                const telemetry = stack.runtime.sampleTelemetry?.() ?? null;
                const payload = {
                    type: "stageStats",
                    requestId: message.requestId,
                    stats: stack.runtime.getStats(),
                    telemetry,
                    routes: stack.getRouteStats(),
                    process: {
                        pid: process.pid,
                        rssBytes: process.memoryUsage().rss,
                        heapUsedBytes: process.memoryUsage().heapUsed,
                        eventLoopP95Ms: percentileToMs(eventLoop, 95),
                        eventLoopP99Ms: percentileToMs(eventLoop, 99),
                        eventLoopMaxMs: histogramMaxToMs(eventLoop)
                    }
                };
                process.send?.(payload);
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
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for local media load child process."));
        }, timeoutMs);
        function cleanup() {
            clearTimeout(timer);
            child.off("message", onMessage);
            child.off("exit", onExit);
        }
        function onMessage(message) {
            if (message?.type === "childError") {
                cleanup();
                reject(new Error(message.error));
                return;
            }
            if (!predicate(message)) return;
            cleanup();
            resolve(message);
        }
        function onExit(code, signal) {
            cleanup();
            reject(new Error(`Local media load child exited early. code=${code} signal=${signal ?? ""}`));
        }
        child.on("message", onMessage);
        child.once("exit", onExit);
    });
}

let requestSequence = 0;
async function childRequest(child, type, timeoutMs = 10000) {
    const requestId = ++requestSequence;
    const expectedType = type === "stageStart" ? "stageStarted" : type === "stageStats" ? "stageStats" : type === "stop" ? "stopped" : type;
    const responsePromise = waitForChildMessage(child, (message) => message?.type === expectedType && message?.requestId === requestId, timeoutMs);
    child.send({ type, requestId });
    return await responsePromise;
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
    try { client.outboundIntegrity?.dispose(); } catch { }
    try { client.inboundIntegrity?.dispose(); } catch { }
    try { client.outboundCipher?.dispose(); } catch { }
    try { client.inboundCipher?.dispose(); } catch { }
    if (client.keys) {
        for (const value of Object.values(client.keys)) {
            try { value?.fill?.(0); } catch { }
        }
    }
}

async function createLoadClient({ url, index, stageId } = {}) {
    const controlConnectionId = randomUUID().toLowerCase();
    const streamId = randomUUID().toLowerCase();
    const pairIndex = Math.floor(index / 2);
    const roomId = `local-load-room-${stageId}-${pairIndex + 1}`;
    const accessToken = `local-load-token-${stageId}-${index + 1}-${randomUUID()}`;
    const client = {
        index,
        controlConnectionId,
        streamId,
        roomId,
        accessToken,
        ws: null,
        bound: false,
        closed: false,
        closeCode: 0,
        closeReason: "",
        transportSequence: 1,
        mediaSequence: 0,
        sentMedia: 0,
        receivedMedia: 0,
        invalidInbound: 0,
        sendErrors: 0,
        outboundIntegrity: null,
        inboundIntegrity: null,
        outboundCipher: null,
        inboundCipher: null,
        keys: null
    };

    const socket = new WebSocket(url);
    client.ws = socket;

    const bindPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Bind timeout for client ${index}.`)), BIND_TIMEOUT_MS);
        socket.once("open", () => {
            const bindPayload = encodeVoiceMediaV2BindRequest({
                accessToken,
                roomId,
                controlConnectionId,
                platform: 2,
                clientBuild: "local-load;vme2s1"
            });
            const bindPacket = encodeVoiceMediaV2Packet({
                kind: VoiceMediaV2PacketKind.BIND_REQUEST,
                codec: VoiceMediaV2Codec.NONE,
                transportSequence: client.transportSequence,
                streamId,
                payload: bindPayload
            });
            socket.send(bindPacket, { binary: true });
        });
        socket.on("message", (data, isBinary) => {
            if (!isBinary) {
                client.invalidInbound += 1;
                return;
            }
            try {
                if (!client.bound) {
                    const packet = decodeVoiceMediaV2Packet(Buffer.from(data));
                    if (packet.kind !== VoiceMediaV2PacketKind.BIND_RESULT) return;
                    const result = decodeVoiceMediaV2BindResult(packet.payload);
                    if (!result.success) throw new Error(`Media bind rejected for client ${index}: ${result.message}`);
                    const handshake = decodeVoiceMediaSecurityHandshake(result.message);
                    const keys = deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId, streamId, securityContextId: handshake.securityContextId, nonce: handshake.nonce });
                    client.keys = keys;
                    client.outboundIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.clientToServerKey });
                    client.inboundIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.serverToClientKey });
                    client.outboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.clientToServerEncryptionKey });
                    client.inboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.serverToClientEncryptionKey });
                    client.bound = true;
                    clearTimeout(timer);
                    resolve();
                    return;
                }
                const verified = client.inboundIntegrity.verifyAndUnwrap(Buffer.from(data));
                if (!verified.accepted) {
                    client.invalidInbound += 1;
                    return;
                }
                const decrypted = client.inboundCipher.decrypt(verified.packet);
                if (decrypted.kind === VoiceMediaV2PacketKind.MEDIA) client.receivedMedia += 1;
            } catch (error) {
                client.invalidInbound += 1;
                if (!client.bound) {
                    clearTimeout(timer);
                    reject(error);
                }
            }
        });
        socket.once("error", (error) => {
            if (!client.bound) {
                clearTimeout(timer);
                reject(error);
            }
        });
    });

    socket.on("close", (code, reason) => {
        client.closed = true;
        client.closeCode = code;
        client.closeReason = Buffer.from(reason ?? "").toString("utf8");
    });

    await bindPromise;
    return client;
}

function sendMediaFrame(client, payload) {
    if (!client.bound || client.closed || client.ws?.readyState !== WebSocket.OPEN) return false;
    try {
        client.transportSequence += 1;
        client.mediaSequence += 1;
        const plain = buildPlainMediaPacket(client, client.transportSequence, client.mediaSequence, payload);
        const protectedPacket = client.outboundIntegrity.protect(client.outboundCipher.encrypt(plain));
        client.ws.send(protectedPacket, { binary: true }, (error) => {
            if (error) client.sendErrors += 1;
        });
        client.sentMedia += 1;
        return true;
    } catch {
        client.sendErrors += 1;
        return false;
    }
}

async function closeClients(clients) {
    for (const client of clients) {
        try { client.ws?.close(1000, "load_stage_complete"); } catch { }
    }
    await Promise.race([
        Promise.all(clients.map((client) => new Promise((resolve) => {
            if (client.closed || !client.ws || client.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
            client.ws.once("close", resolve);
            setTimeout(resolve, 1000);
        }))),
        sleep(1500)
    ]);
    for (const client of clients) disposeClientCrypto(client);
}

function delta(after, before, path) {
    const read = (root) => path.reduce((value, key) => value?.[key], root);
    return Number(read(after) ?? 0) - Number(read(before) ?? 0);
}

async function runStage({ child, url, connections, stageSeconds, frameIntervalMs, payloadBytes, stageIndex } = {}) {
    const stageId = `${Date.now()}-${stageIndex}`;
    const clients = [];
    for (let index = 0; index < connections; index += 1) clients.push(await createLoadClient({ url, index, stageId }));
    await sleep(250);

    const before = await childRequest(child, "stageStats");
    await childRequest(child, "stageStart");

    const payload = Buffer.alloc(payloadBytes, 0x5a);
    const deadline = Date.now() + stageSeconds * 1000;
    let ticks = 0;
    let nextTickAt = Date.now();
    while (Date.now() < deadline) {
        nextTickAt += frameIntervalMs;
        for (const client of clients) sendMediaFrame(client, payload);
        ticks += 1;
        const waitMs = nextTickAt - Date.now();
        if (waitMs > 0) {
            await sleep(waitMs);
        } else {
            // Do not replay missed timer slots as an artificial burst; keep the local publisher capped near the target cadence.
            if (waitMs < -frameIntervalMs) nextTickAt = Date.now();
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
    await sleep(DRAIN_MS);

    const after = await childRequest(child, "stageStats");
    const sentMedia = clients.reduce((sum, client) => sum + client.sentMedia, 0);
    const receivedMedia = clients.reduce((sum, client) => sum + client.receivedMedia, 0);
    const invalidInbound = clients.reduce((sum, client) => sum + client.invalidInbound, 0);
    const sendErrors = clients.reduce((sum, client) => sum + client.sendErrors, 0);
    const unexpectedClosed = clients.filter((client) => client.closed && client.closeCode !== 1000).length;
    const floodClosedDelta = delta(after.stats, before.stats, ["floodProtection", "closedFloodConnections"]);
    const floodBurstDelta = delta(after.stats, before.stats, ["floodProtection", "droppedPacketsByReason", "burst"]);
    const floodRateDelta = delta(after.stats, before.stats, ["floodProtection", "droppedPacketsByReason", "packet_rate"]);
    const securityRejectDelta = delta(after.stats, before.stats, ["packetSecurity", "rejectedProtectedPackets"]);
    const protectedAcceptedDelta = delta(after.stats, before.stats, ["packetSecurity", "acceptedProtectedPackets"]);
    const encryptedDelta = delta(after.stats, before.stats, ["packetSecurity", "encryptedPackets"]);
    const decryptedDelta = delta(after.stats, before.stats, ["packetSecurity", "decryptedPackets"]);
    const routeFrameDelta = Number(after.routes?.routeFrames ?? 0) - Number(before.routes?.routeFrames ?? 0);
    const routeErrorDelta = Number(after.routes?.routeErrors ?? 0) - Number(before.routes?.routeErrors ?? 0);
    const receiveRatio = sentMedia > 0 ? receivedMedia / sentMedia : 0;
    const stagePass =
        sentMedia > 0 &&
        receiveRatio >= 0.99 &&
        invalidInbound === 0 &&
        sendErrors === 0 &&
        unexpectedClosed === 0 &&
        floodClosedDelta === 0 &&
        floodBurstDelta === 0 &&
        floodRateDelta === 0 &&
        securityRejectDelta === 0 &&
        routeErrorDelta === 0 &&
        Number(after.stats?.bound ?? -1) === connections &&
        Number(after.stats?.packetSecurity?.activeContexts ?? -1) === connections;

    const result = Object.freeze({
        connections,
        rooms: connections / 2,
        stageSeconds,
        frameIntervalMs,
        payloadBytes,
        ticks,
        sentMedia,
        receivedMedia,
        receiveRatio,
        invalidInbound,
        sendErrors,
        unexpectedClosed,
        bound: Number(after.stats?.bound ?? 0),
        securityContexts: Number(after.stats?.packetSecurity?.activeContexts ?? 0),
        floodClosedDelta,
        floodBurstDelta,
        floodRateDelta,
        securityRejectDelta,
        protectedAcceptedDelta,
        encryptedDelta,
        decryptedDelta,
        routeFrameDelta,
        routeErrorDelta,
        cpuPercent: Number(after.telemetry?.cpuPercent ?? 0),
        outboundKbps: Number(after.telemetry?.outboundKbps ?? 0),
        rssMiB: Number(after.process?.rssBytes ?? 0) / (1024 * 1024),
        heapMiB: Number(after.process?.heapUsedBytes ?? 0) / (1024 * 1024),
        eventLoopP95Ms: Number(after.process?.eventLoopP95Ms ?? 0),
        eventLoopP99Ms: Number(after.process?.eventLoopP99Ms ?? 0),
        eventLoopMaxMs: Number(after.process?.eventLoopMaxMs ?? 0),
        pass: stagePass
    });

    await closeClients(clients);
    await sleep(300);
    return result;
}

function printStage(result) {
    console.log([
        `VOICE_MEDIA_CONCURRENT_LOAD_STAGE=${result.pass ? "PASS" : "FAIL"}`,
        `connections=${result.connections}`,
        `rooms=${result.rooms}`,
        `sent=${result.sentMedia}`,
        `received=${result.receivedMedia}`,
        `receivePercent=${(result.receiveRatio * 100).toFixed(3)}`,
        `bound=${result.bound}`,
        `securityContexts=${result.securityContexts}`,
        `floodClosedDelta=${result.floodClosedDelta}`,
        `floodBurstDelta=${result.floodBurstDelta}`,
        `floodRateDelta=${result.floodRateDelta}`,
        `securityRejectDelta=${result.securityRejectDelta}`,
        `routeErrors=${result.routeErrorDelta}`,
        `cpuPercent=${result.cpuPercent.toFixed(3)}`,
        `outboundKbps=${result.outboundKbps.toFixed(3)}`,
        `rssMiB=${result.rssMiB.toFixed(2)}`,
        `eventLoopP95Ms=${result.eventLoopP95Ms.toFixed(3)}`,
        `eventLoopP99Ms=${result.eventLoopP99Ms.toFixed(3)}`,
        `eventLoopMaxMs=${result.eventLoopMaxMs.toFixed(3)}`
    ].join(" | "));
}

async function runParent() {
    const stages = parseStages(process.env.VOICE_MEDIA_LOAD_CONNECTIONS);
    const stageSeconds = parsePositiveInteger(process.env.VOICE_MEDIA_LOAD_STAGE_SECONDS, DEFAULT_STAGE_SECONDS, 2, 120);
    const frameIntervalMs = parsePositiveInteger(process.env.VOICE_MEDIA_LOAD_FRAME_INTERVAL_MS, DEFAULT_FRAME_INTERVAL_MS, 10, 1000);
    const payloadBytes = parsePositiveInteger(process.env.VOICE_MEDIA_LOAD_PAYLOAD_BYTES, DEFAULT_PAYLOAD_BYTES, 1, 1000);

    const child = fork(fileURLToPath(import.meta.url), [CHILD_ARG], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const ready = await waitForChildMessage(child, (message) => message?.type === "ready", 10000);
    const url = `ws://127.0.0.1:${ready.port}/ws?transport=voice-media-v2`;
    console.log(`VOICE_MEDIA_CONCURRENT_LOAD=START | childPid=${child.pid} | endpoint=${url} | stages=${stages.join(",")} | stageSeconds=${stageSeconds} | frameIntervalMs=${frameIntervalMs} | payloadBytes=${payloadBytes} | packetSecurity=True | encryption=True | floodProtection=True | externalNetwork=False`);

    const results = [];
    let overallPass = true;
    try {
        for (let index = 0; index < stages.length; index += 1) {
            const connections = stages[index];
            const result = await runStage({ child, url, connections, stageSeconds, frameIntervalMs, payloadBytes, stageIndex: index + 1 });
            results.push(result);
            printStage(result);
            if (!result.pass) {
                overallPass = false;
                break;
            }
        }
    } finally {
        try { await childRequest(child, "stop", 10000); } catch { try { child.kill("SIGTERM"); } catch { } }
    }

    const maxConnections = results.filter((item) => item.pass).reduce((maximum, item) => Math.max(maximum, item.connections), 0);
    const peakCpu = results.reduce((maximum, item) => Math.max(maximum, item.cpuPercent), 0);
    const peakOutbound = results.reduce((maximum, item) => Math.max(maximum, item.outboundKbps), 0);
    const peakRss = results.reduce((maximum, item) => Math.max(maximum, item.rssMiB), 0);
    const peakEventLoopP99 = results.reduce((maximum, item) => Math.max(maximum, item.eventLoopP99Ms), 0);
    console.log(`VOICE_MEDIA_CONCURRENT_LOAD=${overallPass ? "PASS" : "FAIL"} | highestPassedConnections=${maxConnections} | stagesCompleted=${results.length}/${stages.length} | peakCpuPercent=${peakCpu.toFixed(3)} | peakOutboundKbps=${peakOutbound.toFixed(3)} | peakRssMiB=${peakRss.toFixed(2)} | peakEventLoopP99Ms=${peakEventLoopP99.toFixed(3)} | packetSecurity=True | aes256Ctr=True | hmacSha256128=True | floodProtection=True | websocketMediaV2=True | pairwiseRoomRouting=True | externalNetwork=False | productionProcessesChanged=False`);

    if (!overallPass) process.exitCode = 1;
}

if (process.argv.includes(CHILD_ARG)) {
    await runChildServer();
} else {
    await runParent().catch((error) => {
        console.error(`VOICE_MEDIA_CONCURRENT_LOAD=FAIL | error=${JSON.stringify(error?.message ?? String(error))}`);
        process.exitCode = 1;
    });
}
