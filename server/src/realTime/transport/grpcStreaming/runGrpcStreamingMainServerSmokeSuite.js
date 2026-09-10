import path from "path";
import { spawn } from "child_process";

const DEFAULT_TEST_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_MAIN_SERVER_SUITE_TEST_TIMEOUT_MS || 45000);

const MAIN_SERVER_SMOKE_TESTS = [
    {
        name: "main-server-ping",
        file: "smokeGrpcStreamingRealtimeMainServerPing.js"
    },
    {
        name: "main-server-register-auth",
        file: "smokeGrpcStreamingRealtimeMainServerRegisterAuth.js"
    },
    {
        name: "main-server-register-create-join",
        file: "smokeGrpcStreamingRealtimeMainServerRegisterCreateJoin.js"
    },
    {
        name: "main-server-two-client-presence",
        file: "smokeGrpcStreamingRealtimeMainServerTwoClientPresence.js"
    },
    {
        name: "main-server-two-client-player-state",
        file: "smokeGrpcStreamingRealtimeMainServerTwoClientPlayerState.js"
    },
    {
        name: "main-server-cross-transport",
        file: "smokeGrpcStreamingRealtimeMainServerCrossTransport.js"
    }
];

//* این تابع مسیر کامل فایل تست را از روی ریشه پروژه می‌سازد.
function resolveSmokeFilePath(fileName) {
    return path.join(process.cwd(), "src/realTime/transport/grpcStreaming", fileName);
}

//* این تابع لاگ ساده رانِر نهایی سرور اصلی را چاپ می‌کند.
function logSuite(message, data = {}) {
    console.log("[G8-MainServerSmokeSuite]", message, data);
}

//* این تابع لاگ خطای رانِر نهایی سرور اصلی را چاپ می‌کند.
function logSuiteError(message, data = {}) {
    console.error("[G8-MainServerSmokeSuite][ERROR]", message, data);
}

//* این تابع یک تست را در پروسه جدا اجرا می‌کند.
function runSmokeTest(testConfig) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const filePath = resolveSmokeFilePath(testConfig.file);

        logSuite("Starting main server smoke test", {
            name: testConfig.name,
            file: testConfig.file
        });

        const child = spawn(process.execPath, [filePath], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                GRPC_REALTIME_MAIN_SERVER_TARGET: process.env.GRPC_REALTIME_MAIN_SERVER_TARGET || "127.0.0.1:50051",
                WS_REALTIME_MAIN_SERVER_URL: process.env.WS_REALTIME_MAIN_SERVER_URL || "ws://127.0.0.1:8080"
            },
            stdio: "inherit"
        });

        let finished = false;

        const timeout = setTimeout(() => {
            if (finished) return;

            finished = true;
            child.kill("SIGTERM");

            const durationMs = Date.now() - startedAt;

            resolve({
                name: testConfig.name,
                file: testConfig.file,
                ok: false,
                code: null,
                signal: "timeout",
                durationMs,
                error: `Smoke test timed out after ${DEFAULT_TEST_TIMEOUT_MS}ms`
            });
        }, DEFAULT_TEST_TIMEOUT_MS);

        child.on("exit", (code, signal) => {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);

            const durationMs = Date.now() - startedAt;
            const ok = code === 0;

            resolve({
                name: testConfig.name,
                file: testConfig.file,
                ok,
                code,
                signal,
                durationMs,
                error: ok ? "" : `Smoke test exited with code ${code} and signal ${signal ?? ""}`
            });
        });

        child.on("error", (error) => {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);

            const durationMs = Date.now() - startedAt;

            resolve({
                name: testConfig.name,
                file: testConfig.file,
                ok: false,
                code: null,
                signal: "spawn_error",
                durationMs,
                error: error?.message ?? String(error)
            });
        });
    });
}

//* این تابع همه تست‌های سرور اصلی را پشت سر هم اجرا می‌کند.
async function runGrpcStreamingMainServerSmokeSuite() {
    const startedAt = Date.now();
    const results = [];

    logSuite("Grpc streaming main server smoke suite started", {
        testCount: MAIN_SERVER_SMOKE_TESTS.length,
        grpcTarget: process.env.GRPC_REALTIME_MAIN_SERVER_TARGET || "127.0.0.1:50051",
        wsUrl: process.env.WS_REALTIME_MAIN_SERVER_URL || "ws://127.0.0.1:8080"
    });

    for (const testConfig of MAIN_SERVER_SMOKE_TESTS) {
        const result = await runSmokeTest(testConfig);
        results.push(result);

        if (result.ok) {
            logSuite("Main server smoke test passed", {
                name: result.name,
                durationMs: result.durationMs
            });
        } else {
            logSuiteError("Main server smoke test failed", {
                name: result.name,
                durationMs: result.durationMs,
                error: result.error
            });
            break;
        }
    }

    const durationMs = Date.now() - startedAt;
    const passedCount = results.filter((result) => result.ok).length;
    const failedCount = results.filter((result) => !result.ok).length;
    const ok = failedCount === 0 && passedCount === MAIN_SERVER_SMOKE_TESTS.length;

    logSuite("Grpc streaming main server smoke suite finished", {
        ok,
        passedCount,
        failedCount,
        totalCount: MAIN_SERVER_SMOKE_TESTS.length,
        durationMs
    });

    return {
        ok,
        passedCount,
        failedCount,
        totalCount: MAIN_SERVER_SMOKE_TESTS.length,
        durationMs,
        results
    };
}

//* این تابع نتیجه رانِر را به کد خروجی پروسه تبدیل می‌کند.
async function main() {
    try {
        const result = await runGrpcStreamingMainServerSmokeSuite();
        process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
        logSuiteError("Grpc streaming main server smoke suite crashed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل رانِر نهایی تست‌های سرور اصلی جی‌آر‌پی‌سی ریل‌تایم است.
//* این فایل سرور جدید نمی‌سازد و فرض می‌کند سرور اصلی با پی‌اِم‌تو روشن است.
//* تست‌ها شامل پینگ، رجیستر و آث، ساخت روم و جوین، پرزنس دو کاربر، وضعیت پلیر و مسیر مشترک وب‌سوکت با جی‌آر‌پی‌سی هستند.
//* هر تست در یک پروسه جدا اجرا می‌شود تا وضعیت تست‌ها روی هم اثر نگذارد.
//* اگر یک تست خطا بدهد، رانِر متوقف می‌شود.
//* اگر همه تست‌ها پاس شوند، سمت سرور برای مسیر جی‌آر‌پی‌سی ریل‌تایم آماده ورود به یونیتی است.

export {
    runGrpcStreamingMainServerSmokeSuite,
    runSmokeTest
};
