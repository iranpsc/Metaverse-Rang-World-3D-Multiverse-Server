import grpc from "@grpc/grpc-js";
import { attachGrpcStreamingRealtimeCore } from "./attachGrpcStreamingRealtimeCore.js";

const DEFAULT_CORE_PING_SMOKE_PORT = Number(process.env.GRPC_REALTIME_CORE_PING_SMOKE_PORT || 50070);
const DEFAULT_CORE_PING_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CORE_PING_TIMEOUT_MS || 5000);

//* این آبجکت لاگ‌های ساده تست پینگ کُر ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-CorePingSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-CorePingSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-CorePingSmoke][ERROR]", message, data)
};

//* این تابع یک اِنولوپ پینگ با ساختار فعلی ریل‌تایم می‌سازد.
function createCorePingRawJson() {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "ping",
        id: `core_ping_${Date.now()}`,
        ts: Date.now(),
        room: "",
        payload: {
            source: "grpc_core_ping_smoke"
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست کُر را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_CORE_PING_SMOKE_PORT) {
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
function createSmokeClient(protoRoot, port = DEFAULT_CORE_PING_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک پینگ را روی اوپن اِستریم می‌فرستد و پاسخ پونگ را از کُر واقعی دریافت می‌کند.
function runOpenStreamCorePingSmoke(client, pingRawJson) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Core ping smoke timed out after ${DEFAULT_CORE_PING_TIMEOUT_MS}ms`));
        }, DEFAULT_CORE_PING_TIMEOUT_MS);

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

        call.write({ rawJson: pingRawJson });
    });
}

//* این تابع بررسی می‌کند پاسخ برگشتی از کُر واقعی همان پونگ درست باشد.
function assertCorePongResponse({ pingRawJson, pongRawJson }) {
    if (!pongRawJson) {
        throw new Error("Core ping smoke did not receive pong rawJson");
    }

    const pingEnvelope = JSON.parse(pingRawJson);
    const pongEnvelope = JSON.parse(pongRawJson);

    if (pongEnvelope.ch !== "system") {
        throw new Error(`Core ping smoke expected system channel but got ${pongEnvelope.ch}`);
    }

    if (pongEnvelope.t !== "pong") {
        throw new Error(`Core ping smoke expected pong type but got ${pongEnvelope.t}`);
    }

    if (pongEnvelope.replyTo !== pingEnvelope.id) {
        throw new Error("Core ping smoke pong replyTo does not match ping id");
    }

    return true;
}

//* این تابع کل تست پینگ واقعی کُر ریل‌تایم را از ساخت سرور تا کنترل پاسخ اجرا می‌کند.
async function runGrpcStreamingRealtimeCorePingSmoke() {
    const grpcServer = new grpc.Server();
    let attachResult = null;

    try {
        attachResult = attachGrpcStreamingRealtimeCore({
            grpcServer,
            logger
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_CORE_PING_SMOKE_PORT);
        const client = createSmokeClient(attachResult.protoRoot, boundPort);
        const pingRawJson = createCorePingRawJson();
        const pongRawJson = await runOpenStreamCorePingSmoke(client, pingRawJson);

        await delay(150);

        assertCorePongResponse({
            pingRawJson,
            pongRawJson
        });

        logger.info("Grpc streaming realtime core ping smoke passed", {
            port: boundPort,
            pingLength: pingRawJson.length,
            pongLength: pongRawJson.length,
            stats: attachResult.getStats()
        });

        return true;
    } finally {
        attachResult?.stop?.();
        grpcServer.forceShutdown();
    }
}

//* این تابع خط فرمان تست پینگ کُر را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCorePingSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime core ping smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل ورود مسیر جی‌آر‌پی‌سی به کُر واقعی ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و اتصال‌دهنده جی‌آر‌پی‌سی به کُر را اجرا می‌کند.
//* سپس یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد و یک اِنولوپ پینگ را روی اوپن اِستریم ارسال می‌کند.
//* پیام پینگ از ترنسپورت جی‌آر‌پی‌سی وارد کُر واقعی، پَرس اِنولوپ و رُتِر واقعی می‌شود.
//* هندلر پینگ سیستم پاسخ پونگ می‌سازد و همان پاسخ از مسیر جی‌آر‌پی‌سی به کلاینت برمی‌گردد.
//* هدف این فایل بررسی اولین اتصال واقعی جی‌آر‌پی‌سی به کُر ریل‌تایم بدون تغییر مسیر وب‌سوکت است.

export {
    runGrpcStreamingRealtimeCorePingSmoke,
    createCorePingRawJson,
    assertCorePongResponse
};
