const VoiceMediaFloodDropReason = Object.freeze({
    INVALID_PACKET: "invalid_packet",
    PACKET_TOO_LARGE: "packet_too_large",
    PACKET_RATE: "packet_rate",
    BYTE_RATE: "byte_rate",
    BURST: "burst"
});

const VoiceMediaFloodProtectionDefaultPolicy = Object.freeze({
    maximumPacketBytes: 1200,
    maxPacketsPerSecond: 100,
    maxBytesPerSecond: 128 * 1024,
    burstWindowMs: 100,
    maxBurstPackets: 25
});

function normalizePositiveInteger(value, fieldName, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new RangeError(`${fieldName} is invalid.`);
    return value;
}

//* این تابع سیاست مستقل محافظت ورودی Media V2 را با محدودیت های قفل شده مسیر صوت می سازد.
function createVoiceMediaFloodProtectionPolicy({
    maximumPacketBytes = VoiceMediaFloodProtectionDefaultPolicy.maximumPacketBytes,
    maxPacketsPerSecond = VoiceMediaFloodProtectionDefaultPolicy.maxPacketsPerSecond,
    maxBytesPerSecond = VoiceMediaFloodProtectionDefaultPolicy.maxBytesPerSecond,
    burstWindowMs = VoiceMediaFloodProtectionDefaultPolicy.burstWindowMs,
    maxBurstPackets = VoiceMediaFloodProtectionDefaultPolicy.maxBurstPackets,
    now = () => performance.now()
} = {}) {
    const limits = Object.freeze({
        maximumPacketBytes: normalizePositiveInteger(maximumPacketBytes, "maximumPacketBytes", 65535),
        maxPacketsPerSecond: normalizePositiveInteger(maxPacketsPerSecond, "maxPacketsPerSecond", 1000000),
        maxBytesPerSecond: normalizePositiveInteger(maxBytesPerSecond, "maxBytesPerSecond"),
        burstWindowMs: normalizePositiveInteger(burstWindowMs, "burstWindowMs", 1000),
        maxBurstPackets: normalizePositiveInteger(maxBurstPackets, "maxBurstPackets", 1000000)
    });
    if (limits.maxBurstPackets > limits.maxPacketsPerSecond) throw new RangeError("maxBurstPackets cannot exceed maxPacketsPerSecond.");
    if (typeof now !== "function") throw new TypeError("now is invalid.");

    let windowStartedAtMs = null;
    let windowPackets = 0;
    let windowBytes = 0;
    let burstWindowStartedAtMs = null;
    let burstPackets = 0;
    let lastObservedAtMs = null;

    function reject(reason) {
        return Object.freeze({ accepted: false, reason });
    }

    //* این تابع تنها با ساعت یکنواخت سرور اندازه، نرخ یک ثانیه ای و Burst بسته خام را بررسی می کند.
    function inspect(packetBytes) {
        if (!Number.isSafeInteger(packetBytes) || packetBytes <= 0) return reject(VoiceMediaFloodDropReason.INVALID_PACKET);
        if (packetBytes > limits.maximumPacketBytes) return reject(VoiceMediaFloodDropReason.PACKET_TOO_LARGE);

        const currentTime = Number(now());
        if (!Number.isFinite(currentTime) || currentTime < 0) throw new RangeError("Flood protection clock is invalid.");
        if (lastObservedAtMs !== null && currentTime < lastObservedAtMs) throw new RangeError("Flood protection clock moved backwards.");
        lastObservedAtMs = currentTime;

        if (windowStartedAtMs === null || currentTime - windowStartedAtMs >= 1000) {
            windowStartedAtMs = currentTime;
            windowPackets = 0;
            windowBytes = 0;
        }
        if (burstWindowStartedAtMs === null || currentTime - burstWindowStartedAtMs >= limits.burstWindowMs) {
            burstWindowStartedAtMs = currentTime;
            burstPackets = 0;
        }
        if (windowPackets + 1 > limits.maxPacketsPerSecond) return reject(VoiceMediaFloodDropReason.PACKET_RATE);
        if (windowBytes + packetBytes > limits.maxBytesPerSecond) return reject(VoiceMediaFloodDropReason.BYTE_RATE);
        if (burstPackets + 1 > limits.maxBurstPackets) return reject(VoiceMediaFloodDropReason.BURST);

        windowPackets += 1;
        windowBytes += packetBytes;
        burstPackets += 1;
        return Object.freeze({ accepted: true, reason: "" });
    }

    function reset() {
        windowStartedAtMs = null;
        windowPackets = 0;
        windowBytes = 0;
        burstWindowStartedAtMs = null;
        burstPackets = 0;
        lastObservedAtMs = null;
    }

    function getStats() {
        return Object.freeze({ ...limits, windowPackets, windowBytes, burstPackets });
    }

    return Object.freeze({ inspect, reset, getStats });
}

export {
    VoiceMediaFloodDropReason,
    VoiceMediaFloodProtectionDefaultPolicy,
    createVoiceMediaFloodProtectionPolicy
};
