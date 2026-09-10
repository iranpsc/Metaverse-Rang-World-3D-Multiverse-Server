// File => src/realTime/transport/grpcStreaming/smokeGrpcStreamingRealtimeHold.js

import grpc from "@grpc/grpc-js";
import { setupGrpcStreamingRealtime } from "./setupGrpcStreamingRealtime.js";

const DEFAULT_HOLD_SMOKE_PORT = Number(process.env.GRPC_REALTIME_HOLD_SMOKE_PORT || 50068);
const DEFAULT_HOLD_DURATION_MS = Number(process.env.GRPC_REALTIME_HOLD_DURATION_MS || 45000);
const DEFAULT_HOLD_PING_INTERVAL_MS = Number(process.env.GRPC_REALTIME_HOLD_PING_INTERVAL_MS || 5000);
const DEFAULT_HOLD_TIMEOUT_EXTRA_MS = Number(process.env.GRPC_REALTIME_HOLD_TIMEOUT_EXTRA_MS || 5000);

//* این آبجکت لاگ‌های ساده تست نگه‌داری جی‌آر‌پی‌سی ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-HoldSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-HoldSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-HoldSmoke][ERROR]", message, data)
};

//* این تابع یک پیام تست خام با ساختار اِنولوپ فعلی پروژه و شماره پینگ می‌سازد.
function createHoldSmokeRawJson(sequence) {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "ping",
        id: `hold_smoke_ping_${sequence}_${Date.now()}`,
        ts: Date.now(),
        room: "grpc_hold_smoke_room",
        payload: {
            source: "grpc_stream_hold_smoke",
            sequence
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست نگه‌داری را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_HOLD_SMOKE_PORT) {
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
function createSmokeClient(protoRoot, port = DEFAULT_HOLD_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("RealtimeStreamService client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع وضعیت تست نگه‌داری را نگه می‌دارد تا باز بودن، پیام‌ها و بسته شدن کنترل شود.
function createHoldSmokeState() {
    return {
        openedConnectionId: "",
        closedConnectionId: "",
        closeReason: "",
        sentCount: 0,
        receivedCount: 0,
        serverMessageCount: 0,
        errorCount: 0,
        startedAt: 0,
        endedAt: 0
    };
}

//* این تابع کال‌بک‌های تستی کُر ریل‌تایم را می‌سازد تا پیام‌های دوره‌ای روی یک اِستریم باز برگشت داده شوند.
function createSmokeRealtimeCallbacks(state) {
    return {
        onConnection: (connection) => {
            state.openedConnectionId = connection?.connectionId ?? "";

            logger.info("Hold smoke realtime connection opened", {
                connectionId: connection?.connectionId,
                kind: connection?.kind
            });
        },

        onMessage: async (connection, rawJson) => {
            state.serverMessageCount += 1;

            const parsed = JSON.parse(rawJson);
            const sequence = parsed?.payload?.sequence ?? 0;

            logger.info("Hold smoke realtime message received", {
                connectionId: connection?.connectionId,
                sequence,
                serverMessageCount: state.serverMessageCount
            });

            connection.sendRaw(rawJson);
        },

        onClose: (connection, reason) => {
            state.closedConnectionId = connection?.connectionId ?? "";
            state.closeReason = reason;

            logger.info("Hold smoke realtime connection closed", {
                connectionId: connection?.connectionId,
                reason
            });
        },

        onError: (connection, error) => {
            state.errorCount += 1;

            logger.error("Hold smoke realtime connection error", {
                connectionId: connection?.connectionId,
                error: error?.message ?? String(error)
            });
        }
    };
}

//* این تابع روی یک اِستریم Open چند پیام را در طول زمان می‌فرستد و پاسخ‌ها را دریافت می‌کند.
function runOpenStreamHoldSmoke(client, state) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        const sentMessages = [];
        const receivedMessages = [];
        let settled = false;
        let sequence = 0;

        state.startedAt = Date.now();

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Hold smoke timed out after ${DEFAULT_HOLD_DURATION_MS + DEFAULT_HOLD_TIMEOUT_EXTRA_MS}ms`));
        }, DEFAULT_HOLD_DURATION_MS + DEFAULT_HOLD_TIMEOUT_EXTRA_MS);

        const finish = () => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            call.end();

            state.endedAt = Date.now();

            resolve({
                sentMessages,
                receivedMessages
            });
        };

        const sendPing = () => {
            if (settled) return;

            sequence += 1;

            const rawJson = createHoldSmokeRawJson(sequence);
            sentMessages.push(rawJson);

            state.sentCount += 1;

            logger.info("Hold smoke client message sent", {
                sequence,
                sentCount: state.sentCount
            });

            call.write({ rawJson });
        };

        call.on("data", (frame) => {
            if (settled) return;

            const rawJson = frame?.rawJson ?? "";
            receivedMessages.push(rawJson);

            state.receivedCount += 1;

            logger.info("Hold smoke client response received", {
                receivedCount: state.receivedCount,
                rawJsonLength: rawJson.length
            });
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
            resolve({
                sentMessages,
                receivedMessages
            });
        });

        sendPing();

        const interval = setInterval(() => {
            if (settled) {
                clearInterval(interval);
                return;
            }

            if (Date.now() - state.startedAt >= DEFAULT_HOLD_DURATION_MS) {
                clearInterval(interval);
                finish();
                return;
            }

            sendPing();
        }, DEFAULT_HOLD_PING_INTERVAL_MS);
    });
}

//* این تابع برابر بودن پیام‌های ارسال‌شده و دریافت‌شده را با حفظ ترتیب کنترل می‌کند.
function assertHoldMessagesMatch(sentMessages, receivedMessages) {
    if (sentMessages.length !== receivedMessages.length) {
        throw new Error(`Hold smoke expected ${sentMessages.length} responses but received ${receivedMessages.length}`);
    }

    for (let i = 0; i < sentMessages.length; i += 1) {
        if (sentMessages[i] !== receivedMessages[i]) {
            throw new Error(`Hold smoke message mismatch at index ${i}`);
        }
    }

    return true;
}

//* این تابع نتیجه نگه‌داری اِستریم و پاک شدن کانکشن از ترنسپورت را کنترل می‌کند.
function assertHoldCleanup({ state, transport, sentMessages, receivedMessages }) {
    if (!state.openedConnectionId) {
        throw new Error("Hold smoke did not open a connection");
    }

    if (!state.closedConnectionId) {
        throw new Error("Hold smoke did not close the connection");
    }

    if (state.closedConnectionId !== state.openedConnectionId) {
        throw new Error("Hold smoke closed connection id does not match opened connection id");
    }

    if (state.errorCount !== 0) {
        throw new Error(`Hold smoke expected 0 errors but got ${state.errorCount}`);
    }

    if (transport.connections.size !== 0) {
        throw new Error(`Hold smoke expected 0 active connections but got ${transport.connections.size}`);
    }

    assertHoldMessagesMatch(sentMessages, receivedMessages);

    return true;
}

//* این تابع کل تست نگه‌داری جی‌آر‌پی‌سی ریل‌تایم را از ساخت سرور تا کنترل پاکسازی اجرا می‌کند.
async function runGrpcStreamingRealtimeHoldSmoke() {
    const grpcServer = new grpc.Server();
    const state = createHoldSmokeState();
    const realtimeCallbacks = createSmokeRealtimeCallbacks(state);
    let setupResult = null;

    try {
        setupResult = setupGrpcStreamingRealtime({
            grpcServer,
            logger,
            realtimeCallbacks
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_HOLD_SMOKE_PORT);
        const client = createSmokeClient(setupResult.protoRoot, boundPort);

        const result = await runOpenStreamHoldSmoke(client, state);

        await delay(300);

        assertHoldCleanup({
            state,
            transport: setupResult.grpcStreamingTransport,
            sentMessages: result.sentMessages,
            receivedMessages: result.receivedMessages
        });

        logger.info("Grpc streaming realtime hold smoke passed", {
            port: boundPort,
            durationMs: state.endedAt - state.startedAt,
            sentCount: state.sentCount,
            receivedCount: state.receivedCount,
            closeReason: state.closeReason
        });

        return true;
    } finally {
        setupResult?.grpcStreamingTransport?.stop?.();
        grpcServer.forceShutdown();
    }
}

//* این تابع خط فرمان تست نگه‌داری را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeHoldSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime hold smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل نگه‌داری مسیر جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و setupGrpcStreamingRealtime را روی آن اجرا می‌کند.
//* سپس یک کلاینت جی‌آر‌پی‌سی موقت می‌سازد و یک متد Open را برای مدت مشخص باز نگه می‌دارد.
//* در طول باز بودن اِستریم، چند پیام rawJson دوره‌ای ارسال می‌شود و پاسخ همان پیام‌ها دریافت می‌شود.
//* هدف این فایل بررسی باز ماندن اِستریم، عبور پیام‌های دوره‌ای و پاکسازی کانکشن بعد از پایان کنترل‌شده است.

export {
    runGrpcStreamingRealtimeHoldSmoke,
    createSmokeRealtimeCallbacks,
    createHoldSmokeRawJson,
    assertHoldCleanup
};
