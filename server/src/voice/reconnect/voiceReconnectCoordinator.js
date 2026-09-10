import {
    VoiceConnectionCloseReason
} from "../core/voiceConnectionConstants.js";

import {
    VoiceSessionReason
} from "../session/voiceSessionConstants.js";

import {
    VoiceReconnectPolicy
} from "./voiceReconnectPolicy.js";

class VoiceReconnectCoordinator {
    //* این سازنده نگهداری اتصال معلق و زمان‌سنج پایان بازیابی را آماده می‌کند.
    constructor({
        voiceConnectionRegistry,
        voiceSessionRegistry,
        muteRegistry,
        packetFlowGuard,
        retentionMs = VoiceReconnectPolicy.serverRetentionMs,
        now = () => Date.now(),
        schedule = setTimeout,
        cancelSchedule = clearTimeout
    } = {}) {
        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry.suspendConnection !== "function" ||
            typeof voiceConnectionRegistry.removeConnection !== "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry does not provide reconnect lifecycle methods."
            );
        }

        if (
            !voiceSessionRegistry ||
            typeof voiceSessionRegistry.closeByConnectionId !== "function"
        ) {
            throw new TypeError(
                "voiceSessionRegistry must provide closeByConnectionId."
            );
        }

        if (
            !muteRegistry ||
            typeof muteRegistry.removeConnection !== "function"
        ) {
            throw new TypeError("muteRegistry must provide removeConnection.");
        }

        if (
            !packetFlowGuard ||
            typeof packetFlowGuard.removeConnection !== "function"
        ) {
            throw new TypeError(
                "packetFlowGuard must provide removeConnection."
            );
        }

        if (
            !Number.isSafeInteger(retentionMs) ||
            retentionMs <= 0
        ) {
            throw new RangeError("retentionMs must be positive.");
        }

        if (
            typeof now !== "function" ||
            typeof schedule !== "function" ||
            typeof cancelSchedule !== "function"
        ) {
            throw new TypeError(
                "Reconnect coordinator clock and scheduling functions are required."
            );
        }

        this.voiceConnectionRegistry = voiceConnectionRegistry;
        this.voiceSessionRegistry = voiceSessionRegistry;
        this.muteRegistry = muteRegistry;
        this.packetFlowGuard = packetFlowGuard;
        this.retentionMs = retentionMs;
        this.now = now;
        this.schedule = schedule;
        this.cancelSchedule = cancelSchedule;
        this.expiryTimersByConnectionId = new Map();
        this.suspendedConnections = 0;
        this.resumedConnections = 0;
        this.expiredConnections = 0;
    }

    //* این تابع قطع موقت راه انتقال را به تعلیق اتصال و زمان‌سنج نگهداری تبدیل می‌کند.
    handleTransportClosed({
        connectionId,
        registryReason,
        closedAtMs = this.now()
    } = {}) {
        const normalizedConnectionId = String(
            connectionId ?? ""
        ).trim().toLowerCase();

        if (!normalizedConnectionId) {
            return Object.freeze({ handled: true, action: "none" });
        }

        if (
            registryReason === VoiceConnectionCloseReason.CLIENT_DISCONNECTED ||
            registryReason === VoiceConnectionCloseReason.ACCESS_REVOKED ||
            registryReason === VoiceConnectionCloseReason.SERVER_SHUTDOWN ||
            registryReason === VoiceConnectionCloseReason.ROOM_LEFT
        ) {
            this.closeConnectionImmediately(
                normalizedConnectionId,
                registryReason,
                closedAtMs
            );

            return Object.freeze({
                handled: true,
                action: "closed"
            });
        }

        const snapshot = this.voiceConnectionRegistry.suspendConnection(
            normalizedConnectionId,
            closedAtMs
        );

        if (!snapshot) {
            return Object.freeze({ handled: true, action: "missing" });
        }

        this.cancelRetention(normalizedConnectionId);

        const timer = this.schedule(
            () => {
                this.expireConnection(normalizedConnectionId);
            },
            this.retentionMs
        );

        timer?.unref?.();
        this.expiryTimersByConnectionId.set(
            normalizedConnectionId,
            timer
        );
        this.suspendedConnections += 1;

        return Object.freeze({
            handled: true,
            action: "suspended",
            connection: snapshot
        });
    }

    //* این تابع پس از احراز دوباره اتصال، زمان‌سنج نگهداری قبلی را لغو می‌کند.
    handleConnectionAuthenticated(connectionId, resumed) {
        const normalizedConnectionId = String(
            connectionId ?? ""
        ).trim().toLowerCase();

        if (!normalizedConnectionId) return false;

        const cancelled = this.cancelRetention(normalizedConnectionId);

        if (resumed === true) {
            this.resumedConnections += 1;
        }

        return cancelled;
    }

    //* این تابع اتصال منقضی‌شده را همراه تمام سشن‌های فعال و وضعیت‌های جانبی پاک می‌کند.
    expireConnection(connectionId) {
        const normalizedConnectionId = String(
            connectionId ?? ""
        ).trim().toLowerCase();

        this.expiryTimersByConnectionId.delete(normalizedConnectionId);

        const connection = this.voiceConnectionRegistry.getByConnectionId(
            normalizedConnectionId
        );

        if (!connection) return false;

        this.voiceSessionRegistry.closeByConnectionId(
            normalizedConnectionId,
            {
                reason: VoiceSessionReason.RECONNECT_EXPIRED,
                effectiveAtMs: this.now()
            }
        );

        this.voiceConnectionRegistry.removeConnection(
            normalizedConnectionId,
            {
                reason: VoiceConnectionCloseReason.RECONNECT_EXPIRED,
                closedAtMs: this.now()
            }
        );

        this.muteRegistry.removeConnection(normalizedConnectionId);
        this.packetFlowGuard.removeConnection(normalizedConnectionId);
        this.expiredConnections += 1;
        return true;
    }

    //* این تابع خروج قطعی را بدون نگهداری بازیابی روی اتصال و سشن‌ها اعمال می‌کند.
    closeConnectionImmediately(connectionId, registryReason, closedAtMs) {
        this.cancelRetention(connectionId);

        const sessionReason =
            registryReason === VoiceConnectionCloseReason.ACCESS_REVOKED
                ? VoiceSessionReason.ACCESS_REVOKED
                : registryReason === VoiceConnectionCloseReason.ROOM_LEFT
                    ? VoiceSessionReason.ROOM_LEFT
                    : registryReason === VoiceConnectionCloseReason.DEDICATED_DISCONNECTED
                        ? VoiceSessionReason.DEDICATED_DISCONNECTED
                    : VoiceSessionReason.VOICE_DISCONNECTED;

        this.voiceSessionRegistry.closeByConnectionId(
            connectionId,
            {
                reason: sessionReason,
                effectiveAtMs: closedAtMs
            }
        );

        this.voiceConnectionRegistry.removeConnection(
            connectionId,
            {
                reason: registryReason,
                closedAtMs
            }
        );

        this.muteRegistry.removeConnection(connectionId);
        this.packetFlowGuard.removeConnection(connectionId);
    }

    //* این تابع زمان‌سنج نگهداری یک اتصال را در صورت وجود لغو می‌کند.
    cancelRetention(connectionId) {
        const timer = this.expiryTimersByConnectionId.get(connectionId);
        if (!timer) return false;

        this.cancelSchedule(timer);
        this.expiryTimersByConnectionId.delete(connectionId);
        return true;
    }

    //* این تابع تمام زمان‌سنج‌ها را هنگام خاموش‌شدن سرویس پاک می‌کند.
    stop() {
        for (const timer of this.expiryTimersByConnectionId.values()) {
            this.cancelSchedule(timer);
        }

        this.expiryTimersByConnectionId.clear();
    }

    //* این تابع آمار تعلیق، بازیابی و انقضا را برمی‌گرداند.
    getStats() {
        return Object.freeze({
            retainedConnections: this.expiryTimersByConnectionId.size,
            suspendedConnections: this.suspendedConnections,
            resumedConnections: this.resumedConnections,
            expiredConnections: this.expiredConnections,
            retentionMs: this.retentionMs
        });
    }
}

export {
    VoiceReconnectCoordinator
};

/*
توضیح فایل:
این فایل قطع موقت راه انتقال را تا مهلت نگهداری سرور به تعلیق تبدیل می‌کند، بازیابی را بدون ساخت سشن تکراری ادامه می‌دهد و پس از پایان مهلت اتصال، سشن‌ها، قطع صدا و محدودکننده نرخ را کامل پاک می‌کند.
*/
