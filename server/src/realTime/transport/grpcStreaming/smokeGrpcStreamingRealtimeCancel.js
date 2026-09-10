// File => src/realTime/transport/grpcStreaming/smokeGrpcStreamingRealtimeCancel.js

import grpc from "@grpc/grpc-js";
import { setupGrpcStreamingRealtime } from "./setupGrpcStreamingRealtime.js";

const DEFAULT_CANCEL_SMOKE_PORT = Number(process.env.GRPC_REALTIME_CANCEL_SMOKE_PORT || 50064);
const DEFAULT_CANCEL_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CANCEL_TIMEOUT_MS || 5000);
const DEFAULT_CANCEL_DELAY_AFTER_OPEN_MS = Number(process.env.GRPC_REALTIME_CANCEL_DELAY_AFTER_OPEN_MS || 50);

//* این آبجکت لاگ‌های ساده تست کنسل جی‌آر‌پی‌سی ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-CancelSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-CancelSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-CancelSmoke][ERROR]", message, data)
};

//* این تابع یک پیام تست خام با ساختار اِنولوپ فعلی پروژه می‌سازد.
function createCancelSmokeRawJson() {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "ping",
        id: `cancel_smoke_ping_${Date.now()}`,
        ts: Date.now(),
        room: "grpc_cancel_smoke_room",
        payload: {
            source: "grpc_stream_cancel_smoke"
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع تا زمان درست شدن یک شرط صبر می‌کند و اگر زمان تمام شود خطا می‌دهد.
function waitUntil(check, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();

        const timer = setInterval(() => {
            if (check()) {
                clearInterval(timer);
                resolve(true);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                reject(new Error(`${label} timed out after ${timeoutMs}ms`));
            }
        }, 10);
    });
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست کنسل را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_CANCEL_SMOKE_PORT) {
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
function createSmokeClient(protoRoot, port = DEFAULT_CANCEL_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("RealtimeStreamService client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع پایان پیدا کردن کال کنسل‌شده را کنترل می‌کند تا تست منتظر بسته شدن مسیر بماند.
function waitForCallFinish(call) {
    return new Promise((resolve) => {
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            resolve("timeout_cancel");
        }, DEFAULT_CANCEL_TIMEOUT_MS);

        const finish = (reason) => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            resolve(reason);
        };

        call.on("data", (frame) => {
            logger.warn("Cancel smoke ignored response frame after cancel path started", {
                rawJsonLength: frame?.rawJson?.length ?? 0
            });
        });

        call.on("error", () => finish("client_error"));
        call.on("close", () => finish("client_close"));
        call.on("end", () => finish("client_end"));
    });
}

//* این تابع یک اِستریم Open باز می‌کند، یک پیام می‌فرستد، صبر می‌کند کانکشن سرور ساخته شود و سپس اِستریم را کنسل می‌کند.
async function runOpenStreamCancelSmoke(client, rawJson, state) {
    const call = client.Open();
    const finishPromise = waitForCallFinish(call);

    call.write({ rawJson });

    await waitUntil(
        () => Boolean(state.openedConnectionId),
        DEFAULT_CANCEL_TIMEOUT_MS,
        "Cancel smoke wait for server connection open"
    );

    await delay(DEFAULT_CANCEL_DELAY_AFTER_OPEN_MS);

    call.cancel();

    return await finishPromise;
}

//* این تابع وضعیت تست کنسل را نگه می‌دارد تا بعد از قطع ناگهانی اِستریم کنترل شود.
function createCancelSmokeState() {
    return {
        openedConnectionId: "",
        closedConnectionId: "",
        closeReason: "",
        messageCount: 0,
        errorCount: 0,
        finishReason: ""
    };
}

//* این تابع کال‌بک‌های تستی کُر ریل‌تایم را می‌سازد تا باز شدن، پیام، خطا و بسته شدن کانکشن کنترل شود.
function createSmokeRealtimeCallbacks(state) {
    return {
        onConnection: (connection) => {
            state.openedConnectionId = connection?.connectionId ?? "";

            logger.info("Cancel smoke realtime connection opened", {
                connectionId: connection?.connectionId,
                kind: connection?.kind
            });
        },

        onMessage: async (connection, rawJson) => {
            state.messageCount += 1;

            logger.info("Cancel smoke realtime message received", {
                connectionId: connection?.connectionId,
                rawJsonLength: rawJson?.length ?? 0
            });

            await delay(100);
            connection.sendRaw(rawJson);
        },

        onClose: (connection, reason) => {
            state.closedConnectionId = connection?.connectionId ?? "";
            state.closeReason = reason;

            logger.info("Cancel smoke realtime connection closed", {
                connectionId: connection?.connectionId,
                reason
            });
        },

        onError: (connection, error) => {
            state.errorCount += 1;

            logger.warn("Cancel smoke realtime connection error", {
                connectionId: connection?.connectionId,
                error: error?.message ?? String(error)
            });
        }
    };
}

//* این تابع نتیجه کنسل ناگهانی و پاک شدن کانکشن از ترنسپورت را کنترل می‌کند.
function assertCancelCleanup({ state, transport }) {
    if (!state.openedConnectionId) {
        throw new Error("Cancel smoke did not open a connection");
    }

    if (!state.closedConnectionId) {
        throw new Error("Cancel smoke did not close the connection");
    }

    if (state.closedConnectionId !== state.openedConnectionId) {
        throw new Error("Cancel smoke closed connection id does not match opened connection id");
    }

    if (transport.connections.size !== 0) {
        throw new Error(`Cancel smoke expected 0 active connections but got ${transport.connections.size}`);
    }

    return true;
}

//* این تابع کل تست مستقل کنسل جی‌آر‌پی‌سی ریل‌تایم را از ساخت سرور تا کنترل پاکسازی اجرا می‌کند.
async function runGrpcStreamingRealtimeCancelSmoke() {
    const grpcServer = new grpc.Server();
    const state = createCancelSmokeState();
    const realtimeCallbacks = createSmokeRealtimeCallbacks(state);
    let setupResult = null;

    try {
        setupResult = setupGrpcStreamingRealtime({
            grpcServer,
            logger,
            realtimeCallbacks
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_CANCEL_SMOKE_PORT);
        const client = createSmokeClient(setupResult.protoRoot, boundPort);
        const rawJson = createCancelSmokeRawJson();

        state.finishReason = await runOpenStreamCancelSmoke(client, rawJson, state);

        await delay(300);

        assertCancelCleanup({
            state,
            transport: setupResult.grpcStreamingTransport
        });

        logger.info("Grpc streaming realtime cancel smoke passed", {
            port: boundPort,
            connectionId: state.openedConnectionId,
            closeReason: state.closeReason,
            finishReason: state.finishReason,
            messageCount: state.messageCount,
            errorCount: state.errorCount
        });

        return true;
    } finally {
        setupResult?.grpcStreamingTransport?.stop?.();
        grpcServer.forceShutdown();
    }
}

//* این تابع خط فرمان تست کنسل را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCancelSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime cancel smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل کنسل ناگهانی مسیر جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و setupGrpcStreamingRealtime را روی آن اجرا می‌کند.
//* سپس یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد، متد Open را صدا می‌زند و یک پیام rawJson ارسال می‌کند.
//* تست اول صبر می‌کند کانکشن سمت سرور ساخته شود و بعد اِستریم را با call.cancel قطع می‌کند.
//* مسیر خطا یا بسته شدن کال، closeConnection، کال‌بک onClose و پاک شدن کانکشن از Map ترنسپورت کنترل می‌شود.
//* هدف این فایل بررسی پاکسازی کانکشن جی‌آر‌پی‌سی در قطع ناگهانی کلاینت است.

export {
    runGrpcStreamingRealtimeCancelSmoke,
    createSmokeRealtimeCallbacks,
    createCancelSmokeRawJson,
    assertCancelCleanup
};
