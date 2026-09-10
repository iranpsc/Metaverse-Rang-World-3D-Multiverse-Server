// File => src/gameServerControl/http/gameServerControlRawHttpAdapter.selftest.js

import { Readable } from "stream";

import { createGameServerControl } from "../index.js";
import {
    createGameServerControlRawHttpAdapter,
    getGameServerControlRawHttpRoutes
} from "./gameServerControlRawHttpAdapter.js";

const TEST_SECRET = "phase2_raw_http_adapter_secret_123";
const TEST_SERVER_ID = "ds_raw_http_001";
const TEST_ROOM_ID = "room_raw_http_001";
const TEST_USER_ID = "user_raw_http_001";

//* این تابع درخواست خام تستی می سازد.
function createFakeRequest({ method = "GET", url = "/", headers = {}, body = null, user = null } = {}) {
    const rawBody = body === null ? "" : JSON.stringify(body);
    const req = Readable.from(rawBody);

    req.method = method;
    req.url = url;
    req.headers = {
        host: "localhost",
        "content-type": "application/json",
        ...headers
    };

    if (user) {
        req.user = user;
    }

    return req;
}

//* این تابع پاسخ خام تستی می سازد.
function createFakeResponse() {
    return {
        statusCode: 200,
        headers: {},
        rawBody: "",

        writeHead(statusCode, headers = {}) {
            this.statusCode = statusCode;
            this.headers = headers;
        },

        end(body = "") {
            this.rawBody = String(body);
        },

        json() {
            return this.rawBody ? JSON.parse(this.rawBody) : null;
        }
    };
}

//* این تابع اَدَپتر خام را با درخواست تستی صدا می زند.
async function callAdapter(adapter, requestOptions) {
    const req = createFakeRequest(requestOptions);
    const res = createFakeResponse();

    const handled = await adapter(req, res);

    return {
        handled,
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.json()
    };
}

//* این تابع شرط تست را بررسی می کند.
function assertTest(condition, message, data = {}) {
    if (condition) return;

    const error = new Error(`[RawHttpAdapterSelfTest] ${message}`);
    error.data = data;
    throw error;
}

//* این تابع مرحله تست را چاپ می کند.
function printStep(title, value) {
    console.log(`\n========== ${title} ==========`);
    console.log(JSON.stringify(value, null, 2));
}

//* این تابع تست کامل اَدَپتر خام اچ تی تی پی را اجرا می کند.
async function runRawHttpAdapterSelfTest() {
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

    const adapter = createGameServerControlRawHttpAdapter({
        control,
        allowClientUserIdFromBody: true
    });

    const routes = getGameServerControlRawHttpRoutes();

    printStep("RAW_HTTP_ROUTES", {
        count: routes.length,
        routes: routes.map((route) => ({
            method: route.method,
            path: route.path
        }))
    });

    assertTest(routes.length === 10, "Raw HTTP route count must be 10.", routes);

    const serviceToken = control.serviceTokenService.createToken({
        serverId: TEST_SERVER_ID
    });

    const registerRes = await callAdapter(adapter, {
        method: "POST",
        url: "/game-server-control/dedicated/register",
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

    printStep("RAW_HTTP_DEDICATED_REGISTER", registerRes.body);
    assertTest(registerRes.handled === true, "Register route must be handled.", registerRes);
    assertTest(registerRes.statusCode === 200, "Register status must be 200.", registerRes);
    assertTest(registerRes.body.success === true, "Register must be success.", registerRes.body);

    const ticketRes = await callAdapter(adapter, {
        method: "POST",
        url: "/game-server-control/client/ticket",
        body: {
            userId: TEST_USER_ID,
            roomId: TEST_ROOM_ID,
            region: "eu-central"
        }
    });

    printStep("RAW_HTTP_CLIENT_TICKET", ticketRes.body);
    assertTest(ticketRes.statusCode === 200, "Ticket status must be 200.", ticketRes);
    assertTest(ticketRes.body.success === true, "Ticket must be success.", ticketRes.body);

    const ticket = ticketRes.body.data.ticket;
    const connection = ticketRes.body.data.connection;

    const verifyRes = await callAdapter(adapter, {
        method: "POST",
        url: "/game-server-control/dedicated/verify-ticket",
        body: {
            serviceToken,
            serverId: connection.serverId,
            roomId: connection.roomId,
            userId: TEST_USER_ID,
            ticketId: ticket.ticketId,
            signature: ticket.signature,
            sessionId: connection.sessionId,
            connectionId: "conn_raw_http_001",
            playerId: "player_raw_http_001",
            userName: "Raw Http Player"
        }
    });

    printStep("RAW_HTTP_VERIFY_TICKET", verifyRes.body);
    assertTest(verifyRes.statusCode === 200, "Verify status must be 200.", verifyRes);
    assertTest(verifyRes.body.success === true, "Verify must be success.", verifyRes.body);

    const heartbeatRes = await callAdapter(adapter, {
        method: "POST",
        url: "/game-server-control/dedicated/heartbeat",
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

    printStep("RAW_HTTP_HEARTBEAT", heartbeatRes.body);
    assertTest(heartbeatRes.statusCode === 200, "Heartbeat status must be 200.", heartbeatRes);
    assertTest(heartbeatRes.body.success === true, "Heartbeat must be success.", heartbeatRes.body);

    const statusRes = await callAdapter(adapter, {
        method: "GET",
        url: "/game-server-control/status"
    });

    printStep("RAW_HTTP_STATUS", statusRes.body);
    assertTest(statusRes.statusCode === 200, "Status route must be 200.", statusRes);
    assertTest(statusRes.body.data.registry.total === 1, "Registry total must be 1.", statusRes.body);
    assertTest(statusRes.body.data.sessions.totalPlayers === 1, "Session totalPlayers must be 1.", statusRes.body);

    const notHandledRes = await callAdapter(adapter, {
        method: "GET",
        url: "/health"
    });

    printStep("RAW_HTTP_NOT_HANDLED", notHandledRes);
    assertTest(notHandledRes.handled === false, "Non GameServerControl path must not be handled.", notHandledRes);

    control.stop();

    printStep("RAW_HTTP_ADAPTER_SELFTEST_RESULT", {
        success: true,
        message: "GameServerControl raw HTTP adapter selftest passed."
    });
}

try {
    await runRawHttpAdapterSelfTest();
} catch (error) {
    console.error("\n========== RAW_HTTP_ADAPTER_SELFTEST_FAILED ==========");
    console.error(error.message);

    if (error.data) {
        console.error(JSON.stringify(error.data, null, 2));
    }

    process.exitCode = 1;
}

// این فایل فقط تست مستقل اَدَپتر خام اچ تی تی پی کنترل گیم سرور را اجرا می کند و هنوز استارتاپ اصلی را تغییر نمی دهد.
