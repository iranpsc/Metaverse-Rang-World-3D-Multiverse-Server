import {
    createVoiceMediaFloodProtectionPolicy,
    VoiceMediaFloodDropReason
} from "./voiceMediaFloodProtectionPolicy.js";
import { getPacketByteLength } from "./voiceMediaFloodProtectionRuntimeAdapter.js";

// Retains the existing packet and byte limits while dropping isolated bursts.
function createVoiceMediaBurstSafeRuntimeAdapter({
    runtime,
    logger = null,
    createPolicy = createVoiceMediaFloodProtectionPolicy,
    now = () => performance.now()
} = {}) {
    if (!runtime || typeof runtime.acceptConnection !== "function" || typeof runtime.deliverMedia !== "function" || typeof runtime.closeMedia !== "function" || typeof runtime.stop !== "function" || typeof runtime.getStats !== "function") {
        throw new TypeError("Media node runtime is invalid.");
    }
    if (typeof createPolicy !== "function" || typeof now !== "function") {
        throw new TypeError("Media flood protection dependencies are invalid.");
    }

    const states = new Map();
    const droppedPacketsByReason = new Map();
    let acceptedPackets = 0;
    let acceptedBytes = 0;
    let closedFloodConnections = 0;
    let burstPacketsDroppedWithoutClosing = 0;

    function recordDrop(reason) {
        droppedPacketsByReason.set(reason, (droppedPacketsByReason.get(reason) ?? 0) + 1);
    }

    function disposeState(state) {
        if (state.disposed) return;
        state.disposed = true;
        state.policy.reset();
        states.delete(state.transportConnectionKey);
    }

    function acceptConnection(input = {}) {
        if (typeof input.sendPacket !== "function" || typeof input.closeTransport !== "function") {
            throw new TypeError("Media transport callbacks are invalid.");
        }
        const transportConnectionKey = String(input.transportConnectionKey ?? "").trim();
        if (!transportConnectionKey || states.has(transportConnectionKey)) {
            throw new Error("Media flood protection connection key is invalid or already exists.");
        }

        const policy = createPolicy({ now });
        if (!policy || typeof policy.inspect !== "function" || typeof policy.reset !== "function" || typeof policy.getStats !== "function") {
            throw new TypeError("Media flood protection policy is invalid.");
        }
        const limits = policy.getStats();
        if (!Number.isSafeInteger(limits.maxPacketsPerSecond) || limits.maxPacketsPerSecond <= 0 || !Number.isSafeInteger(limits.maxBytesPerSecond) || limits.maxBytesPerSecond <= 0) {
            throw new TypeError("Media flood protection limits are invalid.");
        }

        const state = {
            transportConnectionKey,
            policy,
            limits,
            disposed: false,
            closing: false,
            rawWindowStartedAtMs: null,
            rawPacketsInWindow: 0,
            rawBytesInWindow: 0,
            lastObservedAtMs: null,
            lastBurstLogAtMs: null
        };
        const closeTransport = input.closeTransport;
        const accepted = runtime.acceptConnection({
            ...input,
            async closeTransport(reason) {
                disposeState(state);
                return await Promise.resolve(closeTransport(reason));
            }
        });
        states.set(transportConnectionKey, state);

        async function closeForViolation(reason) {
            if (state.disposed || state.closing) return;
            state.closing = true;
            closedFloodConnections += 1;
            logger?.warn?.("VME2_MEDIA_FLOOD_REJECTED", {
                at: new Date().toISOString(), transportConnectionKey, reason
            });
            try {
                await accepted.closed(`media_flood_${reason}`);
            } finally {
                disposeState(state);
            }
        }

        async function receive(packet) {
            if (state.disposed || state.closing) return;
            const packetBytes = getPacketByteLength(packet);
            const currentTime = Number(now());
            if (!Number.isFinite(currentTime) || currentTime < 0 || (state.lastObservedAtMs !== null && currentTime < state.lastObservedAtMs)) {
                await closeForViolation("invalid_clock");
                return;
            }
            state.lastObservedAtMs = currentTime;
            if (state.rawWindowStartedAtMs === null || currentTime - state.rawWindowStartedAtMs >= 1000) {
                state.rawWindowStartedAtMs = currentTime;
                state.rawPacketsInWindow = 0;
                state.rawBytesInWindow = 0;
            }

            // Count all raw attempts, including packets discarded by the burst guard.
            state.rawPacketsInWindow += 1;
            state.rawBytesInWindow += packetBytes;
            if (state.rawPacketsInWindow > limits.maxPacketsPerSecond) {
                recordDrop(VoiceMediaFloodDropReason.PACKET_RATE);
                await closeForViolation(VoiceMediaFloodDropReason.PACKET_RATE);
                return;
            }
            if (state.rawBytesInWindow > limits.maxBytesPerSecond) {
                recordDrop(VoiceMediaFloodDropReason.BYTE_RATE);
                await closeForViolation(VoiceMediaFloodDropReason.BYTE_RATE);
                return;
            }

            const decision = state.policy.inspect(packetBytes);
            if (!decision.accepted) {
                recordDrop(decision.reason);
                if (decision.reason === VoiceMediaFloodDropReason.BURST) {
                    burstPacketsDroppedWithoutClosing += 1;
                    if (state.lastBurstLogAtMs === null || currentTime - state.lastBurstLogAtMs >= 1000) {
                        state.lastBurstLogAtMs = currentTime;
                        logger?.warn?.("VME2_MEDIA_BURST_SAFE_DROP", {
                            at: new Date().toISOString(), transportConnectionKey, reason: decision.reason
                        });
                    }
                    return;
                }
                await closeForViolation(decision.reason);
                return;
            }

            acceptedPackets += 1;
            acceptedBytes += packetBytes;
            return await accepted.receive(packet);
        }

        async function closed(reason) {
            if (state.disposed || state.closing) return;
            state.closing = true;
            try {
                return await accepted.closed(reason);
            } finally {
                disposeState(state);
            }
        }

        return Object.freeze({ connection: accepted.connection, receive, closed });
    }

    async function stop() {
        for (const state of Array.from(states.values())) disposeState(state);
        return await runtime.stop();
    }

    function getStats() {
        return Object.freeze({
            ...runtime.getStats(),
            floodProtection: Object.freeze({
                enabled: true,
                burstSafe: true,
                activeConnections: states.size,
                acceptedPackets,
                acceptedBytes,
                closedFloodConnections,
                burstPacketsDroppedWithoutClosing,
                droppedPacketsByReason: Object.freeze(Object.fromEntries(droppedPacketsByReason))
            })
        });
    }

    return Object.freeze({
        mediaRegistry: runtime.mediaRegistry,
        acceptConnection,
        deliverMedia: runtime.deliverMedia,
        closeMedia: runtime.closeMedia,
        stop,
        getStats,
        sampleTelemetry: typeof runtime.sampleTelemetry === "function" ? runtime.sampleTelemetry : undefined
    });
}

export { createVoiceMediaBurstSafeRuntimeAdapter };
