import {
    VoiceRoutingApplication
} from "./voiceRoutingApplication.js";

const installationMarker = Symbol.for(
    "vme2.voice.listener.delivery.trace.v1"
);

const defaultLogIntervalMs = 5000;
const maxTrackedRoutes = 4096;

function sanitizeTraceValue(value, maxLength = 240) {
    return String(value ?? "unknown")
        .replace(/[\r\n\t|]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, maxLength);
}

function installVoiceRoutingListenerDeliveryTrace({
    now = Date.now,
    emit = (line) => console.log(line),
    logIntervalMs = defaultLogIntervalMs
} = {}) {
    if (typeof now !== "function" || typeof emit !== "function") {
        throw new TypeError("Listener trace clock and emitter must be functions.");
    }

    if (!Number.isSafeInteger(logIntervalMs) || logIntervalMs < 1) {
        throw new RangeError("Listener trace interval must be a positive integer.");
    }

    const prototype = VoiceRoutingApplication.prototype;

    if (prototype[installationMarker] === true) {
        return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        "forwardVoiceFrame"
    );

    if (
        !descriptor ||
        typeof descriptor.value !== "function" ||
        descriptor.writable !== true
    ) {
        throw new Error("Voice routing forward method is unavailable.");
    }

    const originalForwardVoiceFrame = descriptor.value;
    const routes = new Map();

    async function tracedForwardVoiceFrame(input) {
        // Snapshot before the original code can close and clear connectionId.
        const publisherConnectionId = input?.publisherConnectionId ?? "unknown";
        const listenerConnectionId = input?.listenerTransport?.connectionId ?? "unknown";
        const sessionId = input?.sessionId ?? "unknown";
        const sequence = input?.envelope?.sequence ?? "unknown";

        try {
            return await originalForwardVoiceFrame.call(this, input);
        } catch (error) {
            try {
                const timestampMs = now();
                const message = sanitizeTraceValue(
                    error?.message ?? error,
                    240
                );
                const key = [
                    publisherConnectionId,
                    listenerConnectionId,
                    sessionId,
                    message
                ].join("|");

                let route = routes.get(key);
                if (!route) {
                    if (routes.size >= maxTrackedRoutes) {
                        routes.delete(routes.keys().next().value);
                    }
                    route = { lastLoggedAtMs: -Infinity, count: 0, suppressed: 0 };
                    routes.set(key, route);
                }

                route.count += 1;
                const shouldLog =
                    route.count === 1 ||
                    timestampMs < route.lastLoggedAtMs ||
                    timestampMs - route.lastLoggedAtMs >= logIntervalMs;

                if (shouldLog) {
                    const fields = {
                        occurredAtUtc: new Date(timestampMs).toISOString(),
                        connectionId: publisherConnectionId,
                        listenerConnectionId,
                        sessionId,
                        sequence,
                        reason: "listener_backpressure",
                        error: message,
                        failureCount: route.count,
                        suppressedSincePreviousLog: route.suppressed
                    };
                    const details = Object.entries(fields)
                        .map(([name, value]) =>
                            `${name}=${sanitizeTraceValue(value)}`
                        )
                        .join(" | ");
                    emit(`[G4_VOICE_TRACE] VOICE_FRAME_LISTENER_DELIVERY_FAILED | ${details}`);
                    route.lastLoggedAtMs = timestampMs;
                    route.suppressed = 0;
                } else {
                    route.suppressed += 1;
                }
            } catch {
                // A failed diagnostic must never replace the original error.
            }

            throw error;
        }
    }

    Object.defineProperty(prototype, "forwardVoiceFrame", {
        ...descriptor,
        value: tracedForwardVoiceFrame
    });

    Object.defineProperty(prototype, installationMarker, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true
    });

    return true;
}

export { installVoiceRoutingListenerDeliveryTrace };
