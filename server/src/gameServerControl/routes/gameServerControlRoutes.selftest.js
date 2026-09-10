// File => src/gameServerControl/routes/gameServerControlRoutes.selftest.js

import { createGameServerControl } from "../index.js";
import { attachGameServerControlRoutes } from "./gameServerControlRoutes.js";

const TEST_SECRET = "phase2_routes_secret_123";
const TEST_SERVER_ID = "ds_routes_001";
const TEST_ROOM_ID = "room_routes_001";
const TEST_USER_ID = "user_routes_001";

//* این تابع رُتر تستی ساده می سازد تا بدون اکسپرس بتوانیم روت ها را تست کنیم.
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
        throw new Error(`[RoutesSelfTest] Route not found: ${method} ${path}`);
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

    const error = new Error(`[RoutesSelfTest] ${message}`);
    error.data = data;
    throw error;
}

//* این تابع مرحله تست را چاپ می کند.
function printStep(title, value) {
    console.log(`\n========== ${title} ==========`);
    console.log(JSON.stringify(value, null, 2));
}

//* این تابع تست کامل روت های فاز دو را اجرا می کند.
async function runRoutesSelfTest() {
    const app = {
        locals: {}
    };

    const control = createGameServerControl({
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

    control.start();
    app.locals.gameServerControl = control;

    const router = createFakeRouter();

    const attachResult = attachGameServerControlRoutes({
        app,
        router,
        basePath: "/game-server-control"
    });

    printStep("ATTACH_ROUTES", attachResult);
    assertTest(attachResult.success === true, "Routes attach must be success.", attachResult);
    assertTest(attachResult.data.count === 10, "Routes count must be 10.", attachResult);

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

    printStep("DEDICATED_REGISTER_ROUTE", registerRes.body);
    assertTest(registerRes.statusCode === 200, "Register route status must be 200.", registerRes.body);
    assertTest(registerRes.body.success === true, "Register route must be success.", registerRes.body);

    const ticketRes = await callRoute(router, "POST", "/game-server-control/client/ticket", {
        ...baseReq,
        user: {
            userId: TEST_USER_ID,
            userName: "Routes Player"
        },
        body: {
            roomId: TEST_ROOM_ID,
            region: "eu-central"
        }
    });

    printStep("CLIENT_TICKET_ROUTE", ticketRes.body);
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
            connectionId: "conn_routes_001",
            playerId: "player_routes_001",
            userName: "Routes Player"
        }
    });

    printStep("DEDICATED_VERIFY_TICKET_ROUTE", verifyRes.body);
    assertTest(verifyRes.statusCode === 200, "Verify ticket route status must be 200.", verifyRes.body);
    assertTest(verifyRes.body.success === true, "Verify ticket route must be success.", verifyRes.body);

    const heartbeatRes = await callRoute(router, "POST", "/game-server-control/dedicated/heartbeat", {
        ...baseReq,
        body: {
            serviceToken,
            serverId: TEST_SERVER_ID,
            roomId: TEST_ROOM_ID,
            region: "eu-central",
            zone: "de-1",
            status: "online",
            fps: 60,
            tickRate: 20,
            currentPlayers: 1,
            maxPlayers: 20,
            memoryMb: 512,
            cpuPercent: 20
        }
    });

    printStep("DEDICATED_HEARTBEAT_ROUTE", heartbeatRes.body);
    assertTest(heartbeatRes.statusCode === 200, "Heartbeat route status must be 200.", heartbeatRes.body);
    assertTest(heartbeatRes.body.success === true, "Heartbeat route must be success.", heartbeatRes.body);

    const statusRes = await callRoute(router, "GET", "/game-server-control/status", {
        ...baseReq
    });

    printStep("STATUS_ROUTE", statusRes.body);
    assertTest(statusRes.statusCode === 200, "Status route status must be 200.", statusRes.body);
    assertTest(statusRes.body.data.registry.total === 1, "Registry total must be 1.", statusRes.body);
    assertTest(statusRes.body.data.sessions.totalPlayers === 1, "Session totalPlayers must be 1.", statusRes.body);

    const leftRes = await callRoute(router, "POST", "/game-server-control/dedicated/player-left", {
        ...baseReq,
        body: {
            serviceToken,
            serverId: TEST_SERVER_ID,
            sessionId: connection.sessionId,
            userId: TEST_USER_ID
        }
    });

    printStep("DEDICATED_PLAYER_LEFT_ROUTE", leftRes.body);
    assertTest(leftRes.statusCode === 200, "Player left route status must be 200.", leftRes.body);
    assertTest(leftRes.body.success === true, "Player left route must be success.", leftRes.body);
    assertTest(leftRes.body.data.session.currentPlayers === 0, "Current players must be 0 after player left.", leftRes.body);

    control.stop();

    printStep("ROUTES_SELFTEST_RESULT", {
        success: true,
        message: "GameServerControl routes selftest passed."
    });
}

try {
    await runRoutesSelfTest();
} catch (error) {
    console.error("\n========== ROUTES_SELFTEST_FAILED ==========");
    console.error(error.message);

    if (error.data) {
        console.error(JSON.stringify(error.data, null, 2));
    }

    process.exitCode = 1;
}

// این فایل فقط تست مستقل روت های ماژول کنترل گیم سرور را اجرا می کند و هنوز هیچ اتصال به استارتاپ اصلی ایجاد نمی کند.
