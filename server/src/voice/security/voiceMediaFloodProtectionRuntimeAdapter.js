import { createVoiceMediaFloodProtectionPolicy, VoiceMediaFloodDropReason } from "./voiceMediaFloodProtectionPolicy.js";

function getPacketByteLength(value) {
    if (Buffer.isBuffer(value)) return value.length;
    if (value instanceof Uint8Array) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    return 0;
}

//* این تابع محافظ ورودی Media V2 را بیرون از رمزنگاری قرار می دهد تا بسته اضافی پیش از HMAC و AES رد شود.
function createVoiceMediaFloodProtectionRuntimeAdapter({ runtime, logger = null, createPolicy = createVoiceMediaFloodProtectionPolicy } = {}) {
    if (!runtime || typeof runtime.acceptConnection !== "function" || typeof runtime.deliverMedia !== "function" || typeof runtime.closeMedia !== "function" || typeof runtime.stop !== "function" || typeof runtime.getStats !== "function") throw new TypeError("Media node runtime is invalid.");
    if (typeof createPolicy !== "function") throw new TypeError("createPolicy is invalid.");

    const states = new Map();
    const droppedPacketsByReason = new Map();
    let acceptedPackets = 0;
    let acceptedBytes = 0;
    let closedFloodConnections = 0;

    function disposeState(state) {
        if (!state || state.disposed) return false;
        state.disposed = true;
        state.policy.reset();
        states.delete(state.transportConnectionKey);
        return true;
    }

    function recordDrop(reason) {
        droppedPacketsByReason.set(reason, (droppedPacketsByReason.get(reason) ?? 0) + 1);
    }

    function acceptConnection(input = {}) {
        if (typeof input.sendPacket !== "function" || typeof input.closeTransport !== "function") throw new TypeError("Media transport callbacks are invalid.");
        const transportConnectionKey = String(input.transportConnectionKey ?? "").trim();
        if (!transportConnectionKey) throw new TypeError("transportConnectionKey is invalid.");
        if (states.has(transportConnectionKey)) throw new Error("Media flood protection connection already exists.");

        const originalCloseTransport = input.closeTransport;
        const state = { transportConnectionKey, policy: createPolicy(), disposed: false };
        states.set(transportConnectionKey, state);
        const accepted = runtime.acceptConnection({
            ...input,
            async closeTransport(reason) {
                disposeState(state);
                return await Promise.resolve(originalCloseTransport(reason));
            }
        });

        async function closeForFlood(reason) {
            if (state.disposed) return;
            closedFloodConnections += 1;
            logger?.warn?.("VME2_MEDIA_FLOOD_REJECTED", { transportConnectionKey, reason });
            await accepted.closed(`media_flood_${reason}`);
            disposeState(state);
        }

        async function receive(packet) {
            if (state.disposed) return;
            const packetBytes = getPacketByteLength(packet);
            const decision = state.policy.inspect(packetBytes);
            if (!decision.accepted) {
                recordDrop(decision.reason);
                await closeForFlood(decision.reason);
                return;
            }
            acceptedPackets += 1;
            acceptedBytes += packetBytes;
            return await accepted.receive(packet);
        }

        async function closed(reason) {
            if (state.disposed) return;
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
                activeConnections: states.size,
                acceptedPackets,
                acceptedBytes,
                closedFloodConnections,
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

export {
    VoiceMediaFloodDropReason,
    createVoiceMediaFloodProtectionRuntimeAdapter,
    getPacketByteLength
};
