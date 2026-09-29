import {
    VoiceRoutingDropReason,
    createVoiceRoutingPolicy
} from "./voiceRoutingConstants.js";

class VoicePacketFlowGuard {
    //* این سازنده شمارنده های محدود نرخ و ترتیب هر فرستنده را آماده می کند.
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

        // برای سازگاری با قرارداد آماری موجود نگه داشته می شود.
        // Timestamp کلاینت دیگر برای تصمیم گیری یا Normalize استفاده نمی شود.
        this.normalizedPacketsByReason = new Map();
    }

    //* این تابع فریم را فقط با وضعیت و ساعت خود سرور از نظر ترتیب، اندازه، نرخ و Burst بررسی می کند.
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

        /*
        قانون قطعی:
        timestampMs از کلاینت غیرقابل اعتماد است و هیچ نقشی در
        Freshness / Expire / Clock Skew / Accept / Drop ندارد.

        تازگی مسیر زنده فقط بر اساس وضعیت دریافت شده توسط خود سرور،
        Sequence و پنجره های زمانی ساخته شده با ساعت خود سرور کنترل می شود.
        */
        void timestampMs;

        const nowMs = this.now();

        if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
            throw new RangeError("Voice routing clock is invalid.");
        }

        let state =
            this.statesByConnectionId.get(
                normalizedConnectionId
            );

        if (!state) {
            state = {
                lastAcceptedSequence: 0,
                windowStartedAtMs: nowMs,
                windowPackets: 0,
                windowBytes: 0,
                burstWindowStartedAtMs: nowMs,
                burstPackets: 0
            };

            this.statesByConnectionId.set(
                normalizedConnectionId,
                state
            );
        }

        if (
            sequence ===
            state.lastAcceptedSequence
        ) {
            return this.createDrop(
                VoiceRoutingDropReason.DUPLICATE
            );
        }

        if (
            sequence <
            state.lastAcceptedSequence
        ) {
            return this.createDrop(
                VoiceRoutingDropReason.LATE
            );
        }

        if (
            nowMs -
                state.windowStartedAtMs >=
            1000
        ) {
            state.windowStartedAtMs = nowMs;
            state.windowPackets = 0;
            state.windowBytes = 0;
        }

        if (
            nowMs -
                state.burstWindowStartedAtMs >=
            100
        ) {
            state.burstWindowStartedAtMs =
                nowMs;
            state.burstPackets = 0;
        }

        if (
            state.windowPackets + 1 >
            this.policy.maxPacketsPerSecond
        ) {
            return this.createDrop(
                VoiceRoutingDropReason.PACKET_RATE
            );
        }

        if (
            state.windowBytes + payloadBytes >
            this.policy.maxBytesPerSecond
        ) {
            return this.createDrop(
                VoiceRoutingDropReason.BYTE_RATE
            );
        }

        if (
            (
                state.windowBytes +
                payloadBytes
            ) * 8 >
            this.policy.maxBitsPerSecond
        ) {
            return this.createDrop(
                VoiceRoutingDropReason.BITRATE
            );
        }

        if (
            state.burstPackets + 1 >
            this.policy.maxBurstPackets
        ) {
            return this.createDrop(
                VoiceRoutingDropReason.BURST
            );
        }

        state.lastAcceptedSequence =
            sequence;
        state.windowPackets += 1;
        state.windowBytes += payloadBytes;
        state.burstPackets += 1;

        this.acceptedPackets += 1;
        this.acceptedBytes +=
            payloadBytes;

        return Object.freeze({
            accepted: true,
            dropReason: ""
        });
    }

    //* این تابع برای سازگاری API قبلی باقی مانده است ولی در مسیر Server-authoritative استفاده نمی شود.
    recordTimestampNormalization(reason) {
        this.normalizedPacketsByReason.set(
            reason,
            (
                this.normalizedPacketsByReason
                    .get(reason) ?? 0
            ) + 1
        );
    }

    //* این تابع وضعیت یک فرستنده حذف شده را از محدودکننده نرخ پاک می کند.
    removeConnection(connectionId) {
        return this.statesByConnectionId.delete(
            String(connectionId ?? "")
                .trim()
                .toLowerCase()
        );
    }

    //* این تابع یک نتیجه رد را ثبت و به صورت قفل شده برمی گرداند.
    createDrop(reason) {
        this.droppedPacketsByReason.set(
            reason,
            (
                this.droppedPacketsByReason
                    .get(reason) ?? 0
            ) + 1
        );

        return Object.freeze({
            accepted: false,
            dropReason: reason
        });
    }

    //* این تابع آمار بسته های پذیرفته و رد شده را بدون داده صوتی برمی گرداند.
    getStats() {
        return Object.freeze({
            trackedPublishers:
                this.statesByConnectionId.size,
            acceptedPackets:
                this.acceptedPackets,
            acceptedBytes:
                this.acceptedBytes,
            droppedPacketsByReason:
                Object.freeze(
                    Object.fromEntries(
                        this.droppedPacketsByReason
                    )
                ),
            normalizedPacketsByReason:
                Object.freeze(
                    Object.fromEntries(
                        this.normalizedPacketsByReason
                    )
                )
        });
    }
}

export {
    VoicePacketFlowGuard
};

/*
توضیح فایل:
این فایل مسیر زنده Voice را فقط با ساعت و وضعیت خود سرور کنترل می کند.
Timestamp ارسال شده توسط Client برای Freshness، Expire یا Clock Skew معتبر نیست
و در تصمیم Accept/Drop استفاده نمی شود. ترتیب Sequence، Duplicate، Late،
اندازه Frame، Packet Rate، Byte Rate، Bitrate و Burst همچنان توسط Server
کنترل می شوند.
*/
