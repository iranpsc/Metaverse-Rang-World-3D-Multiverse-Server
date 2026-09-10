import path from "path";
import { spawn } from "child_process";

const DEFAULT_SUITE_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CORE_SUITE_TIMEOUT_MS || 120000);

const CORE_SMOKE_TESTS = [
    {
        name: "core-ping",
        file: "smokeGrpcStreamingRealtimeCorePing.js",
        env: {
            GRPC_REALTIME_CORE_PING_SMOKE_PORT: "50070"
        }
    },
    {
        name: "core-auth-token-service",
        file: "smokeGrpcStreamingRealtimeCoreAuth.js",
        env: {
            GRPC_REALTIME_CORE_AUTH_SMOKE_PORT: "50072"
        }
    },
    {
        name: "core-register-auth",
        file: "smokeGrpcStreamingRealtimeCoreRegisterAuth.js",
        env: {
            GRPC_REALTIME_CORE_REGISTER_AUTH_SMOKE_PORT: "50074"
        }
    },
    {
        name: "core-register-create-join",
        file: "smokeGrpcStreamingRealtimeCoreRegisterCreateJoin.js",
        env: {
            GRPC_REALTIME_CORE_REGISTER_CREATE_JOIN_PORT: "50076"
        }
    },
    {
        name: "core-two-client-presence",
        file: "smokeGrpcStreamingRealtimeCoreTwoClientPresence.js",
        env: {
            GRPC_REALTIME_CORE_TWO_CLIENT_PRESENCE_PORT: "50078"
        }
    },
    {
        name: "core-two-client-player-state",
        file: "smokeGrpcStreamingRealtimeCoreTwoClientPlayerState.js",
        env: {
            GRPC_REALTIME_CORE_TWO_CLIENT_PLAYER_STATE_PORT: "50080"
        }
    },
    {
        name: "cross-transport-websocket-grpc",
        file: "smokeGrpcStreamingRealtimeCrossTransport.js",
        env: {
            GRPC_REALTIME_CROSS_TRANSPORT_GRPC_PORT: "50082"
        }
    }
];

//* این تابع مسیر کامل فایل تست را از روی ریشه پروژه می‌سازد.
function resolveSmokeFilePath(fileName) {
    return path.join(process.cwd(), "src/realTime/transport/grpcStreaming", fileName);
}

//* این تابع لاگ ساده رانِر تست‌های کُر جی‌آر‌پی‌سی را چاپ می‌کند.
function logSuite(message, data = {}) {
    console.log("[G8-CoreSmokeSuite]", message, data);
}

//* این تابع لاگ خطای رانِر تست‌های کُر جی‌آر‌پی‌سی را چاپ می‌کند.
function logSuiteError(message, data = {}) {
    console.error("[G8-CoreSmokeSuite][ERROR]", message, data);
}

//* این تابع یک تست را در پروسه جداگانه اجرا می‌کند.
function runSmokeTest(testConfig) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const filePath = resolveSmokeFilePath(testConfig.file);

        logSuite("Starting core smoke test", {
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

//* این تابع همه تست‌های کُر و مسیر مشترک را پشت سر هم اجرا می‌کند.
async function runGrpcStreamingCoreSmokeSuite() {
    const startedAt = Date.now();
    const results = [];

    logSuite("Grpc streaming core smoke suite started", {
        testCount: CORE_SMOKE_TESTS.length
    });

    for (const testConfig of CORE_SMOKE_TESTS) {
        const result = await runSmokeTest(testConfig);
        results.push(result);

        if (result.ok) {
            logSuite("Core smoke test passed", {
                name: result.name,
                durationMs: result.durationMs
            });
        } else {
            logSuiteError("Core smoke test failed", {
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
    const ok = failedCount === 0 && passedCount === CORE_SMOKE_TESTS.length;

    logSuite("Grpc streaming core smoke suite finished", {
        ok,
        passedCount,
        failedCount,
        totalCount: CORE_SMOKE_TESTS.length,
        durationMs
    });

    return {
        ok,
        passedCount,
        failedCount,
        totalCount: CORE_SMOKE_TESTS.length,
        durationMs,
        results
    };
}

//* این تابع نتیجه رانِر را به کد خروجی پروسه تبدیل می‌کند.
async function main() {
    try {
        const result = await runGrpcStreamingCoreSmokeSuite();
        process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
        logSuiteError("Grpc streaming core smoke suite crashed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل رانِر تست‌های کُر واقعی و مسیر مشترک جی‌آر‌پی‌سی است.
//* این فایل تست‌های پینگ، آث، رجیستر، ساخت روم، جوین روم، پرزنس، وضعیت پلیر و مسیر مشترک وب‌سوکت با جی‌آر‌پی‌سی را اجرا می‌کند.
//* هر تست در یک پروسه جداگانه اجرا می‌شود تا وضعیت هر تست از تست بعدی جدا بماند.
//* اگر یکی از تست‌ها خطا بدهد، رانِر همان‌جا متوقف می‌شود.
//* هدف این فایل گرفتن یک نتیجه یک‌جا از مسیر واقعی جی‌آر‌پی‌سی تا کُر و مسیر مشترک وب‌سوکت است.

export {
    runGrpcStreamingCoreSmokeSuite,
    runSmokeTest
};
