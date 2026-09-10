// File => src/realTime/transport/grpcStreaming/runGrpcStreamingSmokeSuite.js

import path from "path";
import { spawn } from "child_process";

const DEFAULT_SUITE_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_SUITE_TIMEOUT_MS || 90000);
const DEFAULT_HOLD_DURATION_MS = String(process.env.GRPC_REALTIME_HOLD_DURATION_MS || 45000);

const SMOKE_TESTS = [
    {
        name: "single-message",
        file: "smokeGrpcStreamingRealtime.js",
        env: {
            GRPC_REALTIME_SMOKE_PORT: "50061"
        }
    },
    {
        name: "multi-message",
        file: "smokeGrpcStreamingRealtimeMultiMessage.js",
        env: {
            GRPC_REALTIME_MULTI_SMOKE_PORT: "50062",
            GRPC_REALTIME_MULTI_MESSAGE_COUNT: "5"
        }
    },
    {
        name: "disconnect-cleanup",
        file: "smokeGrpcStreamingRealtimeDisconnect.js",
        env: {
            GRPC_REALTIME_DISCONNECT_SMOKE_PORT: "50063"
        }
    },
    {
        name: "cancel-cleanup",
        file: "smokeGrpcStreamingRealtimeCancel.js",
        env: {
            GRPC_REALTIME_CANCEL_SMOKE_PORT: "50064"
        }
    },
    {
        name: "concurrent-streams",
        file: "smokeGrpcStreamingRealtimeConcurrent.js",
        env: {
            GRPC_REALTIME_CONCURRENT_SMOKE_PORT: "50066",
            GRPC_REALTIME_CONCURRENT_CLIENT_COUNT: "10",
            GRPC_REALTIME_CONCURRENT_MESSAGES_PER_CLIENT: "10"
        }
    },
    {
        name: "hold-45s",
        file: "smokeGrpcStreamingRealtimeHold.js",
        env: {
            GRPC_REALTIME_HOLD_SMOKE_PORT: "50068",
            GRPC_REALTIME_HOLD_DURATION_MS: DEFAULT_HOLD_DURATION_MS,
            GRPC_REALTIME_HOLD_PING_INTERVAL_MS: "5000"
        }
    }
];

//* این تابع مسیر کامل فایل تست را از روی مسیر همین رانِر می‌سازد.
function resolveSmokeFilePath(fileName) {
    return path.join(process.cwd(), "src/realTime/transport/grpcStreaming", fileName);
}

//* این تابع یک پیام لاگ ساده برای رانِر تست‌های جی‌آر‌پی‌سی چاپ می‌کند.
function logSuite(message, data = {}) {
    console.log("[G8-SmokeSuite]", message, data);
}

//* این تابع یک پیام خطای ساده برای رانِر تست‌های جی‌آر‌پی‌سی چاپ می‌کند.
function logSuiteError(message, data = {}) {
    console.error("[G8-SmokeSuite][ERROR]", message, data);
}

//* این تابع یک تست Smoke را به صورت پروسه جداگانه اجرا می‌کند.
function runSmokeTest(testConfig) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const filePath = resolveSmokeFilePath(testConfig.file);

        logSuite("Starting smoke test", {
            name: testConfig.name,
            file: testConfig.file
        });

        const child = spawn(process.execPath, [filePath], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                ...testConfig.env
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
                error: `Smoke test timed out after ${DEFAULT_SUITE_TIMEOUT_MS}ms`
            });
        }, DEFAULT_SUITE_TIMEOUT_MS);

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

//* این تابع همه تست‌های Smoke جی‌آر‌پی‌سی را پشت سر هم اجرا می‌کند.
async function runGrpcStreamingSmokeSuite() {
    const startedAt = Date.now();
    const results = [];

    logSuite("Grpc streaming smoke suite started", {
        testCount: SMOKE_TESTS.length
    });

    for (const testConfig of SMOKE_TESTS) {
        const result = await runSmokeTest(testConfig);
        results.push(result);

        if (result.ok) {
            logSuite("Smoke test passed", {
                name: result.name,
                durationMs: result.durationMs
            });
        } else {
            logSuiteError("Smoke test failed", {
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
    const ok = failedCount === 0 && passedCount === SMOKE_TESTS.length;

    logSuite("Grpc streaming smoke suite finished", {
        ok,
        passedCount,
        failedCount,
        totalCount: SMOKE_TESTS.length,
        durationMs
    });

    return {
        ok,
        passedCount,
        failedCount,
        totalCount: SMOKE_TESTS.length,
        durationMs,
        results
    };
}

//* این تابع نتیجه تست‌ها را به کد خروجی پروسه تبدیل می‌کند.
async function main() {
    try {
        const result = await runGrpcStreamingSmokeSuite();
        process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
        logSuiteError("Grpc streaming smoke suite crashed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل رانِر مستقل تست‌های جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این فایل تست‌ها را import نمی‌کند، چون هر فایل Smoke خودش main دارد و با import شدن اجرا می‌شود.
//* هر تست با یک پروسه جداگانه node اجرا می‌شود.
//* تست‌ها پشت سر هم اجرا می‌شوند و اگر یکی خطا بدهد، رانِر همان‌جا متوقف می‌شود.
//* هدف این فایل اجرای یک‌جای مسیرهای single-message، multi-message، disconnect، cancel، concurrent و hold برای ترنسپورت جی‌آر‌پی‌سی است.

export {
    runGrpcStreamingSmokeSuite,
    runSmokeTest
};
