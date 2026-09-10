// File => src/gameServerControl/gameServerControlHttpApi.js

import {
    attachGameServerControl,
    detachGameServerControl,
    getAttachedGameServerControl,
    getAttachedGameServerControlStatus
} from "./attachGameServerControl.js";

import {
    DEFAULT_BASE_PATH,
    attachGameServerControlRoutes
} from "./routes/gameServerControlRoutes.js";

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار آبجکت معتبر است یا نه.
function isObject(value) {
    return value !== null && typeof value === "object";
}

//* این تابع پاسخ موفق استاندارد برای اتصال اچ تی تی پی می سازد.
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

//* این تابع پاسخ خطای استاندارد برای اتصال اچ تی تی پی می سازد.
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

//* این تابع تارگت روت را از اپ یا رُتر می خواند.
function resolveRouteTarget(options = {}) {
    return options.router ?? options.app ?? null;
}

//* این تابع بررسی می کند آیا امکان نصب روت وجود دارد یا نه.
function canAttachRoutes(options = {}) {
    const target = resolveRouteTarget(options);

    if (!target) return false;
    if (typeof target.get !== "function") return false;
    if (typeof target.post !== "function") return false;

    return true;
}

//* این تابع وضعیت اتصال اچ تی تی پی ماژول را می سازد.
function createHttpApiStatus(options = {}) {
    const control = getAttachedGameServerControl(options);
    const attachedStatus = getAttachedGameServerControlStatus(options);

    return createSuccess("game_server_control_http_api_status", "Game server control HTTP API status loaded.", {
        hasControl: !!control,
        canAttachRoutes: canAttachRoutes(options),
        attached: attachedStatus.data.attached,
        started: attachedStatus.data.started,
        status: attachedStatus.data.status
    }, control);
}

//* این تابع ماژول کنترل گیم سرور و روت های اچ تی تی پی آن را در یک نقطه آماده می کند.
function attachGameServerControlHttpApi(options = {}) {
    if (!isObject(options)) {
        return createFailure("options_required", "Options object is required.");
    }

    if (!isObject(options.app)) {
        return createFailure("app_required", "App object is required for game server control HTTP API.");
    }

    const attachResult = attachGameServerControl({
        ...options,
        app: options.app,
        config: options.config,
        logger: options.logger
    });

    if (!attachResult.success) {
        return createFailure("game_server_control_http_api_attach_failed", "Game server control attach failed.", {
            attachResult
        });
    }

    const control = attachResult.control;
    const shouldAttachRoutes = options.attachRoutes !== false &&
        control?.config?.enabled === true;

    if (!shouldAttachRoutes) {
        return createSuccess("game_server_control_http_api_attached_without_routes", "Game server control HTTP API attached without routes.", {
            attachResult: {
                success: attachResult.success,
                reason: attachResult.reason,
                started: attachResult.data.started,
                attached: attachResult.data.attached
            },
            routesAttached: false,
            routesResult: null
        }, control);
    }

    if (!canAttachRoutes(options)) {
        if (options.detachOnRouteFailure !== false) {
            detachGameServerControl(options);
        }

        return createFailure("game_server_control_http_api_route_target_invalid", "Route target must support GET and POST.", {
            attachResult: {
                success: attachResult.success,
                reason: attachResult.reason
            }
        });
    }

    let routesResult = null;

    try {
        routesResult = attachGameServerControlRoutes({
            app: options.app,
            router: options.router,
            control,
            basePath: options.basePath ?? DEFAULT_BASE_PATH,
            allowClientUserIdFromBody: options.allowClientUserIdFromBody === true
        });
    } catch (error) {
        if (options.detachOnRouteFailure !== false) {
            detachGameServerControl(options);
        }

        return createFailure("game_server_control_http_api_routes_failed", error.message, {
            errorName: error.name
        });
    }

    return createSuccess("game_server_control_http_api_attached", "Game server control HTTP API attached.", {
        attachResult: {
            success: attachResult.success,
            reason: attachResult.reason,
            started: attachResult.data.started,
            attached: attachResult.data.attached
        },
        routesAttached: routesResult.success === true,
        routesResult: {
            success: routesResult.success,
            reason: routesResult.reason,
            basePath: routesResult.data.basePath,
            count: routesResult.data.count,
            routes: routesResult.data.routes
        }
    }, control);
}

//* این تابع ماژول کنترل گیم سرور را از اچ تی تی پی ای پی آی جدا می کند.
function detachGameServerControlHttpApi(options = {}) {
    const detachResult = detachGameServerControl(options);

    return createSuccess("game_server_control_http_api_detached", "Game server control HTTP API detached.", {
        detachResult,
        note: "Express routes cannot be removed dynamically after registration, but the internal control instance is detached."
    });
}

//* این تابع وضعیت اتصال اچ تی تی پی ماژول کنترل گیم سرور را برمی گرداند.
function getGameServerControlHttpApiStatus(options = {}) {
    return createHttpApiStatus(options);
}

export {
    attachGameServerControlHttpApi,
    detachGameServerControlHttpApi,
    getGameServerControlHttpApiStatus
};

// این فایل فقط اتصال ماژول کنترل گیم سرور و روت های آن را در یک نقطه جمع می کند و هنوز هیچ تغییر در استارتاپ اصلی ایجاد نمی کند.
