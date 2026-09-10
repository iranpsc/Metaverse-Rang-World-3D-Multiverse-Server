import grpc from "@grpc/grpc-js";
import { randomUUID } from "crypto";
import { attachGrpcStreamingRealtimeCore } from "./attachGrpcStreamingRealtimeCore.js";
import { tokenService } from "../../../core/auth/auth.instance.js";

const DEFAULT_CORE_AUTH_SMOKE_PORT = Number(process.env.GRPC_REALTIME_CORE_AUTH_SMOKE_PORT || 50072);
const DEFAULT_CORE_AUTH_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CORE_AUTH_TIMEOUT_MS || 5000);

//* این آبجکت لاگ‌های ساده تست آث کُر ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-CoreAuthSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-CoreAuthSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-CoreAuthSmoke][ERROR]", message, data)
};

//* این تابع یک یوزر تستی برای ساخت توکن دسترسی آماده می‌کند.
function createSmokeUser() {
    const userId = `grpc_auth_smoke_${randomUUID()}`;

    return {
        id: userId,
        userId,
        email: `${userId}@test.local`,
        userName: `grpc_auth_${Date.now()}`
    };
}

//* این تابع با توکن سرویس پروژه، یک توکن دسترسی معتبر برای تست می‌سازد.
function createSmokeAccessToken(user) {
    return tokenService.createAccessToken(user);
}

//* این تابع یک اِنولوپ آث با ساختار فعلی ریل‌تایم می‌سازد.
function createCoreAuthRawJson(accessToken) {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "auth",
        id: `core_auth_${Date.now()}`,
        ts: Date.now(),
        room: "",
        payload: {
            accessToken
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست آث را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_CORE_AUTH_SMOKE_PORT) {
    return new Promise((resolve, reject) => {
        grpcServer.bindAsync(
            `0.0.0.0:${port}`,
            grpc.ServerCredentials.createInsecure(),
            (error, boundPort) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(boundPort);
            }
        );
    });
}

//* این تابع کلاینت جی‌آر‌پی‌سی موقت را از روی پروتوی لودشده می‌سازد.
function createSmokeClient(protoRoot, port = DEFAULT_CORE_AUTH_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک اِنولوپ آث را روی اوپن اِستریم می‌فرستد و پاسخ آث را دریافت می‌کند.
function runOpenStreamCoreAuthSmoke(client, authRawJson) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Core auth smoke timed out after ${DEFAULT_CORE_AUTH_TIMEOUT_MS}ms`));
        }, DEFAULT_CORE_AUTH_TIMEOUT_MS);

        call.on("data", (frame) => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            call.end();
            resolve(frame?.rawJson ?? "");
        });

        call.on("error", (error) => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            reject(error);
        });

        call.on("end", () => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            resolve("");
        });

        call.write({ rawJson: authRawJson });
    });
}

//* این تابع بررسی می‌کند پاسخ برگشتی از کُر واقعی همان آث اوکی درست باشد.
function assertCoreAuthOkResponse({ user, authRawJson, authOkRawJson }) {
    if (!authOkRawJson) {
        throw new Error("Core auth smoke did not receive auth ok rawJson");
    }

    const authEnvelope = JSON.parse(authRawJson);
    const authOkEnvelope = JSON.parse(authOkRawJson);

    if (authOkEnvelope.ch !== "system") {
        throw new Error(`Core auth smoke expected system channel but got ${authOkEnvelope.ch}`);
    }

    if (authOkEnvelope.t !== "auth_ok") {
        throw new Error(`Core auth smoke expected auth_ok type but got ${authOkEnvelope.t}`);
    }

    if (authOkEnvelope.replyTo !== authEnvelope.id) {
        throw new Error("Core auth smoke auth_ok replyTo does not match auth id");
    }

    if (authOkEnvelope.payload?.ok !== true) {
        throw new Error("Core auth smoke auth_ok payload ok is not true");
    }

    if (authOkEnvelope.payload?.userId !== user.userId) {
        throw new Error("Core auth smoke auth_ok userId does not match test user");
    }

    if (authOkEnvelope.payload?.userName !== user.userName) {
        throw new Error("Core auth smoke auth_ok userName does not match test user");
    }

    return true;
}

//* این تابع کل تست آث واقعی کُر ریل‌تایم را از ساخت سرور تا کنترل پاسخ اجرا می‌کند.
async function runGrpcStreamingRealtimeCoreAuthSmoke() {
    const grpcServer = new grpc.Server();
    let attachResult = null;

    try {
        const user = createSmokeUser();
        const accessToken = createSmokeAccessToken(user);

        attachResult = attachGrpcStreamingRealtimeCore({
            grpcServer,
            logger,
            tokenService
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_CORE_AUTH_SMOKE_PORT);
        const client = createSmokeClient(attachResult.protoRoot, boundPort);
        const authRawJson = createCoreAuthRawJson(accessToken);
        const authOkRawJson = await runOpenStreamCoreAuthSmoke(client, authRawJson);

        await delay(150);

        assertCoreAuthOkResponse({
            user,
            authRawJson,
            authOkRawJson
        });

        logger.info("Grpc streaming realtime core auth smoke passed", {
            port: boundPort,
            userId: user.userId,
            authLength: authRawJson.length,
            authOkLength: authOkRawJson.length,
            stats: attachResult.getStats()
        });

        return true;
    } finally {
        attachResult?.stop?.();
        grpcServer.forceShutdown();
    }
}

//* این تابع خط فرمان تست آث کُر را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCoreAuthSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime core auth smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل آث واقعی از مسیر جی‌آر‌پی‌سی به کُر ریل‌تایم است.
//* این تست یک توکن دسترسی معتبر با توکن سرویس پروژه می‌سازد.
//* سپس یک سرور جی‌آر‌پی‌سی موقت می‌سازد و اتصال‌دهنده جی‌آر‌پی‌سی به کُر را اجرا می‌کند.
//* بعد یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد و اِنولوپ آث را روی اوپن اِستریم ارسال می‌کند.
//* پیام آث از ترنسپورت جی‌آر‌پی‌سی وارد کُر واقعی، پَرس اِنولوپ، رُتِر سیستم و هندلر آث می‌شود.
//* هندلر آث توکن را با توکن سرویس بررسی می‌کند و در صورت موفقیت پاسخ آث اوکی می‌فرستد.
//* هدف این فایل بررسی آث واقعی جی‌آر‌پی‌سی بدون تغییر مسیر وب‌سوکت است.

export {
    runGrpcStreamingRealtimeCoreAuthSmoke,
    createSmokeUser,
    createSmokeAccessToken,
    createCoreAuthRawJson,
    assertCoreAuthOkResponse
};
