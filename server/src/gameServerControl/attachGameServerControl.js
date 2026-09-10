// File => src/gameServerControl/attachGameServerControl.js

import {
    createGameServerControl,
    resolveGameServerControlConfig
} from "./index.js";

const GAME_SERVER_CONTROL_LOCALS_KEY = "gameServerControl";
const GAME_SERVER_CONTROL_CONTEXT_KEY = "__gameServerControl";

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار آبجکت معتبر است یا نه.
function isObject(value) {
    return value !== null && typeof value === "object";
}

//* این تابع لاگر امن را از کانتکست می خواند.
function readLogger(ctx = {}) {
    return ctx.logger ?? ctx.app?.locals?.logger ?? console;
}

//* این تابع کانفیگ را برای لاگ امن آماده می کند و سکرت را مخفی نگه می دارد.
function toSafeConfigLog(config) {
    if (!config) return null;

    return {
        enabled: config.enabled,
        defaultHost: config.defaultHost,
        defaultPort: config.defaultPort,
        ticketTtlSeconds: config.ticketTtlSeconds,
        heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
        maxPlayersPerInstance: config.maxPlayersPerInstance,
        cleanupIntervalSeconds: config.cleanupIntervalSeconds,
        serviceSecret: config.serviceSecret ? "***" : ""
    };
}

//* این تابع پاسخ موفق استاندارد برای اتصال ماژول می سازد.
function createSuccess(reason, message, data = {}, control = null) {
    return {
        success: true,
        reason,
        message,
        data,
        control,
        ts: nowMs()
    };
}

//* این تابع پاسخ خطای استاندارد برای اتصال ماژول می سازد.
function createFailure(reason, message, data = {}) {
    return {
        success: false,
        reason,
        message,
        data,
        control: null,
        ts: nowMs()
    };
}

//* این تابع محل ذخیره ماژول روی اپ اکسپرس یا کانتکست را پیدا می کند.
function resolveStorage(ctx = {}) {
    if (isObject(ctx.app)) {
        if (!isObject(ctx.app.locals)) ctx.app.locals = {};

        return {
            type: "app.locals",
            target: ctx.app.locals,
            key: GAME_SERVER_CONTROL_LOCALS_KEY
        };
    }

    if (isObject(ctx)) {
        return {
            type: "context",
            target: ctx,
            key: GAME_SERVER_CONTROL_CONTEXT_KEY
        };
    }

    return null;
}

//* این تابع نمونه قبلی ماژول را از اپ یا کانتکست می خواند.
function getAttachedGameServerControl(ctx = {}) {
    const storage = resolveStorage(ctx);

    if (!storage) return null;

    return storage.target[storage.key] ?? null;
}

//* این تابع نمونه ماژول را روی اپ یا کانتکست ذخیره می کند.
function setAttachedGameServerControl(ctx = {}, control) {
    const storage = resolveStorage(ctx);

    if (!storage) return false;

    storage.target[storage.key] = control;
    return true;
}

//* این تابع نمونه ماژول را از اپ یا کانتکست حذف می کند.
function removeAttachedGameServerControl(ctx = {}) {
    const storage = resolveStorage(ctx);

    if (!storage) return false;

    if (storage.target[storage.key]) {
        delete storage.target[storage.key];
        return true;
    }

    return false;
}

//* این تابع ماژول کنترل گیم سرور را به استارتاپ آینده وصل می کند.
function attachGameServerControl(ctx = {}) {
    const logger = readLogger(ctx);
    const existingControl = getAttachedGameServerControl(ctx);

    if (existingControl) {
        return createSuccess(
            "game_server_control_already_attached",
            "Game server control is already attached.",
            {
                attached: true,
                started: existingControl.started === true,
                config: toSafeConfigLog(existingControl.config)
            },
            existingControl
        );
    }

    let config = null;

    try {
        config = resolveGameServerControlConfig(ctx.config ?? null);
    } catch (error) {
        return createFailure("game_server_control_config_invalid", error.message, {
            errorName: error.name
        });
    }

    let control = null;

    try {
        control = ctx.control ?? createGameServerControl({
            config,
            logger,
            ticketStore: ctx.ticketStore,
            ticketService: ctx.ticketService,
            registry: ctx.registry,
            healthStore: ctx.healthStore,
            sessionRegistry: ctx.sessionRegistry,
            allocator: ctx.allocator,
            serviceTokenService: ctx.serviceTokenService,
            clientHandler: ctx.clientHandler,
            dedicatedServerHandler: ctx.dedicatedServerHandler
        });
    } catch (error) {
        return createFailure("game_server_control_create_failed", error.message, {
            errorName: error.name,
            config: toSafeConfigLog(config)
        });
    }

    const stored = setAttachedGameServerControl(ctx, control);

    if (!stored) {
        return createFailure("game_server_control_attach_storage_failed", "Game server control could not be stored on startup context.", {
            config: toSafeConfigLog(config)
        });
    }

    if (!config.enabled) {
        logger.info?.("[GameServerControl] attach skipped because module is disabled.");

        return createSuccess(
            "game_server_control_attached_disabled",
            "Game server control attached but disabled.",
            {
                attached: true,
                started: false,
                config: toSafeConfigLog(config)
            },
            control
        );
    }

    const startResult = control.start();

    if (!startResult.success) {
        removeAttachedGameServerControl(ctx);

        return createFailure("game_server_control_start_failed", "Game server control could not start.", {
            startResult,
            config: toSafeConfigLog(config)
        });
    }

    logger.info?.("[GameServerControl] attached and started.");

    return createSuccess(
        "game_server_control_attached",
        "Game server control attached and started.",
        {
            attached: true,
            started: control.started === true,
            startResult,
            config: toSafeConfigLog(config)
        },
        control
    );
}

//* این تابع ماژول کنترل گیم سرور را از استارتاپ جدا و خاموش می کند.
function detachGameServerControl(ctx = {}) {
    const control = getAttachedGameServerControl(ctx);

    if (!control) {
        return createSuccess("game_server_control_not_attached", "Game server control is not attached.", {
            attached: false,
            stopped: false
        });
    }

    let stopResult = null;

    if (typeof control.stop === "function") {
        stopResult = control.stop();
    }

    const removed = removeAttachedGameServerControl(ctx);

    return createSuccess("game_server_control_detached", "Game server control detached.", {
        attached: false,
        removed,
        stopped: stopResult?.success === true,
        stopResult
    });
}

//* این تابع وضعیت اتصال ماژول به استارتاپ را برمی گرداند.
function getAttachedGameServerControlStatus(ctx = {}) {
    const control = getAttachedGameServerControl(ctx);

    if (!control) {
        return createSuccess("game_server_control_not_attached", "Game server control is not attached.", {
            attached: false,
            started: false,
            status: null
        });
    }

    const status = typeof control.getStatus === "function" ? control.getStatus() : null;

    return createSuccess("game_server_control_attached_status", "Game server control attached status loaded.", {
        attached: true,
        started: control.started === true,
        status
    }, control);
}

export {
    GAME_SERVER_CONTROL_LOCALS_KEY,
    attachGameServerControl,
    detachGameServerControl,
    getAttachedGameServerControl,
    getAttachedGameServerControlStatus
};

// این فایل فقط نقطه اتصال امن ماژول کنترل گیم سرور را می سازد و هنوز هیچ روت یا تغییر در استارتاپ اصلی ایجاد نمی کند.
