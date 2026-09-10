// File => src/realTime/transport/grpcStreaming/smokeGrpcStreamingRealtimeConcurrent.js

import grpc from "@grpc/grpc-js";
import { setupGrpcStreamingRealtime } from "./setupGrpcStreamingRealtime.js";

const DEFAULT_CONCURRENT_SMOKE_PORT = Number(process.env.GRPC_REALTIME_CONCURRENT_SMOKE_PORT || 50066);
const DEFAULT_CLIENT_COUNT = Number(process.env.GRPC_REALTIME_CONCURRENT_CLIENT_COUNT || 3);
const DEFAULT_MESSAGES_PER_CLIENT = Number(process.env.GRPC_REALTIME_CONCURRENT_MESSAGES_PER_CLIENT || 3);
const DEFAULT_CONCURRENT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CONCURRENT_TIMEOUT_MS || 8000);

//* این آبجکت لاگ‌های ساده تست همزمان جی‌آر‌پی‌سی ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-ConcurrentSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-ConcurrentSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-ConcurrentSmoke][ERROR]", message, data)
};

//* این تابع یک پیام تست خام با ساختار اِنولوپ فعلی پروژه برای یک کلاینت و شماره پیام می‌سازد.
function createConcurrentSmokeRawJson(clientIndex, sequence) {
    return JSON.stringify({
        v: 1,
        ch: "presence",
        t: "player_state",
        id: `concurrent_smoke_${clientIndex}_${sequence}_${Date.now()}`,
        ts: Date.now(),
        room: "grpc_concurrent_smoke_room",
        payload: {
            source: "grpc_stream_concurrent_smoke",
            clientIndex,
            sequence,
            position: {
                x: clientIndex,
                y: 0,
                z: sequence
            }
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع پیام‌های تست یک کلاینت را برای ارسال پشت سر هم روی همان اِستریم می‌سازد.
function createClientSmokeMessages(clientIndex, count = DEFAULT_MESSAGES_PER_CLIENT) {
    return Array.from({ length: count }, (_, index) => createConcurrentSmokeRawJson(clientIndex, index + 1));
}

//* این تابع یک پرامیس کوتاه برای انتظار کنترل‌شده در تست می‌سازد.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست همزمان را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_CONCURRENT_SMOKE_PORT) {
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
function createSmokeClient(protoRoot, port = DEFAULT_CONCURRENT_SMOKE_PORT) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("RealtimeStreamService client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع چند پیام یک کلاینت را روی یک اِستریم Open می‌فرستد و پاسخ‌های همان کلاینت را دریافت می‌کند.
function runSingleClientStreamSmoke({ client, clientIndex, rawJsonMessages }) {
    return new Promise((resolve, reject) => {
        const call = client.Open();
        const receivedMessages = [];
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Concurrent smoke client ${clientIndex} timed out after ${DEFAULT_CONCURRENT_TIMEOUT_MS}ms`));
        }, DEFAULT_CONCURRENT_TIMEOUT_MS);

        call.on("data", (frame) => {
            if (settled) return;

            receivedMessages.push(frame?.rawJson ?? "");

            if (receivedMessages.length === rawJsonMessages.length) {
                settled = true;
                clearTimeout(timeout);
                call.end();

                resolve({
                    clientIndex,
                    sentMessages: rawJsonMessages,
                    receivedMessages
                });
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
            reject(new Error(`Concurrent smoke client ${clientIndex} ended before receiving all responses`));
        });

        for (const rawJson of rawJsonMessages) {
            call.write({ rawJson });
        }
    });
}

//* این تابع وضعیت تست همزمان را نگه می‌دارد تا تعداد اتصال‌ها، پیام‌ها و بسته شدن‌ها کنترل شود.
function createConcurrentSmokeState() {
    return {
        openedConnectionIds: new Set(),
        closedConnectionIds: new Set(),
        messageCount: 0,
        errorCount: 0
    };
}

//* این تابع کال‌بک‌های تستی کُر ریل‌تایم را می‌سازد تا چند اِستریم همزمان کنترل شوند.
function createSmokeRealtimeCallbacks(state) {
    return {
        onConnection: (connection) => {
            state.openedConnectionIds.add(connection?.connectionId ?? "");

            logger.info("Concurrent smoke realtime connection opened", {
                connectionId: connection?.connectionId,
                kind: connection?.kind,
                openedCount: state.openedConnectionIds.size
            });
        },

        onMessage: async (connection, rawJson) => {
            state.messageCount += 1;

            const parsed = JSON.parse(rawJson);
            const clientIndex = parsed?.payload?.clientIndex ?? 0;
            const sequence = parsed?.payload?.sequence ?? 0;

            logger.info("Concurrent smoke realtime message received", {
                connectionId: connection?.connectionId,
                clientIndex,
                sequence,
                messageCount: state.messageCount
            });

            connection.sendRaw(rawJson);
        },

        onClose: (connection, reason) => {
            state.closedConnectionIds.add(connection?.connectionId ?? "");

            logger.info("Concurrent smoke realtime connection closed", {
                connectionId: connection?.connectionId,
                reason,
                closedCount: state.closedConnectionIds.size
            });
        },

        onError: (connection, error) => {
            state.errorCount += 1;

            logger.error("Concurrent smoke realtime connection error", {
                connectionId: connection?.connectionId,
                error: error?.message ?? String(error)
            });
        }
    };
}

//* این تابع برابر بودن پیام‌های ارسال‌شده و دریافت‌شده هر کلاینت را با حفظ ترتیب کنترل می‌کند.
function assertClientMessagesMatch(result) {
    if (result.receivedMessages.length !== result.sentMessages.length) {
        throw new Error(`Client ${result.clientIndex} expected ${result.sentMessages.length} responses but received ${result.receivedMessages.length}`);
    }

    for (let i = 0; i < result.sentMessages.length; i += 1) {
        if (result.receivedMessages[i] !== result.sentMessages[i]) {
            throw new Error(`Client ${result.clientIndex} message mismatch at index ${i}`);
        }
    }

    return true;
}

//* این تابع نتیجه چند اِستریم همزمان و پاک شدن کانکشن‌ها از ترنسپورت را کنترل می‌کند.
function assertConcurrentCleanup({ state, transport, clientCount, messagesPerClient, clientResults }) {
    if (state.openedConnectionIds.size !== clientCount) {
        throw new Error(`Expected ${clientCount} opened connections but got ${state.openedConnectionIds.size}`);
    }

    if (state.closedConnectionIds.size !== clientCount) {
        throw new Error(`Expected ${clientCount} closed connections but got ${state.closedConnectionIds.size}`);
    }

    if (state.messageCount !== clientCount * messagesPerClient) {
        throw new Error(`Expected ${clientCount * messagesPerClient} messages but got ${state.messageCount}`);
    }

    if (state.errorCount !== 0) {
        throw new Error(`Expected 0 errors but got ${state.errorCount}`);
    }

    if (transport.connections.size !== 0) {
        throw new Error(`Expected 0 active connections but got ${transport.connections.size}`);
    }

    for (const result of clientResults) {
        assertClientMessagesMatch(result);
    }

    return true;
}

//* این تابع کل تست همزمان جی‌آر‌پی‌سی ریل‌تایم را از ساخت سرور تا کنترل همه پاسخ‌ها اجرا می‌کند.
async function runGrpcStreamingRealtimeConcurrentSmoke() {
    const grpcServer = new grpc.Server();
    const state = createConcurrentSmokeState();
    const realtimeCallbacks = createSmokeRealtimeCallbacks(state);
    let setupResult = null;

    try {
        setupResult = setupGrpcStreamingRealtime({
            grpcServer,
            logger,
            realtimeCallbacks
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_CONCURRENT_SMOKE_PORT);

        const clientTasks = Array.from({ length: DEFAULT_CLIENT_COUNT }, (_, index) => {
            const clientIndex = index + 1;
            const client = createSmokeClient(setupResult.protoRoot, boundPort);
            const rawJsonMessages = createClientSmokeMessages(clientIndex, DEFAULT_MESSAGES_PER_CLIENT);

            return runSingleClientStreamSmoke({
                client,
                clientIndex,
                rawJsonMessages
            });
        });

        const clientResults = await Promise.all(clientTasks);

        await delay(300);

        assertConcurrentCleanup({
            state,
            transport: setupResult.grpcStreamingTransport,
            clientCount: DEFAULT_CLIENT_COUNT,
            messagesPerClient: DEFAULT_MESSAGES_PER_CLIENT,
            clientResults
        });

        logger.info("Grpc streaming realtime concurrent smoke passed", {
            port: boundPort,
            clientCount: DEFAULT_CLIENT_COUNT,
            messagesPerClient: DEFAULT_MESSAGES_PER_CLIENT,
            totalMessages: DEFAULT_CLIENT_COUNT * DEFAULT_MESSAGES_PER_CLIENT
        });

        return true;
    } finally {
        setupResult?.grpcStreamingTransport?.stop?.();
        grpcServer.forceShutdown();
    }
}

//* این تابع خط فرمان تست همزمان را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeConcurrentSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime concurrent smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل چند کلاینت همزمان برای مسیر جی‌آر‌پی‌سی اِستریمینگ ریل‌تایم است.
//* این تست یک سرور جی‌آر‌پی‌سی موقت می‌سازد و setupGrpcStreamingRealtime را روی آن اجرا می‌کند.
//* سپس چند کلاینت جی‌آر‌پی‌سی موقت می‌سازد و برای هر کلاینت یک متد Open جدا باز می‌کند.
//* هر کلاینت چند پیام rawJson روی اِستریم خودش ارسال می‌کند.
//* هر پیام از مسیر ترنسپورت جی‌آر‌پی‌سی عبور می‌کند و با connection.sendRaw به همان کلاینت برمی‌گردد.
//* هدف این فایل بررسی جدا بودن کانکشن‌ها، مدیریت همزمان چند اِستریم و پاکسازی همه کانکشن‌ها است.

export {
    runGrpcStreamingRealtimeConcurrentSmoke,
    createSmokeRealtimeCallbacks,
    createConcurrentSmokeRawJson,
    createClientSmokeMessages,
    assertConcurrentCleanup
};
