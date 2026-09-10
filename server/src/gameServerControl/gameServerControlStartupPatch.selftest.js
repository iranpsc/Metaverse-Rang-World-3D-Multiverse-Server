// File => src/gameServerControl/gameServerControlStartupPatch.selftest.js

import {
    attachGameServerControlHttpApi,
    detachGameServerControlHttpApi,
    getGameServerControlHttpApiStatus
} from "./gameServerControlHttpApi.js";

const TEST_SECRET = "phase2_startup_patch_secret_123";

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

//* این تابع اپ تستی شبیه اکسپرس می سازد.
function createFakeApp() {
    return {
        locals: {}
    };
}

//* این تابع شرط تست را بررسی می کند.
function assertTest(condition, message, data = {}) {
    if (condition) return;

    const error = new Error(`[StartupPatchSelfTest] ${message}`);
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

//* این تابع کانفیگ تستی را می سازد.
function createTestConfig(enabled) {
    return {
        enabled,
        defaultHost: "127.0.0.1",
        defaultPort: 7777,
        ticketTtlSeconds: 60,
        heartbeatTimeoutSeconds: 15,
        maxPlayersPerInstance: 20,
        cleanupIntervalSeconds: 10,
        serviceSecret: TEST_SECRET
    };
}

//* این تابع حالت خاموش بودن ماژول را شبیه سازی می کند.
function testDisabledStartupAttach() {
    const app = createFakeApp();
    const router = createFakeRouter();

    const result = attachGameServerControlHttpApi({
        app,
        router,
        basePath: "/game-server-control",
        config: createTestConfig(false)
    });

    printStep("DISABLED_ATTACH", result);

    assertTest(result.success === true, "Disabled attach must be success.", result);
    assertTest(result.data.routesAttached === false, "Routes must not attach when disabled.", result);
    assertTest(!!app.locals.gameServerControl, "Control must exist on app.locals even when disabled.", result);
    assertTest(app.locals.gameServerControl.started === false, "Control must not start when disabled.", result);
    assertTest(router.routes.length === 0, "Route count must be 0 when disabled.", router.routes);

    const status = getGameServerControlHttpApiStatus({ app, router });
    printStep("DISABLED_STATUS", status);

    assertTest(status.data.hasControl === true, "Disabled status must have control.", status);
    assertTest(status.data.started === false, "Disabled status must not be started.", status);

    const detach = detachGameServerControlHttpApi({ app });
    printStep("DISABLED_DETACH", detach);

    assertTest(detach.success === true, "Disabled detach must be success.", detach);
    assertTest(!app.locals.gameServerControl, "Control must be removed after disabled detach.", detach);
}

//* این تابع حالت روشن بودن ماژول بدون نصب روت را شبیه سازی می کند.
function testEnabledWithoutRoutesStartupAttach() {
    const app = createFakeApp();
    const router = createFakeRouter();

    const result = attachGameServerControlHttpApi({
        app,
        router,
        basePath: "/game-server-control",
        attachRoutes: false,
        config: createTestConfig(true)
    });

    printStep("ENABLED_WITHOUT_ROUTES_ATTACH", result);

    assertTest(result.success === true, "Enabled attach without routes must be success.", result);
    assertTest(result.data.routesAttached === false, "Routes must not attach when attachRoutes=false.", result);
    assertTest(!!app.locals.gameServerControl, "Control must exist on app.locals.", result);
    assertTest(app.locals.gameServerControl.started === true, "Control must start when enabled.", result);
    assertTest(router.routes.length === 0, "Route count must be 0 when attachRoutes=false.", router.routes);

    const detach = detachGameServerControlHttpApi({ app });
    printStep("ENABLED_WITHOUT_ROUTES_DETACH", detach);

    assertTest(detach.success === true, "Enabled without routes detach must be success.", detach);
    assertTest(!app.locals.gameServerControl, "Control must be removed after detach.", detach);
}

//* این تابع حالت روشن بودن ماژول با نصب روت را شبیه سازی می کند.
function testEnabledWithRoutesStartupAttach() {
    const app = createFakeApp();
    const router = createFakeRouter();

    const result = attachGameServerControlHttpApi({
        app,
        router,
        basePath: "/game-server-control",
        config: createTestConfig(true)
    });

    printStep("ENABLED_WITH_ROUTES_ATTACH", result);

    assertTest(result.success === true, "Enabled attach with routes must be success.", result);
    assertTest(result.data.routesAttached === true, "Routes must attach when enabled.", result);
    assertTest(result.data.routesResult.count === 10, "Route count must be 10.", result);
    assertTest(!!app.locals.gameServerControl, "Control must exist on app.locals.", result);
    assertTest(app.locals.gameServerControl.started === true, "Control must start when enabled.", result);
    assertTest(router.routes.length === 10, "Router must have 10 routes.", router.routes);

    const status = getGameServerControlHttpApiStatus({ app, router });
    printStep("ENABLED_WITH_ROUTES_STATUS", status);

    assertTest(status.data.hasControl === true, "Enabled status must have control.", status);
    assertTest(status.data.started === true, "Enabled status must be started.", status);
    assertTest(status.data.canAttachRoutes === true, "Enabled status must support routes.", status);

    const detach = detachGameServerControlHttpApi({ app });
    printStep("ENABLED_WITH_ROUTES_DETACH", detach);

    assertTest(detach.success === true, "Enabled with routes detach must be success.", detach);
    assertTest(!app.locals.gameServerControl, "Control must be removed after detach.", detach);
}

//* این تابع تست کامل شبیه سازی استارتاپ فاز دو را اجرا می کند.
async function runStartupPatchSelfTest() {
    testDisabledStartupAttach();
    testEnabledWithoutRoutesStartupAttach();
    testEnabledWithRoutesStartupAttach();

    printStep("STARTUP_PATCH_SELFTEST_RESULT", {
        success: true,
        message: "GameServerControl startup patch selftest passed."
    });
}

try {
    await runStartupPatchSelfTest();
} catch (error) {
    console.error("\n========== STARTUP_PATCH_SELFTEST_FAILED ==========");
    console.error(error.message);

    if (error.data) {
        console.error(safeJsonStringify(error.data));
    }

    process.exitCode = 1;
}

// این فایل فقط شبیه سازی اتصال ماژول کنترل گیم سرور به استارتاپ را تست می کند و هنوز هیچ تغییر در فایل استارتاپ اصلی ایجاد نمی کند.
