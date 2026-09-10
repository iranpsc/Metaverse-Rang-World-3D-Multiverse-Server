// File => src/gameServerControl/gameServerControlHttpApi.selftest.js

import {
    attachGameServerControlHttpApi,
    detachGameServerControlHttpApi,
    getGameServerControlHttpApiStatus
} from "./gameServerControlHttpApi.js";

const TEST_SECRET = "phase2_http_api_secret_123";
const TEST_SERVER_ID = "ds_http_api_001";
const TEST_ROOM_ID = "room_http_api_001";
const TEST_USER_ID = "user_http_api_001";

//* این تابع رُتر تستی ساده می سازد.
function createFakeRouter() {
    const routes = [];

    return {
        routes,

        get(path, handler) {
            routes.push({ method: "GET", path, handler });
        },

        post(path, handler) {
            routes.push({ method: "POST", path, handler });
        }
    };
}

//* این تابع پاسخ تستی ساده می سازد.
function createFakeResponse() {
    return {
        statusCode: 200,
        body: null,

        status(code) {
            this.statusCode = code;
            return this;
        },

        json(payload) {
            this.body = payload;
            return payload;
        }
    };
}

//* این تابع یک روت تستی را پیدا می کند.
function findRoute(router, method, path) {
    return router.routes.find((route) => route.method === method && route.path === path);
}

//* این تابع یک روت تستی را اجرا می کند.
async function callRoute(router, method, path, req) {
    const route = findRoute(router, method, path);

    if (!route) {
        throw new Error(`[HttpApiSelfTest] Route not found: ${method} ${path}`);
    }

    const res = createFakeResponse();

    await route.handler(req, res, (error) => {
        if (error) throw error;
    });

    return res;
}

//* این تابع شرط تست را بررسی می کند.
function assertTest(condition, message, data = {}) {
    if (condition) return;

    const error = new Error(`[HttpApiSelfTest] ${message}`);
    error.data = data;
    throw error;
}

//* این تابع آبجکت های دارای حلقه را برای چاپ امن تبدیل می کند.
function safeJsonStringify(value) {
    const seen = new WeakSet();

    return JSON.stringify(value, (key, item) => {
        if (key === "control") return "[GameServerControl]";
        if (key === "cleanupTimer") return "[Timer]";
        if (key === "app") return "[App]";
        if (key === "router") return "[Router]";
        if (key === "req") return "[Request]";
        if (typeof item === "function") return "[Function]";

        if (item && typeof item === "object") {
            if (seen.has(item)) return "[Circular]";
            seen.add(item);
        }

        return item;
    }, 2);
}

//* این تابع مرحله تست را چاپ می کند.
function printStep(title, value) {
    console.log(`\n========== ${title} ==========`);
    console.log(safeJsonStringify(value));
}

//* این تابع تست کامل اچ تی تی پی ای پی آی فاز دو را اجرا می کند.
async function runHttpApiSelfTest() {
    const app = {
        locals: {}
    };

    const router = createFakeRouter();

    const attachResult = attachGameServerControlHttpApi({
        app,
        router,
        basePath: "/game-server-control",
        config: {
            enabled: true,
            defaultHost: "127.0.0.1",
            defaultPort: 7777,
            ticketTtlSeconds: 60,
            heartbeatTimeoutSeconds: 15,
            maxPlayersPerInstance: 20,
            cleanupIntervalSeconds: 10,
            serviceSecret: TEST_SECRET
        }
    });

    printStep("HTTP_API_ATTACH", attachResult);
    assertTest(attachResult.success === true, "HTTP API attach must be success.", attachResult);
    assertTest(attachResult.data.routesAttached === true, "Routes must be attached.", attachResult);
    assertTest(attachResult.data.routesResult.count === 10, "Routes count must be 10.", attachResult);
    assertTest(!!app.locals.gameServerControl, "Control must exist on app.locals.", attachResult);

    const control = app.locals.gameServerControl;
    const serviceToken = control.serviceTokenService.createToken({
        serverId: TEST_SERVER_ID
    });

    const baseReq = {
        app,
        headers: {},
        query: {},
        body: {}
    };

    const registerRes = await callRoute(router, "POST", "/game-server-control/dedicated/register", {
        ...baseReq,
        body: {
            serviceToken,
            serverId: TEST_SERVER_ID,
            host: "127.0.0.1",
            port: 7777,
            roomId: TEST_ROOM_ID,
            region: "eu-central",
            zone: "de-1",
            maxPlayers: 20,
            currentPlayers: 0,
            status: "online"
        }
    });

    printStep("HTTP_API_REGISTER_ROUTE", registerRes.body);
    assertTest(registerRes.statusCode === 200, "Register route status must be 200.", registerRes.body);
    assertTest(registerRes.body.success === true, "Register route must be success.", registerRes.body);

    const ticketRes = await callRoute(router, "POST", "/game-server-control/client/ticket", {
        ...baseReq,
        user: {
            userId: TEST_USER_ID,
            userName: "Http Api Player"
        },
        body: {
            roomId: TEST_ROOM_ID,
            region: "eu-central"
        }
    });

    printStep("HTTP_API_CLIENT_TICKET_ROUTE", ticketRes.body);
    assertTest(ticketRes.statusCode === 200, "Client ticket route status must be 200.", ticketRes.body);
    assertTest(ticketRes.body.success === true, "Client ticket route must be success.", ticketRes.body);

    const ticket = ticketRes.body.data.ticket;
    const connection = ticketRes.body.data.connection;

    const verifyRes = await callRoute(router, "POST", "/game-server-control/dedicated/verify-ticket", {
        ...baseReq,
        body: {
            serviceToken,
            serverId: connection.serverId,
            roomId: connection.roomId,
            userId: TEST_USER_ID,
            ticketId: ticket.ticketId,
            signature: ticket.signature,
            sessionId: connection.sessionId,
            connectionId: "conn_http_api_001",
            playerId: "player_http_api_001",
            userName: "Http Api Player"
        }
    });

    printStep("HTTP_API_VERIFY_ROUTE", verifyRes.body);
    assertTest(verifyRes.statusCode === 200, "Verify route status must be 200.", verifyRes.body);
    assertTest(verifyRes.body.success === true, "Verify route must be success.", verifyRes.body);

    const statusRes = await callRoute(router, "GET", "/game-server-control/status", {
        ...baseReq
    });

    printStep("HTTP_API_STATUS_ROUTE", statusRes.body);
    assertTest(statusRes.statusCode === 200, "Status route status must be 200.", statusRes.body);
    assertTest(statusRes.body.data.registry.total === 1, "Registry total must be 1.", statusRes.body);
    assertTest(statusRes.body.data.sessions.totalPlayers === 1, "Session totalPlayers must be 1.", statusRes.body);

    const apiStatus = getGameServerControlHttpApiStatus({ app, router });
    printStep("HTTP_API_INTERNAL_STATUS", apiStatus);
    assertTest(apiStatus.success === true, "Internal HTTP API status must be success.", apiStatus);
    assertTest(apiStatus.data.hasControl === true, "Internal status must have control.", apiStatus);

    const detachResult = detachGameServerControlHttpApi({ app });
    printStep("HTTP_API_DETACH", detachResult);
    assertTest(detachResult.success === true, "HTTP API detach must be success.", detachResult);
    assertTest(!app.locals.gameServerControl, "Control must be removed from app.locals after detach.", detachResult);

    printStep("HTTP_API_SELFTEST_RESULT", {
        success: true,
        message: "GameServerControl HTTP API selftest passed."
    });
}

try {
    await runHttpApiSelfTest();
} catch (error) {
    console.error("\n========== HTTP_API_SELFTEST_FAILED ==========");
    console.error(error.message);

    if (error.data) {
        console.error(safeJsonStringify(error.data));
    }

    process.exitCode = 1;
}

// این فایل فقط تست مستقل اتصال اچ تی تی پی ای پی آی ماژول کنترل گیم سرور را اجرا می کند و هنوز هیچ اتصال به استارتاپ اصلی ایجاد نمی کند.
