// File => src/gameServerControl/http/gameServerControlRawHttpAdapter.disabled.selftest.js

import { Readable } from "stream";

import { createGameServerControl } from "../index.js";
import { createGameServerControlRawHttpAdapter } from "./gameServerControlRawHttpAdapter.js";

//* این تابع درخواست خام تستی می سازد.
function createFakeRequest({ method = "GET", url = "/", headers = {}, body = null } = {}) {
    const rawBody = body === null ? "" : JSON.stringify(body);
    const req = Readable.from(rawBody);

    req.method = method;
    req.url = url;
    req.headers = {
        host: "localhost",
        "content-type": "application/json",
        ...headers
    };

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
        body: res.json()
    };
}

//* این تابع شرط تست را بررسی می کند.
function assertTest(condition, message, data = {}) {
    if (condition) return;

    const error = new Error(`[RawHttpAdapterDisabledSelfTest] ${message}`);
    error.data = data;
    throw error;
}

//* این تابع مرحله تست را چاپ می کند.
function printStep(title, value) {
    console.log(`\n========== ${title} ==========`);
    console.log(JSON.stringify(value, null, 2));
}

//* این تابع تست حالت خاموش بودن کنترل گیم سرور را اجرا می کند.
async function runDisabledSelfTest() {
    const control = createGameServerControl({
        config: {
            enabled: false,
            defaultHost: "127.0.0.1",
            defaultPort: 7777,
            ticketTtlSeconds: 60,
            heartbeatTimeoutSeconds: 15,
            maxPlayersPerInstance: 20,
            cleanupIntervalSeconds: 10,
            serviceSecret: "disabled_guard_secret_123"
        }
    });

    const adapter = createGameServerControlRawHttpAdapter({
        control
    });

    const statusRes = await callAdapter(adapter, {
        method: "GET",
        url: "/game-server-control/status"
    });

    printStep("DISABLED_STATUS_ALLOWED", statusRes);

    assertTest(statusRes.handled === true, "Status route must be handled.", statusRes);
    assertTest(statusRes.statusCode === 200, "Status route must return 200.", statusRes);
    assertTest(statusRes.body.success === true, "Status route must be success.", statusRes.body);
    assertTest(statusRes.body.data.started === false, "Status must show started=false.", statusRes.body);

    const registerRes = await callAdapter(adapter, {
        method: "POST",
        url: "/game-server-control/dedicated/register",
        body: {
            serviceToken: "fake",
            serverId: "ds_disabled_001"
        }
    });

    printStep("DISABLED_REGISTER_BLOCKED", registerRes);

    assertTest(registerRes.handled === true, "Register route must be handled.", registerRes);
    assertTest(registerRes.statusCode === 503, "Register route must return 503 when disabled.", registerRes);
    assertTest(registerRes.body.success === false, "Register route must fail when disabled.", registerRes.body);
    assertTest(registerRes.body.reason === "game_server_control_disabled", "Register route must fail with disabled reason.", registerRes.body);

    printStep("RAW_HTTP_ADAPTER_DISABLED_SELFTEST_RESULT", {
        success: true,
        message: "GameServerControl raw HTTP adapter disabled selftest passed."
    });
}

try {
    await runDisabledSelfTest();
} catch (error) {
    console.error("\n========== RAW_HTTP_ADAPTER_DISABLED_SELFTEST_FAILED ==========");
    console.error(error.message);

    if (error.data) {
        console.error(JSON.stringify(error.data, null, 2));
    }

    process.exitCode = 1;
}

// این فایل فقط بررسی می کند وقتی کنترل گیم سرور خاموش است، فقط مسیر استاتوس فعال بماند.
