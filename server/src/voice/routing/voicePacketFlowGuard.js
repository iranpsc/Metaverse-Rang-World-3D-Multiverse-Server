import {
    VoiceRoutingDropReason,
    createVoiceRoutingPolicy
} from "./voiceRoutingConstants.js";

class VoicePacketFlowGuard {
    //* این سازنده شمارنده‌های محدود نرخ و ترتیب هر فرستنده را آماده می‌کند.
    constructor({
        policy = {},
        now = () => Date.now()
    } = {}) {
        if (typeof now !== "function") {
            throw new TypeError("now must be a function.");
        }

        this.policy = createVoiceRoutingPolicy(policy);
        this.now = now;
        this.statesByConnectionId = new Map();
        this.acceptedPackets = 0;
        this.acceptedBytes = 0;
        this.droppedPacketsByReason = new Map();
        this.normalizedPacketsByReason = new Map();
    }

    //* این تابع ترتیب، زمان، اندازه، جهش و نرخ یک فریم را پیش از مسیر‌دهی بررسی می‌کند.
    inspect({
        connectionId,
        sequence,
        timestampMs,
        payloadBytes
    } = {}) {
        const normalizedConnectionId = String(
            connectionId ?? ""
        ).trim().toLowerCase();

        if (!normalizedConnectionId) {
            throw new TypeError("connectionId is required.");
        }

        if (
            !Number.isSafeInteger(sequence) ||
            sequence <= 0 ||
            sequence > 0xffffffff
        ) {
            throw new RangeError("Voice frame sequence is invalid.");
        }

        if (
            !Number.isSafeInteger(payloadBytes) ||
            payloadBytes <= 0 ||
            payloadBytes > this.policy.maxOpusFrameBytes
        ) {
            throw new RangeError("Voice frame payload size is invalid.");
        }

        const packetTimestamp =
            typeof timestampMs === "bigint"
                ? timestampMs
                : BigInt(timestampMs);

        const nowMs = this.now();

        if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
            throw new RangeError("Voice routing clock is invalid.");
        }

        const nowValue = BigInt(nowMs);
        const oldestAllowed = nowValue -
            BigInt(this.policy.maxPacketAgeMs);
        const newestAllowed = nowValue +
            BigInt(this.policy.maxFutureClockSkewMs);

        if (packetTimestamp < 0n || packetTimestamp < oldestAllowed) {
            return this.createDrop(VoiceRoutingDropReason.EXPIRED);
        }

        if (packetTimestamp > newestAllowed) {
            this.recordTimestampNormalization(
                VoiceRoutingDropReason.FUTURE_TIMESTAMP
            );
        }

        let state = this.statesByConnectionId.get(normalizedConnectionId);

        if (!state) {
            state = {
                lastAcceptedSequence: 0,
                windowStartedAtMs: nowMs,
                windowPackets: 0,
                windowBytes: 0,
                burstWindowStartedAtMs: nowMs,
                burstPackets: 0
            };

            this.statesByConnectionId.set(normalizedConnectionId, state);
        }

        if (sequence === state.lastAcceptedSequence) {
            return this.createDrop(VoiceRoutingDropReason.DUPLICATE);
        }

        if (sequence < state.lastAcceptedSequence) {
            return this.createDrop(VoiceRoutingDropReason.LATE);
        }

        if (nowMs - state.windowStartedAtMs >= 1000) {
            state.windowStartedAtMs = nowMs;
            state.windowPackets = 0;
            state.windowBytes = 0;
        }

        if (nowMs - state.burstWindowStartedAtMs >= 100) {
            state.burstWindowStartedAtMs = nowMs;
            state.burstPackets = 0;
        }

        if (
            state.windowPackets + 1 >
            this.policy.maxPacketsPerSecond
        ) {
            return this.createDrop(VoiceRoutingDropReason.PACKET_RATE);
        }

        if (
            state.windowBytes + payloadBytes >
            this.policy.maxBytesPerSecond
        ) {
            return this.createDrop(VoiceRoutingDropReason.BYTE_RATE);
        }

        if (
            (state.windowBytes + payloadBytes) * 8 >
            this.policy.maxBitsPerSecond
        ) {
            return this.createDrop(VoiceRoutingDropReason.BITRATE);
        }

        if (
            state.burstPackets + 1 >
            this.policy.maxBurstPackets
        ) {
            return this.createDrop(VoiceRoutingDropReason.BURST);
        }

        state.lastAcceptedSequence = sequence;
        state.windowPackets += 1;
        state.windowBytes += payloadBytes;
        state.burstPackets += 1;
        this.acceptedPackets += 1;
        this.acceptedBytes += payloadBytes;

        return Object.freeze({
            accepted: true,
            dropReason: ""
        });
    }

    //* این تابع یک Timestamp ناسازگار با ساعت سرور را بدون قطع مسیر زنده ثبت می‌کند.
    recordTimestampNormalization(reason) {
        this.normalizedPacketsByReason.set(
            reason,
            (this.normalizedPacketsByReason.get(reason) ?? 0) + 1
        );
    }

    //* این تابع وضعیت یک فرستنده حذف‌شده را از محدودکننده نرخ پاک می‌کند.
    removeConnection(connectionId) {
        return this.statesByConnectionId.delete(
            String(connectionId ?? "")
                .trim()
                .toLowerCase()
        );
    }

    //* این تابع یک نتیجه رد را ثبت و به‌صورت قفل‌شده برمی‌گرداند.
    createDrop(reason) {
        this.droppedPacketsByReason.set(
            reason,
            (this.droppedPacketsByReason.get(reason) ?? 0) + 1
        );

        return Object.freeze({
            accepted: false,
            dropReason: reason
        });
    }

    //* این تابع آمار بسته‌های پذیرفته و ردشده را بدون داده صوتی برمی‌گرداند.
    getStats() {
        return Object.freeze({
            trackedPublishers: this.statesByConnectionId.size,
            acceptedPackets: this.acceptedPackets,
            acceptedBytes: this.acceptedBytes,
            droppedPacketsByReason: Object.freeze(
                Object.fromEntries(this.droppedPacketsByReason)
            ),
            normalizedPacketsByReason: Object.freeze(
                Object.fromEntries(this.normalizedPacketsByReason)
            )
        });
    }
}

export {
    VoicePacketFlowGuard
};

/*
توضیح فایل:
این فایل فریم زنده را پیش از توزیع از نظر ترتیب، تکرار، دیررس‌بودن، انقضا، اختلاف ساعت، اندازه، نرخ بسته، نرخ بایت، بیت‌ریت و جهش لحظه‌ای کنترل می‌کند. Timestamp آینده برای مسیر زنده فقط ثبت و نرمال‌سازی می‌شود تا اختلاف ساعت کلاینت و سرور مسیر صوت را قطع نکند. هیچ داده صوتی در آمار نگه داشته نمی‌شود.
*/
