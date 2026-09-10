// File => src/gameServerControl/http/gameServerControlRawHttpAdapter.js

import { tryHandlePublicHealthRequest } from "../../health/publicHealthWrapper.js";

const DEFAULT_BASE_PATH = "/game-server-control";
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

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

//* این تابع مسیر اچ تی تی پی را تمیز و استاندارد می کند.
function normalizePath(path) {
    if (!isNonEmptyString(path)) return "";

    const cleanPath = path.trim();

    if (cleanPath === "/") return "";

    return cleanPath.startsWith("/") ? cleanPath.replace(/\/+$/g, "") : `/${cleanPath.replace(/\/+$/g, "")}`;
}

//* این تابع مسیر درخواست را از روی آدرس خام می خواند.
function readRequestPath(req = {}) {
    const host = req.headers?.host || "localhost";
    const rawUrl = req.url || "/";

    try {
        const url = new URL(rawUrl, `http://${host}`);
        return normalizePath(url.pathname);
    } catch {
        return normalizePath(rawUrl.split("?")[0] || "/");
    }
}

//* این تابع کوئری درخواست را از روی آدرس خام می خواند.
function readRequestQuery(req = {}) {
    const host = req.headers?.host || "localhost";
    const rawUrl = req.url || "/";
    const query = {};

    try {
        const url = new URL(rawUrl, `http://${host}`);

        for (const [key, value] of url.searchParams.entries()) {
            query[key] = value;
        }
    } catch {
        return query;
    }

    return query;
}

//* این تابع پاسخ موفق استاندارد اچ تی تی پی می سازد.
function createSuccess(reason, message, data = {}) {
    return {
        success: true,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع پاسخ خطای استاندارد اچ تی تی پی می سازد.
function createFailure(reason, message, data = {}) {
    return {
        success: false,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع جیسون را روی پاسخ خام نود ارسال می کند.
function sendJson(res, statusCode, payload) {
    if (!res) return payload;

    const body = JSON.stringify(payload);

    if (typeof res.writeHead === "function") {
        res.writeHead(statusCode, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body)
        });
    } else {
        res.statusCode = statusCode;
        res.headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body)
        };
    }

    if (typeof res.end === "function") {
        res.end(body);
    } else {
        res.body = body;
    }

    return payload;
}

//* این تابع بادی خام درخواست را با محدودیت حجم می خواند.
function readRawBody(req, maxBodyBytes = DEFAULT_MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let completed = false;

        req.on("data", (chunk) => {
            if (completed) return;

            const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
            totalBytes += bufferChunk.length;

            if (totalBytes > maxBodyBytes) {
                completed = true;
                reject(new Error("request_body_too_large"));
                req.destroy?.();
                return;
            }

            chunks.push(bufferChunk);
        });

        req.on("end", () => {
            if (completed) return;

            completed = true;
            resolve(Buffer.concat(chunks).toString("utf8"));
        });

        req.on("error", (error) => {
            if (completed) return;

            completed = true;
            reject(error);
        });
    });
}

//* این تابع بادی جیسون درخواست را می خواند.
async function readJsonBody(req, maxBodyBytes = DEFAULT_MAX_BODY_BYTES) {
    const method = String(req.method || "GET").toUpperCase();

    if (method === "GET" || method === "HEAD") {
        return {};
    }

    const rawBody = await readRawBody(req, maxBodyBytes);

    if (!rawBody.trim()) {
        return {};
    }

    try {
        return JSON.parse(rawBody);
    } catch {
        throw new Error("invalid_json_body");
    }
}

//* این تابع کنترل گیم سرور را از تنظیمات یا سرور خام می خواند.
function resolveGameServerControl(req = {}, options = {}) {
    return options.control ??
        options.getControl?.() ??
        options.app?.locals?.gameServerControl ??
        req.app?.locals?.gameServerControl ??
        null;
}

//* این تابع یوزر آث شده را از درخواست یا تنظیمات می خواند.
async function readAuthenticatedUser(req = {}, options = {}) {
    if (typeof options.resolveUserFromRequest === "function") {
        return await options.resolveUserFromRequest(req);
    }

    return req.user ??
        req.auth?.user ??
        req.auth ??
        null;
}

//* این تابع شناسه یوزر آث شده را از درخواست یا تنظیمات می خواند.
function readAuthenticatedUserId(req = {}, user = null) {
    return user?.userId ??
        user?.id ??
        req.auth?.userId ??
        req.authUserId ??
        "";
}

//* این تابع کانتکست استاندارد برای هندلرهای کنترل گیم سرور می سازد.
function createHandlerContext(req = {}, user = null) {
    return {
        req,
        headers: req.headers ?? {},
        user,
        userId: readAuthenticatedUserId(req, user)
    };
}

//* این تابع دیتای درخواست سمت کلاینت را می سازد و جلوی جعل یوزر آی دی از بادی را می گیرد.
function createClientRequest({ query = {}, body = {} } = {}, options = {}) {
    const request = {
        ...(isObject(query) ? query : {}),
        ...(isObject(body) ? body : {})
    };

    if (options.allowClientUserIdFromBody !== true) {
        delete request.userId;
    }

    return request;
}

//* این تابع دیتای درخواست سمت ددیکیتد سرور را می سازد.
function createDedicatedServerRequest({ query = {}, body = {} } = {}) {
    return {
        ...(isObject(query) ? query : {}),
        ...(isObject(body) ? body : {})
    };
}

//* این تابع مسیرهای خام کنترل گیم سرور را تعریف می کند.
function getGameServerControlRawHttpRoutes() {
    return [
        {
            method: "GET",
            path: "/status",
            statusSuccess: 200,
            statusFailure: 503,
            run: async ({ control }) => control.getStatus()
        },
        {
            method: "GET",
            path: "/dedicated/report",
            statusSuccess: 200,
            statusFailure: 503,
            run: async ({ control }) => control.getDedicatedHealthReport()
        },
        {
            method: "GET",
            path: "/dedicated/health",
            statusSuccess: 200,
            statusFailure: 503,
            run: async ({ control }) => control.getDedicatedHealthReport()
        },
        {
            method: "POST",
            path: "/client/ticket",
            statusSuccess: 200,
            statusFailure: 400,
            requireUser: true,
            run: async ({ control, ctx, request }) => control.clientHandler.requestGameServerTicket(ctx, request)
        },
        {
            method: "GET",
            path: "/client/servers",
            statusSuccess: 200,
            statusFailure: 400,
            run: async ({ control, ctx, request }) => control.clientHandler.listAvailableGameServers(ctx, request)
        },
        {
            method: "GET",
            path: "/client/session",
            statusSuccess: 200,
            statusFailure: 404,
            requireUser: true,
            run: async ({ control, ctx, request }) => control.clientHandler.getGameSession(ctx, request)
        },
        {
            method: "POST",
            path: "/dedicated/register",
            statusSuccess: 200,
            statusFailure: 400,
            dedicated: true,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.registerDedicatedServer(ctx, request)
        },
        {
            method: "POST",
            path: "/dedicated/heartbeat",
            statusSuccess: 200,
            statusFailure: 400,
            dedicated: true,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.heartbeatDedicatedServer(ctx, request)
        },

        {
            method: "POST",
            path: "/dedicated/renew-service-token",
            statusSuccess: 200,
            statusFailure: 401,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.renewDedicatedServerToken(ctx, request)
        },
        {
            method: "POST",
            path: "/dedicated/verify-ticket",
            statusSuccess: 200,
            statusFailure: 400,
            dedicated: true,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.verifyGameTicket(ctx, request)
        },
        {
            method: "POST",
            path: "/dedicated/player-left",
            statusSuccess: 200,
            statusFailure: 400,
            dedicated: true,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.reportPlayerLeft(ctx, request)
        },
        {
            method: "POST",
            path: "/dedicated/session-result",
            statusSuccess: 200,
            statusFailure: 400,
            dedicated: true,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.reportSessionResult(ctx, request)
        },
        {
            method: "GET",
            path: "/dedicated/status",
            statusSuccess: 200,
            statusFailure: 400,
            dedicated: true,
            run: async ({ control, ctx, request }) => control.dedicatedServerHandler.getDedicatedServerStatus(ctx, request)
        }
    ];
}

//* این تابع مسیر داخلی درخواست را نسبت به مسیر پایه می خواند.
function readRelativeRoutePath(requestPath, basePath) {
    const cleanBasePath = normalizePath(basePath);
    const cleanRequestPath = normalizePath(requestPath);

    if (cleanRequestPath === cleanBasePath) return "/";
    if (!cleanRequestPath.startsWith(`${cleanBasePath}/`)) return null;

    return normalizePath(cleanRequestPath.slice(cleanBasePath.length));
}

//* این تابع روت مناسب درخواست را پیدا می کند.
function findRawRoute(method, relativePath) {
    const cleanMethod = String(method || "GET").toUpperCase();
    const cleanPath = normalizePath(relativePath);
    const routes = getGameServerControlRawHttpRoutes();

    return routes.find((route) => route.method === cleanMethod && normalizePath(route.path) === cleanPath) ?? null;
}

//* این تابع بررسی می کند آیا مسیر وجود دارد ولی متد اشتباه است یا نه.
function hasRoutePath(relativePath) {
    const cleanPath = normalizePath(relativePath);

    return getGameServerControlRawHttpRoutes()
        .some((route) => normalizePath(route.path) === cleanPath);
}

//* این تابع یک درخواست خام اچ تی تی پی کنترل گیم سرور را هندل می کند.
async function handleGameServerControlRawHttpRequest(req, res, options = {}) {
    const basePath = options.basePath ?? DEFAULT_BASE_PATH;
    const requestPath = readRequestPath(req);
    const relativePath = readRelativeRoutePath(requestPath, basePath);

    if (relativePath === null) {
        return false;
    }

    const control = resolveGameServerControl(req, options);

    if (!control) {
        sendJson(res, 503, createFailure("game_server_control_missing", "Game server control is not attached."));
        return true;
    }

    const method = String(req.method || "GET").toUpperCase();
    const route = findRawRoute(method, relativePath);

    if (!route) {
        const statusCode = hasRoutePath(relativePath) ? 405 : 404;
        const reason = statusCode === 405 ? "method_not_allowed" : "game_server_control_route_not_found";

        sendJson(res, statusCode, createFailure(reason, "Game server control route was not found.", {
            method,
            path: requestPath,
            basePath,
            relativePath
        }));

        return true;
    }

    const isStatusRoute = normalizePath(route.path) === "/status";

    if (!isStatusRoute && (control.config?.enabled !== true || control.started !== true)) {
        sendJson(res, 503, createFailure("game_server_control_disabled", "Game server control is disabled or not started.", {
            enabled: control.config?.enabled === true,
            started: control.started === true,
            method,
            path: requestPath
        }));

        return true;
    }

    let body = {};

    try {
        body = await readJsonBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    } catch (error) {
        const statusCode = error.message === "request_body_too_large" ? 413 : 400;

        sendJson(res, statusCode, createFailure(error.message, "Request body could not be read.", {
            method,
            path: requestPath
        }));

        return true;
    }

    const query = readRequestQuery(req);
    const request = route.dedicated
        ? createDedicatedServerRequest({ query, body })
        : createClientRequest({ query, body }, options);

    let user = await readAuthenticatedUser(req, options);

    if (!user && options.allowClientUserIdFromBody === true && isNonEmptyString(request.userId)) {
        user = {
            userId: request.userId,
            source: "body_user_id_test_mode"
        };
    }

    const ctx = createHandlerContext(req, user);

    if (route.requireUser && !ctx.userId) {
        sendJson(res, 401, createFailure("authenticated_user_required", "Authenticated user is required for this route."));
        return true;
    }

    try {
        const result = await route.run({
            control,
            ctx,
            request,
            query,
            body
        });

        const statusCode = result?.success ? route.statusSuccess : route.statusFailure;
        sendJson(res, statusCode, result);
        return true;
    } catch (error) {
        sendJson(res, 500, createFailure("game_server_control_raw_http_error", error.message, {
            errorName: error.name,
            method,
            path: requestPath
        }));

        return true;
    }
}

//* این تابع هندلر آماده برای سرور اچ تی تی پی خام می سازد.
function createGameServerControlRawHttpAdapter(options = {}) {
    return async function gameServerControlRawHttpAdapter(req, res) {
        //* درخواست ابتدا به ورپر عمومی هلت داده می شود و اگر مسیر هلت نبود، منطق قبلی کنترل گیم سرور بدون تغییر ادامه پیدا می کند.
        const handledByPublicHealth = await tryHandlePublicHealthRequest(req, res, {
            getGameServerControl: () => resolveGameServerControl(req, options)
        });

        if (handledByPublicHealth) {
            return true;
        }

        return await handleGameServerControlRawHttpRequest(req, res, options);
    };
}

export {
    DEFAULT_BASE_PATH,
    createGameServerControlRawHttpAdapter,
    getGameServerControlRawHttpRoutes,
    handleGameServerControlRawHttpRequest
};

// این فایل مسیرهای کنترل گیم سرور را برای سرور اچ تی تی پی خام نود آماده می کند و به اکسپرس وابسته نیست.
