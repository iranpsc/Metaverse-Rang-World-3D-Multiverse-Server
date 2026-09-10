// مسیر فایل: src/voice/dedicated/createVoiceDedicatedSessionDeltaRuntime.js

import {
    VoiceAuthoritativeSessionService
} from "../session/voiceAuthoritativeSessionService.js";

import {
    VoiceSessionRegistry
} from "../session/voiceSessionRegistry.js";

import {
    createVoiceDedicatedSessionDeltaHttpHandler
} from "./createVoiceDedicatedSessionDeltaHttpHandler.js";

import {
    VoiceDedicatedSessionDeltaService
} from "./voiceDedicatedSessionDeltaService.js";

import {
    createVoiceDedicatedSessionEligibilityHttpHandler
} from "./createVoiceDedicatedSessionEligibilityHttpHandler.js";

import {
    VoiceDedicatedSessionEligibilityService
} from "./voiceDedicatedSessionEligibilityService.js";

//* این تابع رانتایم دریافت رویدادهای سشن صوتی را پیش از ساخت سرور اچ‌تی‌تی‌پی آماده می‌کند.
function createVoiceDedicatedSessionDeltaRuntime({
    logger = null
} = {}) {
    let service =
        null;

    let eligibilityService =
        null;

    let voiceSessionRegistry =
        null;

    let voiceAuthoritativeSessionService =
        null;

    let attached =
        false;

    let stopped =
        false;

    let eventObserver =
        null;

    const deltaHttpHandler =
        createVoiceDedicatedSessionDeltaHttpHandler({
            getService:
                () => service,

            logger
        });

    const eligibilityHttpHandler =
        createVoiceDedicatedSessionEligibilityHttpHandler({
            getService:
                () => eligibilityService,

            logger
        });

    //* این تابع دو مسیر Voice-only را روی همان هندلر HTTP موجود بدون تغییر index اصلی ترکیب می‌کند.
    async function handleHttpRequest(
        req,
        res
    ) {
        if (
            await eligibilityHttpHandler(
                req,
                res
            )
        ) {
            return true;
        }

        return deltaHttpHandler(
            req,
            res
        );
    }

    //* این تابع رجیستری اتصال صوتی و کنترل زنده گیم‌سرور را به سرویس دریافت رویداد متصل می‌کند.
    function attach({
        gameServerControlRuntime,
        voiceConnectionRegistry
    } = {}) {
        if (
            stopped
        ) {
            throw new Error(
                "Voice dedicated session delta runtime is stopped."
            );
        }

        if (
            attached
        ) {
            throw new Error(
                "Voice dedicated session delta runtime is already attached."
            );
        }

        if (
            !gameServerControlRuntime ||
            !gameServerControlRuntime
                .registry ||
            typeof gameServerControlRuntime
                .registry
                .hasServer !==
                "function" ||
            !gameServerControlRuntime
                .sessionRegistry ||
            !gameServerControlRuntime
                .dedicatedServerHandler
        ) {
            throw new TypeError(
                "gameServerControlRuntime does not provide the required dedicated interfaces."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry
                .listByUserId !==
                "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry must provide listByUserId."
            );
        }

        voiceSessionRegistry =
            new VoiceSessionRegistry();

        voiceAuthoritativeSessionService =
            new VoiceAuthoritativeSessionService({
                sessionRegistry:
                    voiceSessionRegistry
            });

        service =
            new VoiceDedicatedSessionDeltaService({
                dedicatedServerHandler:
                    gameServerControlRuntime
                        .dedicatedServerHandler,

                gameServerRegistry:
                    gameServerControlRuntime
                        .registry,

                gameSessionRegistry:
                    gameServerControlRuntime
                        .sessionRegistry,

                voiceConnectionRegistry,

                voiceAuthoritativeSessionService,

                eventObserver,

                logger
            });

        eligibilityService =
            new VoiceDedicatedSessionEligibilityService({
                dedicatedServerHandler:
                    gameServerControlRuntime
                        .dedicatedServerHandler,

                gameServerRegistry:
                    gameServerControlRuntime
                        .registry,

                gameSessionRegistry:
                    gameServerControlRuntime
                        .sessionRegistry,

                voiceConnectionRegistry
            });

        attached =
            true;

        logger?.info?.(
            "[VoiceDedicatedSessionDeltaRuntime] Attached to live runtimes.",
            {
                route:
                    "/game-server-control/dedicated/voice-session-delta",

                eligibilityRoute:
                    "/game-server-control/dedicated/voice-session-eligibility",

                fixedPortOpened:
                    false
            }
        );

        return service;
    }

    //* این تابع Observer مراحل بعدی مانند نهایی‌سازی ضبط را پیش یا پس از Attach تنظیم می‌کند.
    function setEventObserver(observer) {
        if (
            observer !== null &&
            typeof observer !== "function"
        ) {
            throw new TypeError(
                "Voice dedicated event observer must be null or a function."
            );
        }

        eventObserver = observer;
        service?.setEventObserver?.(observer);
    }

    //* این تابع رانتایم دریافت رویداد را متوقف و منابع داخلی آن را پاک‌سازی می‌کند.
    function stop() {
        if (
            stopped
        ) {
            return;
        }

        stopped =
            true;

        service?.stop?.();
        eligibilityService?.stop?.();

        service =
            null;

        eligibilityService =
            null;

        voiceAuthoritativeSessionService =
            null;

        voiceSessionRegistry =
            null;
    }

    //* این تابع آمار اتصال و سشن‌های دریافت‌شده را برمی‌گرداند.
    function getStats() {
        return Object.freeze({
            attached,
            stopped,

            service:
                service?.getStats?.() ??
                null,

            eligibilityServiceReady:
                eligibilityService !==
                null,

            sessionRegistry:
                voiceSessionRegistry
                    ?.getStats?.() ??
                null
        });
    }

    return Object.freeze({
        attach,
        setEventObserver,
        stop,
        getStats,
        handleHttpRequest,

        get service() {
            return service;
        },

        get eligibilityService() {
            return eligibilityService;
        },

        get voiceSessionRegistry() {
            return voiceSessionRegistry;
        },

        get voiceAuthoritativeSessionService() {
            return voiceAuthoritativeSessionService;
        }
    });
}

export {
    createVoiceDedicatedSessionDeltaRuntime
};

/*
توضیح فایل:
این فایل مسیر اچ‌تی‌تی‌پی دریافت رویدادهای سشن صوتی را پیش از شروع سرور آماده می‌کند و پس از ساخته‌شدن رانتایم‌های زنده، رجیستری اتصال صوتی و کنترل گیم‌سرور را به سرویس قطعی متصل می‌کند.
*/
