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
import { createVoiceMediaPacketSecurityRuntimeAdapter } from "../security/voiceMediaPacketSecurityRuntimeAdapter.js";
import { createVoiceMediaFloodProtectionRuntimeAdapter } from "../security/voiceMediaFloodProtectionRuntimeAdapter.js";
import { createVoiceMediaPacketIntegrityPolicy } from "../security/voiceMediaPacketIntegrityPolicy.js";
import { createVoiceMediaPayloadCipher } from "../security/voiceMediaPayloadCipher.js";
import { decodeVoiceMediaSecurityHandshake, deriveVoiceMediaSecurityKeys } from "../security/voiceMediaSecurityHandshake.js";

const CHILD_ARG = "--voice-media-reconnect-load-child";
const DEFAULT_CONNECTIONS = 40;
const DEFAULT_CYCLES = 5;
const DEFAULT_RECONNECT_PAIRS_PER_CYCLE = 4;
const DEFAULT_FRAME_INTERVAL_MS = 20;
const DEFAULT_PAYLOAD_BYTES = 81;
const DEFAULT_SETTLE_MS = 1200;
const DEFAULT_BETWEEN_CYCLES_MS = 1200;
const BIND_TIMEOUT_MS = 5000;
const CLOSE_TIMEOUT_MS = 2500;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEven(value, fallback, minimum, maximum, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum || parsed % 2 !== 0) {
        if (value == null || value === "") return fallback;
        throw new RangeError(`${name} must be an even integer between ${minimum} and ${maximum}.`);
    }
    return parsed;
}

function parsePositive(value, fallback, minimum, maximum, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        if (value == null || value === "") return fallback;
        throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }
    return parsed;
}

function percentileToMs(histogram, percentile) {
    if (!histogram || histogram.count === 0) return 0;
    return Number(histogram.percentile(percentile)) / 1_000_000;
}

function histogramMaxToMs(histogram) {
    return histogram && histogram.count > 0 ? Number(histogram.max) / 1_000_000 : 0;
}

function deterministicRoomSessionId(roomId) {
    const suffix = Number(String(roomId).split("-").pop()) || 1;
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
            if (!token.startsWith("local-reconnect-token-") || !room.startsWith("local-reconnect-room-") || !connectionId) {
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
    wss.on("connection", (socket, request) => acceptVoiceMediaV2WebSocketConnection({ socket, request, runtime: stack.runtime }));

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", () => {
            httpServer.off("error", reject);
            resolve();
        });
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Local reconnect load server address is invalid.");
    process.send?.({ type: "ready", port: address.port });

    process.on("message", async (message) => {
        try {
            if (message?.type === "stats") {
                const telemetry = stack.runtime.sampleTelemetry?.() ?? null;
                process.send?.({
                    type: "stats",
                    requestId: message.requestId,
                    stats: stack.runtime.getStats(),
                    telemetry,
                    routes: stack.getRouteStats(),
                    process: {
                        rssBytes: process.memoryUsage().rss,
                        heapUsedBytes: process.memoryUsage().heapUsed,
                        eventLoopP95Ms: percentileToMs(eventLoop, 95),
                        eventLoopP99Ms: percentileToMs(eventLoop, 99),
                        eventLoopMaxMs: histogramMaxToMs(eventLoop)
                    }
                });
                return;
            }
            if (message?.type === "resetEventLoop") {
                eventLoop.reset();
                process.send?.({ type: "resetEventLoop", requestId: message.requestId });
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
            reject(new Error("Timed out waiting for reconnect load child process."));
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
            reject(new Error(`Reconnect load child exited early. code=${code} signal=${signal ?? ""}`));
        }
        child.on("message", onMessage);
        child.once("exit", onExit);
    });
}

let requestSequence = 0;
async function childRequest(child, type, timeoutMs = 10000) {
    const requestId = ++requestSequence;
    const responsePromise = waitForChildMessage(child, (message) => message?.type === type && message?.requestId === requestId, timeoutMs);
    child.send({ type, requestId });
    return await responsePromise;
}

function buildPlainMediaPacket(client, payload) {
    client.transportSequence += 1;
    client.mediaSequence += 1;
    return decodeVoiceMediaV2Packet(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.MEDIA,
        codec: VoiceMediaV2Codec.OPUS,
        transportSequence: client.transportSequence,
        mediaSequence: client.mediaSequence,
        mediaTimestamp100Ns: BigInt(client.mediaSequence) * 200000n,
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
    client.outboundIntegrity = null;
    client.inboundIntegrity = null;
    client.outboundCipher = null;
    client.inboundCipher = null;
    client.keys = null;
}

function createLogicalClient(index) {
    const pairIndex = Math.floor(index / 2);
    return {
        index,
        pairIndex,
        controlConnectionId: randomUUID().toLowerCase(),
        streamId: randomUUID().toLowerCase(),
        roomId: `local-reconnect-room-${pairIndex + 1}`,
        accessToken: `local-reconnect-token-${index + 1}-${randomUUID()}`,
        ws: null,
        bound: false,
        closed: true,
        plannedClose: false,
        paused: false,
        transportSequence: 1,
        mediaSequence: 0,
        sentMedia: 0,
        receivedMedia: 0,
        invalidInbound: 0,
        sendErrors: 0,
        reconnects: 0,
        reconnectFailures: 0,
        lastSecurityContextId: 0,
        securityContextHistory: [],
        outboundIntegrity: null,
        inboundIntegrity: null,
        outboundCipher: null,
        inboundCipher: null,
        keys: null
    };
}

async function bindClientSocket(client, url, { reconnect = false } = {}) {
    disposeClientCrypto(client);
    client.bound = false;
    client.closed = false;
    client.plannedClose = false;
    const socket = new WebSocket(url);
    client.ws = socket;

    const bindPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Bind timeout for client ${client.index}.`));
        }, BIND_TIMEOUT_MS);
        function cleanup() {
            clearTimeout(timer);
        }
        socket.once("open", () => {
            const bindPayload = encodeVoiceMediaV2BindRequest({
                accessToken: client.accessToken,
                roomId: client.roomId,
                controlConnectionId: client.controlConnectionId,
                platform: 2,
                clientBuild: "local-reconnect;vme2s1"
            });
            const bindPacket = encodeVoiceMediaV2Packet({
                kind: VoiceMediaV2PacketKind.BIND_REQUEST,
                codec: VoiceMediaV2Codec.NONE,
                transportSequence: client.transportSequence,
                streamId: client.streamId,
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
                    if (!result.success) throw new Error(`Media bind rejected for client ${client.index}: ${result.message}`);
                    const handshake = decodeVoiceMediaSecurityHandshake(result.message);
                    if (reconnect && client.lastSecurityContextId !== 0 && handshake.securityContextId === client.lastSecurityContextId) {
                        throw new Error(`Security context was reused for client ${client.index}.`);
                    }
                    const keys = deriveVoiceMediaSecurityKeys({
                        accessToken: client.accessToken,
                        roomId: client.roomId,
                        controlConnectionId: client.controlConnectionId,
                        streamId: client.streamId,
                        securityContextId: handshake.securityContextId,
                        nonce: handshake.nonce
                    });
                    client.keys = keys;
                    client.outboundIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.clientToServerKey });
                    client.inboundIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.serverToClientKey });
                    client.outboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.clientToServerEncryptionKey });
                    client.inboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.serverToClientEncryptionKey });
                    client.lastSecurityContextId = handshake.securityContextId;
                    client.securityContextHistory.push(handshake.securityContextId);
                    client.bound = true;
                    if (reconnect) client.reconnects += 1;
                    cleanup();
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
                    cleanup();
                    reject(error);
                }
            }
        });
        socket.once("error", (error) => {
            if (!client.bound) {
                cleanup();
                reject(error);
            }
        });
    });

    socket.on("close", () => {
        client.closed = true;
        client.bound = false;
    });

    try {
        await bindPromise;
    } catch (error) {
        client.reconnectFailures += reconnect ? 1 : 0;
        try { socket.close(); } catch { }
        throw error;
    }
}

function sendMediaFrame(client, payload) {
    if (client.paused || !client.bound || client.closed || client.ws?.readyState !== WebSocket.OPEN) return false;
    try {
        const plain = buildPlainMediaPacket(client, payload);
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

async function closeClientForReconnect(client) {
    client.plannedClose = true;
    if (!client.ws || client.ws.readyState === WebSocket.CLOSED) {
        client.closed = true;
        client.bound = false;
        disposeClientCrypto(client);
        return;
    }
    const waitClosed = new Promise((resolve) => {
        const timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        client.ws.once("close", () => {
            clearTimeout(timer);
            resolve();
        });
    });
    try { client.ws.close(4000, "reconnect_load_cycle"); } catch { }
    await waitClosed;
    client.closed = true;
    client.bound = false;
    disposeClientCrypto(client);
}

async function closeAllClients(clients) {
    for (const client of clients) {
        client.paused = true;
        try { client.ws?.close(1000, "reconnect_test_complete"); } catch { }
    }
    await sleep(800);
    for (const client of clients) disposeClientCrypto(client);
}

function delta(after, before, path) {
    const read = (root) => path.reduce((value, key) => value?.[key], root);
    return Number(read(after) ?? 0) - Number(read(before) ?? 0);
}

function selectPairs(cycleIndex, totalPairs, pairsPerCycle) {
    const pairs = [];
    for (let offset = 0; offset < pairsPerCycle; offset += 1) pairs.push((cycleIndex * pairsPerCycle + offset) % totalPairs);
    return pairs;
}

async function reconnectPair(pairIndex, clients, url) {
    const pair = clients.filter((client) => client.pairIndex === pairIndex);
    if (pair.length !== 2) throw new Error(`Reconnect pair ${pairIndex} is invalid.`);
    for (const client of pair) client.paused = true;
    await sleep(100);
    const startedAt = Date.now();
    await Promise.all(pair.map((client) => closeClientForReconnect(client)));
    await sleep(80);
    await Promise.all(pair.map((client) => bindClientSocket(client, url, { reconnect: true })));
    for (const client of pair) client.paused = false;
    return Date.now() - startedAt;
}

async function runParent() {
    const connections = parseEven(process.env.VOICE_MEDIA_RECONNECT_CONNECTIONS, DEFAULT_CONNECTIONS, 4, 200, "VOICE_MEDIA_RECONNECT_CONNECTIONS");
    const cycles = parsePositive(process.env.VOICE_MEDIA_RECONNECT_CYCLES, DEFAULT_CYCLES, 1, 30, "VOICE_MEDIA_RECONNECT_CYCLES");
    const pairsPerCycle = parsePositive(process.env.VOICE_MEDIA_RECONNECT_PAIRS_PER_CYCLE, DEFAULT_RECONNECT_PAIRS_PER_CYCLE, 1, connections / 2, "VOICE_MEDIA_RECONNECT_PAIRS_PER_CYCLE");
    const frameIntervalMs = parsePositive(process.env.VOICE_MEDIA_RECONNECT_FRAME_INTERVAL_MS, DEFAULT_FRAME_INTERVAL_MS, 10, 1000, "VOICE_MEDIA_RECONNECT_FRAME_INTERVAL_MS");
    const payloadBytes = parsePositive(process.env.VOICE_MEDIA_RECONNECT_PAYLOAD_BYTES, DEFAULT_PAYLOAD_BYTES, 1, 1000, "VOICE_MEDIA_RECONNECT_PAYLOAD_BYTES");
    const settleMs = parsePositive(process.env.VOICE_MEDIA_RECONNECT_SETTLE_MS, DEFAULT_SETTLE_MS, 200, 10000, "VOICE_MEDIA_RECONNECT_SETTLE_MS");
    const betweenCyclesMs = parsePositive(process.env.VOICE_MEDIA_RECONNECT_BETWEEN_CYCLES_MS, DEFAULT_BETWEEN_CYCLES_MS, 200, 10000, "VOICE_MEDIA_RECONNECT_BETWEEN_CYCLES_MS");

    const child = fork(fileURLToPath(import.meta.url), [CHILD_ARG], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const ready = await waitForChildMessage(child, (message) => message?.type === "ready", 10000);
    const url = `ws://127.0.0.1:${ready.port}/ws?transport=voice-media-v2`;
    const clients = Array.from({ length: connections }, (_, index) => createLogicalClient(index));
    console.log(`VOICE_MEDIA_RECONNECT_LOAD=START | childPid=${child.pid} | endpoint=${url} | connections=${connections} | rooms=${connections / 2} | cycles=${cycles} | pairsPerCycle=${pairsPerCycle} | frameIntervalMs=${frameIntervalMs} | packetSecurity=True | encryption=True | floodProtection=True | websocketMediaV2=True | externalNetwork=False | productionProcessesChanged=False`);

    let mediaLoopRunning = false;
    let mediaLoop = Promise.resolve();
    const payload = Buffer.alloc(payloadBytes, 0x6b);

    function startMediaLoop() {
        mediaLoopRunning = true;
        mediaLoop = (async () => {
            let nextTickAt = Date.now();
            while (mediaLoopRunning) {
                nextTickAt += frameIntervalMs;
                for (const client of clients) sendMediaFrame(client, payload);
                const waitMs = nextTickAt - Date.now();
                if (waitMs > 0) await sleep(waitMs);
                else {
                    if (waitMs < -frameIntervalMs) nextTickAt = Date.now();
                    await new Promise((resolve) => setImmediate(resolve));
                }
            }
        })();
    }

    const reconnectDurations = [];
    const cycleResults = [];
    let overallPass = true;
    let before = null;
    try {
        for (const client of clients) await bindClientSocket(client, url, { reconnect: false });
        await sleep(settleMs);
        await childRequest(child, "resetEventLoop");
        before = await childRequest(child, "stats");
        startMediaLoop();
        await sleep(500);

        for (let cycle = 0; cycle < cycles; cycle += 1) {
            const selectedPairs = selectPairs(cycle, connections / 2, pairsPerCycle);
            const startedAt = Date.now();
            const durations = [];
            for (const pairIndex of selectedPairs) durations.push(await reconnectPair(pairIndex, clients, url));
            reconnectDurations.push(...durations);
            await sleep(betweenCyclesMs);
            const stats = await childRequest(child, "stats");
            const bound = Number(stats.stats?.bound ?? -1);
            const activeContexts = Number(stats.stats?.packetSecurity?.activeContexts ?? -1);
            const cyclePass = bound === connections && activeContexts === connections;
            const cycleResult = {
                cycle: cycle + 1,
                pairs: selectedPairs.length,
                reconnectedConnections: selectedPairs.length * 2,
                cycleMs: Date.now() - startedAt,
                maxPairReconnectMs: durations.reduce((max, value) => Math.max(max, value), 0),
                bound,
                activeContexts,
                pass: cyclePass
            };
            cycleResults.push(cycleResult);
            console.log(`VOICE_MEDIA_RECONNECT_LOAD_CYCLE=${cyclePass ? "PASS" : "FAIL"} | cycle=${cycleResult.cycle} | reconnectedConnections=${cycleResult.reconnectedConnections} | cycleMs=${cycleResult.cycleMs} | maxPairReconnectMs=${cycleResult.maxPairReconnectMs} | bound=${bound} | securityContexts=${activeContexts}`);
            if (!cyclePass) {
                overallPass = false;
                break;
            }
        }

        await sleep(settleMs);
        const after = await childRequest(child, "stats");
        const sentMedia = clients.reduce((sum, client) => sum + client.sentMedia, 0);
        const receivedMedia = clients.reduce((sum, client) => sum + client.receivedMedia, 0);
        const invalidInbound = clients.reduce((sum, client) => sum + client.invalidInbound, 0);
        const sendErrors = clients.reduce((sum, client) => sum + client.sendErrors, 0);
        const reconnectSuccess = clients.reduce((sum, client) => sum + client.reconnects, 0);
        const reconnectFailures = clients.reduce((sum, client) => sum + client.reconnectFailures, 0);
        const duplicateSecurityContexts = clients.reduce((sum, client) => {
            const unique = new Set(client.securityContextHistory);
            return sum + (client.securityContextHistory.length - unique.size);
        }, 0);
        const finalBound = Number(after.stats?.bound ?? -1);
        const finalActiveContexts = Number(after.stats?.packetSecurity?.activeContexts ?? -1);
        const floodClosedDelta = delta(after.stats, before.stats, ["floodProtection", "closedFloodConnections"]);
        const floodBurstDelta = delta(after.stats, before.stats, ["floodProtection", "droppedPacketsByReason", "burst"]);
        const floodRateDelta = delta(after.stats, before.stats, ["floodProtection", "droppedPacketsByReason", "packet_rate"]);
        const securityRejectDelta = delta(after.stats, before.stats, ["packetSecurity", "rejectedProtectedPackets"]);
        const negotiatedContextDelta = delta(after.stats, before.stats, ["packetSecurity", "negotiatedContexts"]);
        const routeErrorDelta = Number(after.routes?.routeErrors ?? 0) - Number(before.routes?.routeErrors ?? 0);
        const expectedReconnects = cycleResults.reduce((sum, item) => sum + item.reconnectedConnections, 0);
        const receivePercent = sentMedia > 0 ? (receivedMedia / sentMedia) * 100 : 0;
        const avgReconnectMs = reconnectDurations.length > 0 ? reconnectDurations.reduce((sum, value) => sum + value, 0) / reconnectDurations.length : 0;
        const maxReconnectMs = reconnectDurations.reduce((max, value) => Math.max(max, value), 0);

        const finalPass = overallPass &&
            sentMedia > 0 &&
            receivePercent >= 99.0 &&
            invalidInbound === 0 &&
            sendErrors === 0 &&
            reconnectFailures === 0 &&
            reconnectSuccess === expectedReconnects &&
            duplicateSecurityContexts === 0 &&
            finalBound === connections &&
            finalActiveContexts === connections &&
            floodClosedDelta === 0 &&
            floodBurstDelta === 0 &&
            floodRateDelta === 0 &&
            securityRejectDelta === 0 &&
            routeErrorDelta === 0 &&
            negotiatedContextDelta === expectedReconnects;

        overallPass = finalPass;
        console.log(`VOICE_MEDIA_RECONNECT_LOAD=${finalPass ? "PASS" : "FAIL"} | connections=${connections} | rooms=${connections / 2} | cyclesCompleted=${cycleResults.length}/${cycles} | reconnectSuccess=${reconnectSuccess} | expectedReconnects=${expectedReconnects} | reconnectFailures=${reconnectFailures} | avgPairReconnectMs=${avgReconnectMs.toFixed(3)} | maxPairReconnectMs=${maxReconnectMs.toFixed(3)} | sent=${sentMedia} | received=${receivedMedia} | receivePercent=${receivePercent.toFixed(3)} | bound=${finalBound} | securityContexts=${finalActiveContexts} | negotiatedContextDelta=${negotiatedContextDelta} | duplicateSecurityContexts=${duplicateSecurityContexts} | floodClosedDelta=${floodClosedDelta} | floodBurstDelta=${floodBurstDelta} | floodRateDelta=${floodRateDelta} | securityRejectDelta=${securityRejectDelta} | routeErrors=${routeErrorDelta} | cpuPercent=${Number(after.telemetry?.cpuPercent ?? 0).toFixed(3)} | outboundKbps=${Number(after.telemetry?.outboundKbps ?? 0).toFixed(3)} | rssMiB=${(Number(after.process?.rssBytes ?? 0) / (1024 * 1024)).toFixed(2)} | eventLoopP95Ms=${Number(after.process?.eventLoopP95Ms ?? 0).toFixed(3)} | eventLoopP99Ms=${Number(after.process?.eventLoopP99Ms ?? 0).toFixed(3)} | eventLoopMaxMs=${Number(after.process?.eventLoopMaxMs ?? 0).toFixed(3)} | packetSecurity=True | aes256Ctr=True | hmacSha256128=True | floodProtection=True | websocketMediaV2=True | externalNetwork=False | productionProcessesChanged=False`);
    } finally {
        mediaLoopRunning = false;
        await mediaLoop.catch(() => {});
        await closeAllClients(clients);
        try { await childRequest(child, "stop", 10000); } catch { try { child.kill("SIGTERM"); } catch { } }
    }

    if (!overallPass) process.exitCode = 1;
}

if (process.argv.includes(CHILD_ARG)) {
    await runChildServer();
} else {
    await runParent().catch((error) => {
        console.error(`VOICE_MEDIA_RECONNECT_LOAD=FAIL | error=${JSON.stringify(error?.message ?? String(error))}`);
        process.exitCode = 1;
    });
}
