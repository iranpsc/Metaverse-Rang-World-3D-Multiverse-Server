import {
    VoiceAuthoritativeConnectionRegistrationAdapter
} from "../adapters/voiceAuthoritativeConnectionRegistrationAdapter.js";

import {
    VoiceMuteRegistry
} from "../mute/voiceMuteRegistry.js";

import {
    VoiceReconnectCoordinator
} from "../reconnect/voiceReconnectCoordinator.js";

import {
    VoicePacketFlowGuard
} from "../routing/voicePacketFlowGuard.js";

import {
    VoiceRoutingApplication
} from "../routing/voiceRoutingApplication.js";

import {
    VoiceTransportGateway
} from "../transport/voiceTransportGateway.js";

//* این تابع سرویس‌های Routing، Mute، کنترل جریان و Reconnect را روی رجیستری‌های مشترک V3 می‌سازد.
function createVoiceV4RuntimeServices({
    voiceRuntimeServices,
    voiceSessionRegistry,
    recordingService = null,
    capacityController = null,
    operationalMetrics = null,
    auditLogger = null,
    voiceTransportPolicy = {},
    voiceRoutingPolicy = {},
    now = () => Date.now()
} = {}) {
    if (
        !voiceRuntimeServices ||
        !voiceRuntimeServices.connectionRegistrationService ||
        !voiceRuntimeServices.voiceConnectionRegistry
    ) {
        throw new TypeError(
            "voiceRuntimeServices does not provide connection services."
        );
    }

    if (
        !voiceSessionRegistry ||
        typeof voiceSessionRegistry.listActiveByConnectionId !== "function"
    ) {
        throw new TypeError(
            "voiceSessionRegistry must provide listActiveByConnectionId."
        );
    }

    const muteRegistry =
        new VoiceMuteRegistry();

    const packetFlowGuard =
        new VoicePacketFlowGuard({
            policy: voiceRoutingPolicy,
            now
        });

    const reconnectCoordinator =
        new VoiceReconnectCoordinator({
            voiceConnectionRegistry:
                voiceRuntimeServices
                    .voiceConnectionRegistry,
            voiceSessionRegistry,
            muteRegistry,
            packetFlowGuard,
            retentionMs:
                voiceRoutingPolicy
                    .reconnectRetentionMs,
            now
        });

    const authoritativeConnectionRegistrationService =
        new VoiceAuthoritativeConnectionRegistrationAdapter({
            connectionRegistrationService:
                voiceRuntimeServices
                    .connectionRegistrationService,
            voiceConnectionRegistry:
                voiceRuntimeServices
                    .voiceConnectionRegistry,
            reconnectCoordinator,
            now
        });

    const routingApplication =
        new VoiceRoutingApplication({
            voiceConnectionRegistry:
                voiceRuntimeServices
                    .voiceConnectionRegistry,
            voiceSessionRegistry,
            muteRegistry,
            packetFlowGuard,
            reconnectCoordinator,
            recordingService,
            operationalMetrics,
            auditLogger,
            policy: voiceRoutingPolicy,
            now
        });

    const voiceTransportGateway =
        new VoiceTransportGateway({
            connectionRegistrationService:
                authoritativeConnectionRegistrationService,
            voiceConnectionRegistry:
                voiceRuntimeServices
                    .voiceConnectionRegistry,
            application:
                routingApplication,
            capacityController,
            operationalMetrics,
            policy:
                voiceTransportPolicy
        });

    //* این تابع زمان‌سنج‌های نگهداری V4 را هنگام توقف پاک می‌کند.
    function stop() {
        reconnectCoordinator.stop();
    }

    //* این تابع آمار محدود V4 را برای Health و پایش برمی‌گرداند.
    function getStats() {
        return Object.freeze({
            routing:
                routingApplication.getStats(),
            gateway:
                voiceTransportGateway.getStats(),
            authoritativeConnectionRegistration:
                authoritativeConnectionRegistrationService
                    .getStats()
        });
    }

    //* این تابع رویداد Delta قطعی را برای پیام‌های عضویت کلاینت به Router می‌دهد.
    function handleDedicatedSessionEvent(input) {
        return routingApplication
            .handleDedicatedSessionEvent(input);
    }

    return Object.freeze({
        muteRegistry,
        packetFlowGuard,
        reconnectCoordinator,
        authoritativeConnectionRegistrationService,
        routingApplication,
        voiceTransportGateway,
        handleDedicatedSessionEvent,
        stop,
        getStats
    });
}

export {
    createVoiceV4RuntimeServices
};

/*
توضیح فایل:
این فایل تمام سرویس‌های مستقل V4 را با رجیستری اتصال و Session مشترک V3 می‌سازد و یک Gateway آماده برای اتصال به WebSocket و gRPC اصلی برمی‌گرداند؛ هیچ پورت تازه‌ای باز نمی‌کند.
*/
