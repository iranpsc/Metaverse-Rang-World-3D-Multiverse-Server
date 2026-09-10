// File => src/realTime/transport/grpcStreaming/smokeGrpcStreamingRealtimeMultiMessage.js

import grpc from "@grpc/grpc-js";
import { setupGrpcStreamingRealtime } from "./setupGrpcStreamingRealtime.js";

const DEFAULT_MULTI_SMOKE_PORT = Number(process.env.GRPC_REALTIME_MULTI_SMOKE_PORT || 50062);
const DEFAULT_MESSAGE_COUNT = Number(process.env.GRPC_REALTIME_MULTI_MESSAGE_COUNT || 5);
const DEFAULT_RESPONSE_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_MULTI_TIMEOUT_MS || 5000);

//* این آبجکت لاگ‌های ساده تست چندپیامی جی‌آر‌پی‌سی ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-MultiSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-MultiSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-MultiSmoke][ERROR]", message, data)
};

//* این تابع یک پیام تست خام با ساختار اِنولوپ فعلی پروژه و شماره ترتیب می‌سازد.
function createSmokeRawJson(sequence) {
    return JSON.stringify({
        v: 1,
        ch: "presence",
        t: "player_state",
        id: `multi_smoke_state_${sequence}_${Date.now()}`,
        ts: Date.now(),
        room: "grpc_multi_smoke_room",
        payload: {
            source: "grpc_stream_multi_smoke",
            sequence,
            position: {
                x: sequence,
                y: 0,
                z: sequence * 2
            }
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع آرایه پیام‌های تست خام را برای ارسال پشت سر هم روی یک اِستریم می‌سازد.
function createSmokeRawJsonMessages(count = DEFAULT_MESSAGE_COUNT) {
    return Array.from({ length: count }, (_, index) => createSmokeRawJson(index + 1));
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست چندپیامی را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_MULTI_SMOKE_PORT) {
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
function createSmokeClient(protoRoot, port = DEFAULT_MULTI_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("RealtimeStreamService client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع چند پیام rawJson را روی یک اِستریم Open می‌فرستد و پاسخ‌های برگشتی را به همان ترتیب دریافت می‌کند.
function runOpenStreamMultiMessageSmoke(client, rawJsonMessages) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        const receivedMessages = [];
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Multi message smoke timed out after ${DEFAULT_RESPONSE_TIMEOUT_MS}ms`));
        }, DEFAULT_RESPONSE_TIMEOUT_MS);

        call.on("data", (frame) => {
            if (settled) return;

            receivedMessages.push(frame?.rawJson ?? "");

            if (receivedMessages.length === rawJsonMessages.length) {
                settled = true;
                clearTimeout(timeout);
                call.end();
                resolve(receivedMessages);
            }
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
            resolve(receivedMessages);
        });

        for (const rawJson of rawJsonMessages) {
            call.write({ rawJson });
        }
    });
}

//* این تابع کال‌بک‌های تستی کُر ریل‌تایم را می‌سازد تا هر پیام دریافتی روی همان اِستریم برگشت داده شود.
function createSmokeRealtimeCallbacks() {
    return {
        onConnection: (connection) => {
            logger.info("Multi smoke realtime connection opened", {
                connectionId: connection?.connectionId,
                kind: connection?.kind
            });
        },

        onMessage: async (connection, rawJson) => {
            const parsed = JSON.parse(rawJson);
            const sequence = parsed?.payload?.sequence ?? 0;

            logger.info("Multi smoke realtime message received", {
                connectionId: connection?.connectionId,
                sequence,
                rawJsonLength: rawJson.length
            });

            connection.sendRaw(rawJson);
        },

        onClose: (connection, reason) => {
            logger.info("Multi smoke realtime connection closed", {
                connectionId: connection?.connectionId,
                reason
            });
        },

        onError: (connection, error) => {
            logger.error("Multi smoke realtime connection error", {
                connectionId: connection?.connectionId,
                error: error?.message ?? String(error)
            });
        }
    };
}

//* این تابع برابر بودن پیام‌های ارسال‌شده و دریافت‌شده را با حفظ ترتیب کنترل می‌کند.
function assertMessagesMatch(sentMessages, receivedMessages) {
    if (receivedMessages.length !== sentMessages.length) {
        throw new Error(`Expected ${sentMessages.length} responses but received ${receivedMessages.length}`);
    }

    for (let i = 0; i < sentMessages.length; i += 1) {
        if (receivedMessages[i] !== sentMessages[i]) {
            throw new Error(`Message mismatch at index ${i}`);
        }
    }

    return true;
}

//* این تابع کل تست چندپیامی جی‌آر‌پی‌سی ریل‌تایم را از ساخت سرور تا دریافت همه پاسخ‌ها اجرا می‌کند.
async function runGrpcStreamingRealtimeMultiMessageSmoke() {
    const grpcServer = new grpc.Server();
    const realtimeCallbacks = createSmokeRealtimeCallbacks();

    const setupResult = setupGrpcStreamingRealtime({
        grpcServer,
        logger,
        realtimeCallbacks
    });

    const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_MULTI_SMOKE_PORT);
    const client = createSmokeClient(setupResult.protoRoot, boundPort);
    const sentMessages = createSmokeRawJsonMessages(DEFAULT_MESSAGE_COUNT);
    const receivedMessages = await runOpenStreamMultiMessageSmoke(client, sentMessages);

    assertMessagesMatch(sentMessages, receivedMessages);

    await delay(100);

    setupResult.grpcStreamingTransport.stop();
    grpcServer.forceShutdown();

    logger.info("Grpc streaming realtime multi message smoke passed", {
        port: boundPort,
        messageCount: sentMessages.length
    });

    return true;
}

//* این تابع خط فرمان تست چندپیامی را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeMultiMessageSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime multi message smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل چندپیامی مسیر جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و setupGrpcStreamingRealtime را روی آن اجرا می‌کند.
//* سپس یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد و متد Open را فقط یک‌بار صدا می‌زند.
//* چند پیام rawJson پشت سر هم روی همان اِستریم ارسال می‌شود.
//* هر پیام از مسیر ترنسپورت جی‌آر‌پی‌سی عبور می‌کند و با connection.sendRaw دوباره به کلاینت برمی‌گردد.
//* هدف این فایل بررسی واقعی بودن حالت اِستریم و حفظ ترتیب پیام‌ها روی یک کانکشن باز است.

export {
    runGrpcStreamingRealtimeMultiMessageSmoke,
    createSmokeRealtimeCallbacks,
    createSmokeRawJson,
    createSmokeRawJsonMessages,
    assertMessagesMatch
};
