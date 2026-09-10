// مسیر فایل: src/voice/bootstrap/voiceTransportRuntimeWrapper.js

import {
    EventEmitter
} from "node:events";

import {
    VoiceTransportGateway,
    attachVoiceWebSocketTransport,
    registerVoiceGrpcTransport
} from "../transport/index.js";

const VOICE_WEBSOCKET_QUERY_KEY =
    "transport";

const VOICE_WEBSOCKET_QUERY_VALUE =
    "voice";

//* این تابع درخواست وب‌سوکت را بررسی می‌کند و فقط نشانگر صریح راه انتقال صوت را می‌پذیرد.
function isVoiceWebSocketRequest(
    request
) {
    const parsedUrl =
        new URL(
            String(
                request?.url ??
                "/"
            ),
            "http://127.0.0.1"
        );

    return parsedUrl
        .searchParams
        .get(
            VOICE_WEBSOCKET_QUERY_KEY
        ) ===
        VOICE_WEBSOCKET_QUERY_VALUE;
}

//* این تابع سرویس‌های هسته صوت را همراه راه‌های انتقال وب‌سوکت و جی‌آرپی داخل یک پوشاننده مستقل قرار می‌دهد.
function createVoiceTransportRuntimeWrapper({
    voiceRuntimeServices,
    websocketRealtimeRuntime,
    voiceTransportPolicy = {},
    gateway = null,
    logger = null
} = {}) {
    if (
        !voiceRuntimeServices ||
        typeof voiceRuntimeServices !==
            "object" ||
        !voiceRuntimeServices
            .connectionRegistrationService ||
        !voiceRuntimeServices
            .voiceConnectionRegistry
    ) {
        throw new TypeError(
            "voiceRuntimeServices does not provide the required Voice services."
        );
    }

    if (
        !websocketRealtimeRuntime ||
        typeof websocketRealtimeRuntime !==
            "object" ||
        !websocketRealtimeRuntime.transport ||
        !websocketRealtimeRuntime
            .transport
            .wss
    ) {
        throw new TypeError(
            "websocketRealtimeRuntime must provide a started transport."
        );
    }

    if (
        !voiceTransportPolicy ||
        typeof voiceTransportPolicy !==
            "object" ||
        Array.isArray(
            voiceTransportPolicy
        )
    ) {
        throw new TypeError(
            "voiceTransportPolicy must be an object."
        );
    }

    const realtimeTransport =
        websocketRealtimeRuntime
            .transport;

    const webSocketServer =
        realtimeTransport.wss;

    if (
        typeof webSocketServer
            .listeners !==
            "function" ||
        typeof webSocketServer.off !==
            "function" ||
        typeof webSocketServer.on !==
            "function"
    ) {
        throw new TypeError(
            "Realtime WebSocket server does not provide the required listener interface."
        );
    }

    const connectionListeners =
        webSocketServer.listeners(
            "connection"
        );

    if (
        connectionListeners.length !==
        1
    ) {
        throw new Error(
            `Expected exactly one Realtime WebSocket connection listener, received ${connectionListeners.length}.`
        );
    }

    const realtimeConnectionListener =
        connectionListeners[0];

    const resolvedGateway =
        gateway ??
        new VoiceTransportGateway({
            connectionRegistrationService:
                voiceRuntimeServices
                    .connectionRegistrationService,

            voiceConnectionRegistry:
                voiceRuntimeServices
                    .voiceConnectionRegistry,

            policy:
                voiceTransportPolicy
        });

    if (
        typeof resolvedGateway
            .acceptConnection !==
            "function" ||
        typeof resolvedGateway.closeAll !==
            "function" ||
        typeof resolvedGateway.getStats !==
            "function" ||
        !resolvedGateway.policy
    ) {
        throw new TypeError(
            "gateway does not provide the required Voice transport interface."
        );
    }

    const voiceConnectionEmitter =
        new EventEmitter();

    const voiceWebSocketRuntime =
        attachVoiceWebSocketTransport({
            webSocketServer:
                voiceConnectionEmitter,

            gateway:
                resolvedGateway,

            logger
        });

    let grpcRegistration = null;
    let stopped = false;

    //* این تابع اتصال وب‌سوکت را فقط به یکی از دو مسیر ریل‌تایم یا صوت تحویل می‌دهد.
    function routeWebSocketConnection(
        socket,
        request
    ) {
        if (
            isVoiceWebSocketRequest(
                request
            )
        ) {
            voiceConnectionEmitter.emit(
                "connection",
                socket,
                request
            );

            return;
        }

        realtimeConnectionListener.call(
            webSocketServer,
            socket,
            request
        );
    }

    webSocketServer.off(
        "connection",
        realtimeConnectionListener
    );

    try {
        webSocketServer.on(
            "connection",
            routeWebSocketConnection
        );
    } catch (error) {
        webSocketServer.on(
            "connection",
            realtimeConnectionListener
        );

        throw error;
    }

    //* این تابع سرویس جی‌آرپی صوت را دقیقاً یک‌بار روی سرور اصلی و پیش از بایند ثبت می‌کند.
    function registerGrpc({
        grpcServer
    } = {}) {
        if (stopped) {
            throw new Error(
                "Voice transport runtime wrapper is stopped."
            );
        }

        if (grpcRegistration) {
            throw new Error(
                "Voice gRPC transport is already registered."
            );
        }

        grpcRegistration =
            registerVoiceGrpcTransport({
                grpcServer,

                gateway:
                    resolvedGateway,

                logger
            });

        logger?.info?.(
            "[VoiceTransport] gRPC service registered on the main server.",
            {
                serviceName:
                    grpcRegistration
                        .serviceName,

                fixedPortOpened:
                    false
            }
        );

        return grpcRegistration;
    }

    //* این تابع مسیر صوت را متوقف، شنونده اصلی ریل‌تایم را بازیابی و اتصال‌های صوت را پاک‌سازی می‌کند.
    async function stop() {
        if (stopped) {
            return;
        }

        stopped = true;

        webSocketServer.off(
            "connection",
            routeWebSocketConnection
        );

        if (
            realtimeTransport.wss ===
                webSocketServer &&
            !webSocketServer
                .listeners(
                    "connection"
                )
                .includes(
                    realtimeConnectionListener
                )
        ) {
            webSocketServer.on(
                "connection",
                realtimeConnectionListener
            );
        }

        await voiceWebSocketRuntime.stop();

        await resolvedGateway.closeAll(
            "Voice transport runtime wrapper stopped."
        );

        await Promise.resolve(
            voiceRuntimeServices
                .stop?.()
        );
    }

    //* این تابع آمار هسته صوت، مسیر وب‌سوکت و ثبت جی‌آرپی را یکجا برمی‌گرداند.
    function getStats() {
        return Object.freeze({
            core:
                voiceRuntimeServices
                    .voiceConnectionRegistry
                    .getStats(),

            transport:
                resolvedGateway
                    .getStats(),

            webSocket:
                voiceWebSocketRuntime
                    .getStats(),

            grpcRegistered:
                grpcRegistration !==
                null,

            grpcServiceName:
                grpcRegistration
                    ?.serviceName ??
                "",

            stopped
        });
    }

    logger?.info?.(
        "[VoiceTransport] WebSocket wrapper attached to the existing Realtime listener.",
        {
            query:
                `${VOICE_WEBSOCKET_QUERY_KEY}=${VOICE_WEBSOCKET_QUERY_VALUE}`,

            fixedPortOpened:
                false,

            nginxChanged:
                false
        }
    );

    return Object.freeze({
        ...voiceRuntimeServices,

        voiceTransportGateway:
            resolvedGateway,

        registerGrpc,
        stop,
        getStats
    });
}

export {
    VOICE_WEBSOCKET_QUERY_KEY,
    VOICE_WEBSOCKET_QUERY_VALUE,
    createVoiceTransportRuntimeWrapper,
    isVoiceWebSocketRequest
};

/*
توضیح فایل:
این فایل سرویس‌های موجود صوت را بدون تغییر فایل‌های ریل‌تایم یا جی‌آرپی داخل یک پوشاننده قرار می‌دهد. اتصال دارای پارامتر transport=voice فقط وارد مسیر صوت می‌شود، اتصال‌های دیگر به همان شنونده قبلی ریل‌تایم تحویل داده می‌شوند و سرویس جی‌آرپی صوت نیز با یک متد کوچک روی سرور اصلی ثبت می‌شود. این فایل پورت، سرور، انجین‌اکس یا انووی تازه‌ای ایجاد نمی‌کند.
*/
