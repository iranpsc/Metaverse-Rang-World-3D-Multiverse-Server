// File => src/gameServerControl/routes/gameServerControlRoutes.js

const DEFAULT_BASE_PATH = "/game-server-control";

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار آبجکت معتبر است یا نه.
function isObject(value) {
    return value !== null && typeof value === "object";
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مسیر روت را تمیز و استاندارد می کند.
function normalizePath(path) {
    if (!isNonEmptyString(path)) return "";

    const cleanPath = path.trim();

    if (cleanPath === "/") return "";

    return cleanPath.startsWith("/") ? cleanPath.replace(/\/+$/g, "") : `/${cleanPath.replace(/\/+$/g, "")}`;
}

//* این تابع مسیر پایه و مسیر داخلی را به هم وصل می کند.
function joinRoutePath(basePath, routePath) {
    const cleanBasePath = normalizePath(basePath);
    const cleanRoutePath = normalizePath(routePath);

    if (!cleanBasePath && !cleanRoutePath) return "/";
    if (!cleanBasePath) return cleanRoutePath;
    if (!cleanRoutePath) return cleanBasePath;

    return `${cleanBasePath}${cleanRoutePath}`;
}

//* این تابع داده بادی و کوئری درخواست را یکی می کند.
function readRequestData(req = {}) {
    return {
        ...(isObject(req.query) ? req.query : {}),
        ...(isObject(req.body) ? req.body : {})
    };
}

//* این تابع یوزر آث شده را از درخواست می خواند.
function readAuthenticatedUser(req = {}) {
    return req.user ??
        req.auth?.user ??
        req.auth ??
        req.realtimeUser ??
        req.session?.user ??
        null;
}

//* این تابع شناسه یوزر آث شده را از درخواست می خواند.
function readAuthenticatedUserId(req = {}) {
    const user = readAuthenticatedUser(req);

    return user?.userId ??
        user?.id ??
        req.auth?.userId ??
        req.authUserId ??
        "";
}

//* این تابع کانتکست استاندارد هندلرها را از درخواست می سازد.
function createHandlerContext(req = {}) {
    const user = readAuthenticatedUser(req);
    const userId = readAuthenticatedUserId(req);

    return {
        req,
        headers: req.headers ?? {},
        user,
        userId
    };
}

//* این تابع درخواست سمت کلاینت را آماده می کند و اجازه نمی دهد یوزر آی دی از بادی جعل شود.
function createClientRequest(req = {}, options = {}) {
    const request = readRequestData(req);

    if (options.allowClientUserIdFromBody !== true) {
        delete request.userId;
    }

    return request;
}

//* این تابع درخواست سمت ددیکیتد سرور را آماده می کند.
function createDedicatedServerRequest(req = {}) {
    return readRequestData(req);
}

//* این تابع کنترلر گیم سرور را از تنظیمات یا اپ اکسپرس می خواند.
function resolveGameServerControl(req = {}, options = {}) {
    return options.control ??
        options.app?.locals?.gameServerControl ??
        req.app?.locals?.gameServerControl ??
        req.locals?.gameServerControl ??
        null;
}

//* این تابع پاسخ موفق استاندارد برای روت می سازد.
function createRouteSuccess(reason, message, data = {}) {
    return {
        success: true,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع پاسخ خطای استاندارد برای روت می سازد.
function createRouteFailure(reason, message, data = {}) {
    return {
        success: false,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع خروجی را به شکل جیسون ارسال می کند.
function sendJson(res, statusCode, payload) {
    if (!res) return payload;

    if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(statusCode).json(payload);
    }

    if (typeof res.json === "function") {
        res.statusCode = statusCode;
        return res.json(payload);
    }

    res.statusCode = statusCode;
    res.body = payload;
    return payload;
}

//* این تابع خطای داخلی روت را مدیریت می کند.
function sendRouteError(res, error) {
    return sendJson(res, 500, createRouteFailure("game_server_control_route_error", error.message, {
        errorName: error.name
    }));
}

//* این تابع یک هندلر امن اکسپرس می سازد.
function wrapRoute(handler) {
    return async function wrappedGameServerControlRoute(req, res, next) {
        try {
            return await handler(req, res, next);
        } catch (error) {
            if (typeof next === "function") return next(error);
            return sendRouteError(res, error);
        }
    };
}

//* این تابع بررسی می کند تارگت روت قابلیت نصب متد را دارد یا نه.
function assertRouteTarget(target) {
    if (!target) {
        throw new Error("[GameServerControlRoutes] app or router is required.");
    }

    for (const method of ["get", "post"]) {
        if (typeof target[method] !== "function") {
            throw new Error(`[GameServerControlRoutes] route target does not support ${method.toUpperCase()}.`);
        }
    }
}

//* این تابع یک روت را روی تارگت نصب می کند.
function registerRoute(target, method, path, handler, registeredRoutes) {
    target[method](path, handler);

    registeredRoutes.push({
        method: method.toUpperCase(),
        path
    });
}

//* این تابع کنترلر را برای هر درخواست می خواند و اگر نبود پاسخ خطا می دهد.
function requireGameServerControl(req, res, options) {
    const control = resolveGameServerControl(req, options);

    if (!control) {
        sendJson(res, 503, createRouteFailure("game_server_control_missing", "Game server control is not attached."));
        return null;
    }

    return control;
}

//* این تابع روت های ماژول کنترل گیم سرور را روی اپ یا رُتر نصب می کند.
function attachGameServerControlRoutes(options = {}) {
    const target = options.router ?? options.app;
    const basePath = options.basePath ?? DEFAULT_BASE_PATH;
    const registeredRoutes = [];

    assertRouteTarget(target);

    const routeOptions = {
        control: options.control,
        app: options.app,
        allowClientUserIdFromBody: options.allowClientUserIdFromBody === true
    };

    registerRoute(target, "get", joinRoutePath(basePath, "/status"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        return sendJson(res, 200, control.getStatus());
    }), registeredRoutes);

    registerRoute(target, "get", joinRoutePath(basePath, "/dedicated/report"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        return sendJson(res, 200, control.getDedicatedHealthReport());
    }), registeredRoutes);

    registerRoute(target, "get", joinRoutePath(basePath, "/dedicated/health"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        return sendJson(res, 200, control.getDedicatedHealthReport());
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/client/ticket"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.clientHandler.requestGameServerTicket(
            createHandlerContext(req),
            createClientRequest(req, routeOptions)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "get", joinRoutePath(basePath, "/client/servers"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.clientHandler.listAvailableGameServers(
            createHandlerContext(req),
            createClientRequest(req, routeOptions)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "get", joinRoutePath(basePath, "/client/session"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.clientHandler.getGameSession(
            createHandlerContext(req),
            createClientRequest(req, routeOptions)
        );

        return sendJson(res, result.success ? 200 : 404, result);
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/dedicated/register"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.registerDedicatedServer(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/dedicated/heartbeat"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.heartbeatDedicatedServer(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/dedicated/renew-service-token"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.renewDedicatedServerToken(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 401, result);
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/dedicated/verify-ticket"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.verifyGameTicket(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/dedicated/player-left"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.reportPlayerLeft(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "post", joinRoutePath(basePath, "/dedicated/session-result"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.reportSessionResult(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    registerRoute(target, "get", joinRoutePath(basePath, "/dedicated/status"), wrapRoute(async (req, res) => {
        const control = requireGameServerControl(req, res, routeOptions);
        if (!control) return null;

        const result = await control.dedicatedServerHandler.getDedicatedServerStatus(
            createHandlerContext(req),
            createDedicatedServerRequest(req)
        );

        return sendJson(res, result.success ? 200 : 400, result);
    }), registeredRoutes);

    return createRouteSuccess("game_server_control_routes_attached", "Game server control routes attached.", {
        basePath: normalizePath(basePath),
        count: registeredRoutes.length,
        routes: registeredRoutes
    });
}

export {
    DEFAULT_BASE_PATH,
    attachGameServerControlRoutes
};

// این فایل فقط روت های آینده ماژول کنترل گیم سرور را روی اپ یا رُتر نصب می کند و هنوز هیچ اتصال به استارتاپ اصلی ایجاد نمی کند.
