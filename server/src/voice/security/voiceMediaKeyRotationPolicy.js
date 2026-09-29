const DEFAULT_MAX_KEY_AGE_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PACKETS_PER_DIRECTION = 45000;

function normalizePositiveInteger(value, fieldName, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${fieldName} is invalid.`);
    return value;
}

function createVoiceMediaKeyRotationPolicy({ maxKeyAgeMs = DEFAULT_MAX_KEY_AGE_MS, maxPacketsPerDirection = DEFAULT_MAX_PACKETS_PER_DIRECTION, now = Date.now } = {}) {
    const maximumAge = normalizePositiveInteger(maxKeyAgeMs, "maxKeyAgeMs", 1000, 24 * 60 * 60 * 1000);
    const maximumPackets = normalizePositiveInteger(maxPacketsPerDirection, "maxPacketsPerDirection", 2, 0xffffffff - 1);
    if (typeof now !== "function") throw new TypeError("now is invalid.");
    let active = false;
    let contextId = 0;
    let startedAtMs = 0;
    let inboundPackets = 0;
    let outboundPackets = 0;
    let rotationRequired = false;
    let rotationReason = "";

    function begin(securityContextId) {
        const normalized = normalizePositiveInteger(securityContextId, "securityContextId", 1, 0xffffffff);
        const current = Number(now());
        if (!Number.isFinite(current) || current < 0) throw new RangeError("Current time is invalid.");
        active = true;
        contextId = normalized >>> 0;
        startedAtMs = current;
        inboundPackets = 0;
        outboundPackets = 0;
        rotationRequired = false;
        rotationReason = "";
    }

    function evaluate() {
        if (!active) return Object.freeze({ required: false, reason: "inactive" });
        if (rotationRequired) return Object.freeze({ required: true, reason: rotationReason });
        const ageMs = Math.max(0, Number(now()) - startedAtMs);
        if (ageMs >= maximumAge) {
            rotationRequired = true;
            rotationReason = "max_key_age";
        } else if (inboundPackets >= maximumPackets || outboundPackets >= maximumPackets) {
            rotationRequired = true;
            rotationReason = "max_packet_count";
        }
        return Object.freeze({ required: rotationRequired, reason: rotationReason, ageMs, inboundPackets, outboundPackets });
    }

    function recordInbound() {
        if (!active) throw new Error("Key rotation context is inactive.");
        inboundPackets += 1;
        return evaluate();
    }

    function recordOutbound() {
        if (!active) throw new Error("Key rotation context is inactive.");
        outboundPackets += 1;
        return evaluate();
    }

    function reset() {
        active = false;
        contextId = 0;
        startedAtMs = 0;
        inboundPackets = 0;
        outboundPackets = 0;
        rotationRequired = false;
        rotationReason = "";
    }

    function getStats() {
        const decision = evaluate();
        return Object.freeze({ active, contextId, maxKeyAgeMs: maximumAge, maxPacketsPerDirection: maximumPackets, startedAtMs, ageMs: decision.ageMs ?? 0, inboundPackets, outboundPackets, rotationRequired: decision.required, rotationReason: decision.reason });
    }

    return Object.freeze({ begin, evaluate, recordInbound, recordOutbound, reset, getStats });
}

export {
    DEFAULT_MAX_KEY_AGE_MS,
    DEFAULT_MAX_PACKETS_PER_DIRECTION,
    createVoiceMediaKeyRotationPolicy
};
