// File => src/realTime/transport/grpcStreaming/smokeGrpcStreamingRealtime.js

import grpc from "@grpc/grpc-js";
import { setupGrpcStreamingRealtime } from "./setupGrpcStreamingRealtime.js";

const DEFAULT_SMOKE_PORT = Number(process.env.GRPC_REALTIME_SMOKE_PORT || 50061);

//* این آبجکت لاگ‌های ساده تست جی‌آر‌پی‌سی ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-Smoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-Smoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-Smoke][ERROR]", message, data)
};

//* این تابع یک پیام تست خام با ساختار اِنولوپ فعلی پروژه می‌سازد.
function createSmokeRawJson() {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "ping",
        id: `smoke_ping_${Date.now()}`,
        ts: Date.now(),
        room: "",
        payload: {
            source: "grpc_stream_smoke"
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_SMOKE_PORT) {
    return new Promise((resolve, reject) => {
        grpcServer.bindAsync(
            `0.0.0.0:${port}`,
            grpc.ServerCredentials.createInsecure(),
            (error, boundPort) => {
                if (error) {
                    reject(error);
                    return;
                }

                grpcServer.start?.();
                resolve(boundPort);
            }
        );
    });
}

//* این تابع کلاینت جی‌آر‌پی‌سی موقت را از روی پروتوی لودشده می‌سازد.
function createSmokeClient(protoRoot, port = DEFAULT_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("RealtimeStreamService client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک پیام rawJson را داخل اِستریم Open می‌فرستد و پاسخ برگشتی را دریافت می‌کند.
function runOpenStreamSmoke(client, rawJson) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        let settled = false;

        call.on("data", (frame) => {
            if (settled) return;

            settled = true;
            resolve(frame?.rawJson ?? "");
            call.end();
        });

        call.on("error", (error) => {
            if (settled) return;

            settled = true;
            reject(error);
        });

        call.on("end", () => {
            if (settled) return;

            settled = true;
            resolve("");
        });

        call.write({ rawJson });
    });
}

//* این تابع کال‌بک‌های تستی کُر ریل‌تایم را می‌سازد تا ترنسپورت جی‌آر‌پی‌سی در تست مستقل کار کند.
function createSmokeRealtimeCallbacks() {
    return {
        onConnection: (connection) => {
            logger.info("Smoke realtime connection opened", {
                connectionId: connection?.connectionId,
                kind: connection?.kind
            });
        },

        onMessage: async (connection, rawJson) => {
            logger.info("Smoke realtime message received", {
                connectionId: connection?.connectionId,
                rawJsonLength: rawJson?.length ?? 0
            });

            connection.sendRaw(rawJson);
        },

        onClose: (connection, reason) => {
            logger.info("Smoke realtime connection closed", {
                connectionId: connection?.connectionId,
                reason
            });
        },

        onError: (connection, error) => {
            logger.error("Smoke realtime connection error", {
                connectionId: connection?.connectionId,
                error: error?.message ?? String(error)
            });
        }
    };
}

//* این تابع کل تست مستقل جی‌آر‌پی‌سی ریل‌تایم را از ساخت سرور تا دریافت پاسخ اجرا می‌کند.
async function runGrpcStreamingRealtimeSmoke() {
    const grpcServer = new grpc.Server();
    const realtimeCallbacks = createSmokeRealtimeCallbacks();

    const setupResult = setupGrpcStreamingRealtime({
        grpcServer,
        logger,
        realtimeCallbacks
    });

    const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_SMOKE_PORT);
    const client = createSmokeClient(setupResult.protoRoot, boundPort);
    const rawJson = createSmokeRawJson();
    const responseRawJson = await runOpenStreamSmoke(client, rawJson);

    if (responseRawJson !== rawJson) {
        throw new Error("Smoke response rawJson does not match request rawJson");
    }

    await delay(100);

    setupResult.grpcStreamingTransport.stop();
    grpcServer.forceShutdown();

    logger.info("Grpc streaming realtime smoke passed", {
        port: boundPort,
        rawJsonLength: rawJson.length
    });

    return true;
}

//* این تابع خط فرمان تست را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل مسیر جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و setupGrpcStreamingRealtime را روی آن اجرا می‌کند.
//* سپس یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد و متد Open را صدا می‌زند.
//* پیام تست داخل فیلد rawJson ارسال می‌شود و همان rawJson از مسیر ترنسپورت برگشت داده می‌شود.
//* هدف این فایل بررسی مسیر پروتو، ریجستر سرویس، هَندلِر Open، ترنسپورت جی‌آر‌پی‌سی و ارسال call.write است.
//* این فایل برای تست مسیر مستقل ساخته شده و نقش اجرای سرور اصلی پروژه را ندارد.

export {
    runGrpcStreamingRealtimeSmoke,
    createSmokeRealtimeCallbacks,
    createSmokeRawJson
};
