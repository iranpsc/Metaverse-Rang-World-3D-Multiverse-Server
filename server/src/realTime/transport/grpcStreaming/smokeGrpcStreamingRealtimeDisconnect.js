// File => src/realTime/transport/grpcStreaming/smokeGrpcStreamingRealtimeDisconnect.js

import grpc from "@grpc/grpc-js";
import { setupGrpcStreamingRealtime } from "./setupGrpcStreamingRealtime.js";

const DEFAULT_DISCONNECT_SMOKE_PORT = Number(process.env.GRPC_REALTIME_DISCONNECT_SMOKE_PORT || 50063);
const DEFAULT_DISCONNECT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_DISCONNECT_TIMEOUT_MS || 5000);

//* این آبجکت لاگ‌های ساده تست دیسکانکت جی‌آر‌پی‌سی ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-DisconnectSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-DisconnectSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-DisconnectSmoke][ERROR]", message, data)
};

//* این تابع یک پیام تست خام با ساختار اِنولوپ فعلی پروژه می‌سازد.
function createDisconnectSmokeRawJson() {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "ping",
        id: `disconnect_smoke_ping_${Date.now()}`,
        ts: Date.now(),
        room: "grpc_disconnect_smoke_room",
        payload: {
            source: "grpc_stream_disconnect_smoke"
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست دیسکانکت را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_DISCONNECT_SMOKE_PORT) {
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
function createSmokeClient(protoRoot, port = DEFAULT_DISCONNECT_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("RealtimeStreamService client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک اِستریم Open باز می‌کند، یک پیام می‌فرستد، پاسخ را می‌گیرد و سپس اِستریم را از سمت کلاینت می‌بندد.
function runOpenStreamDisconnectSmoke(client, rawJson) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Disconnect smoke timed out after ${DEFAULT_DISCONNECT_TIMEOUT_MS}ms`));
        }, DEFAULT_DISCONNECT_TIMEOUT_MS);

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

        call.write({ rawJson });
    });
}

//* این تابع وضعیت تست دیسکانکت را نگه می‌دارد تا بعد از بسته شدن اِستریم کنترل شود.
function createDisconnectSmokeState() {
    return {
        openedConnectionId: "",
        closedConnectionId: "",
        closeReason: "",
        messageCount: 0,
        errorCount: 0
    };
}

//* این تابع کال‌بک‌های تستی کُر ریل‌تایم را می‌سازد تا باز شدن، پیام و بسته شدن کانکشن کنترل شود.
function createSmokeRealtimeCallbacks(state) {
    return {
        onConnection: (connection) => {
            state.openedConnectionId = connection?.connectionId ?? "";

            logger.info("Disconnect smoke realtime connection opened", {
                connectionId: connection?.connectionId,
                kind: connection?.kind
            });
        },

        onMessage: async (connection, rawJson) => {
            state.messageCount += 1;

            logger.info("Disconnect smoke realtime message received", {
                connectionId: connection?.connectionId,
                rawJsonLength: rawJson?.length ?? 0
            });

            connection.sendRaw(rawJson);
        },

        onClose: (connection, reason) => {
            state.closedConnectionId = connection?.connectionId ?? "";
            state.closeReason = reason;

            logger.info("Disconnect smoke realtime connection closed", {
                connectionId: connection?.connectionId,
                reason
            });
        },

        onError: (connection, error) => {
            state.errorCount += 1;

            logger.error("Disconnect smoke realtime connection error", {
                connectionId: connection?.connectionId,
                error: error?.message ?? String(error)
            });
        }
    };
}

//* این تابع نتیجه دیسکانکت و پاک شدن کانکشن از ترنسپورت را کنترل می‌کند.
function assertDisconnectCleanup({ state, transport, expectedRawJson, responseRawJson }) {
    if (responseRawJson !== expectedRawJson) {
        throw new Error("Disconnect smoke response rawJson does not match request rawJson");
    }

    if (!state.openedConnectionId) {
        throw new Error("Disconnect smoke did not open a connection");
    }

    if (state.closedConnectionId !== state.openedConnectionId) {
        throw new Error("Disconnect smoke closed connection id does not match opened connection id");
    }

    if (state.messageCount !== 1) {
        throw new Error(`Disconnect smoke expected 1 message but got ${state.messageCount}`);
    }

    if (state.errorCount !== 0) {
        throw new Error(`Disconnect smoke expected 0 errors but got ${state.errorCount}`);
    }

    if (transport.connections.size !== 0) {
        throw new Error(`Disconnect smoke expected 0 active connections but got ${transport.connections.size}`);
    }

    return true;
}

//* این تابع کل تست مستقل دیسکانکت جی‌آر‌پی‌سی ریل‌تایم را از ساخت سرور تا کنترل پاکسازی اجرا می‌کند.
async function runGrpcStreamingRealtimeDisconnectSmoke() {
    const grpcServer = new grpc.Server();
    const state = createDisconnectSmokeState();
    const realtimeCallbacks = createSmokeRealtimeCallbacks(state);

    const setupResult = setupGrpcStreamingRealtime({
        grpcServer,
        logger,
        realtimeCallbacks
    });

    const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_DISCONNECT_SMOKE_PORT);
    const client = createSmokeClient(setupResult.protoRoot, boundPort);
    const rawJson = createDisconnectSmokeRawJson();
    const responseRawJson = await runOpenStreamDisconnectSmoke(client, rawJson);

    await delay(100);

    assertDisconnectCleanup({
        state,
        transport: setupResult.grpcStreamingTransport,
        expectedRawJson: rawJson,
        responseRawJson
    });

    setupResult.grpcStreamingTransport.stop();
    grpcServer.forceShutdown();

    logger.info("Grpc streaming realtime disconnect smoke passed", {
        port: boundPort,
        connectionId: state.openedConnectionId,
        closeReason: state.closeReason
    });

    return true;
}

//* این تابع خط فرمان تست دیسکانکت را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeDisconnectSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime disconnect smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل دیسکانکت مسیر جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و setupGrpcStreamingRealtime را روی آن اجرا می‌کند.
//* سپس یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد، متد Open را صدا می‌زند و یک پیام rawJson ارسال می‌کند.
//* بعد از دریافت پاسخ، اِستریم از سمت کلاینت بسته می‌شود.
//* مسیر closeConnection، کال‌بک onClose و پاک شدن کانکشن از Map ترنسپورت کنترل می‌شود.
//* هدف این فایل بررسی پاکسازی پایه کانکشن جی‌آر‌پی‌سی بعد از بسته شدن اِستریم است.

export {
    runGrpcStreamingRealtimeDisconnectSmoke,
    createSmokeRealtimeCallbacks,
    createDisconnectSmokeRawJson,
    assertDisconnectCleanup
};
