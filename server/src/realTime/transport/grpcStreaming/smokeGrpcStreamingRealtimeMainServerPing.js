import path from "path";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const DEFAULT_TARGET = process.env.GRPC_REALTIME_MAIN_SERVER_TARGET || "127.0.0.1:50051";
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_MAIN_SERVER_TIMEOUT_MS || 7000);

//* این آبجکت لاگ‌های ساده تست سرور اصلی را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-MainServerPingSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-MainServerPingSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-MainServerPingSmoke][ERROR]", message, data)
};

//* این تابع مسیر فایل پروتوی اِستریم ریل‌تایم را از روی ریشه پروژه می‌سازد.
function resolveRealtimeStreamProtoPath() {
    return path.join(process.cwd(), "protos/realtime/realtime_stream.proto");
}

//* این تابع مسیر پوشه پروتوها را از روی ریشه پروژه می‌سازد.
function resolveProtoRootPath() {
    return path.join(process.cwd(), "protos");
}

//* این تابع پروتوی اِستریم ریل‌تایم را برای ساخت کلاینت تستی لود می‌کند.
function loadRealtimeStreamProtoRoot() {
    const packageDefinition = protoLoader.loadSync(resolveRealtimeStreamProtoPath(), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [resolveProtoRootPath()]
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع کلاینت اِستریم ریل‌تایم را برای اتصال به سرور اصلی می‌سازد.
function createMainServerRealtimeClient(protoRoot, target = DEFAULT_TARGET) {
    const RealtimeStreamService = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        target,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک اِنولوپ پینگ با ساختار فعلی ریل‌تایم می‌سازد.
function createMainServerPingRawJson() {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "ping",
        id: `main_server_ping_${Date.now()}`,
        ts: Date.now(),
        room: "",
        payload: {
            source: "main_server_grpc_ping_smoke"
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع یک پینگ را روی اِستریم سرور اصلی می‌فرستد و پاسخ را دریافت می‌کند.
function runMainServerPing(client, pingRawJson) {
    return new Promise((resolve, reject) => {
        const openMethod = typeof client?.Open === "function" ? "Open" : "open";

        if (typeof client?.[openMethod] !== "function") {
            reject(new Error("Realtime open stream method was not found"));
            return;
        }

        const call = client[openMethod]();
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Main server ping timed out after ${DEFAULT_TIMEOUT_MS}ms`));
        }, DEFAULT_TIMEOUT_MS);

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

//* این تابع بررسی می‌کند پاسخ برگشتی از سرور اصلی همان پونگ درست باشد.
function assertMainServerPongResponse({ pingRawJson, pongRawJson }) {
    if (!pongRawJson) {
        throw new Error("Main server ping did not receive pong rawJson");
    }

    const pingEnvelope = JSON.parse(pingRawJson);
    const pongEnvelope = JSON.parse(pongRawJson);

    if (pongEnvelope.ch !== "system") {
        throw new Error(`Expected system channel but got ${pongEnvelope.ch}`);
    }

    if (pongEnvelope.t !== "pong") {
        throw new Error(`Expected pong type but got ${pongEnvelope.t}`);
    }

    if (pongEnvelope.replyTo !== pingEnvelope.id) {
        throw new Error("Pong replyTo does not match ping id");
    }

    return true;
}

//* این تابع کل تست پینگ روی سرور اصلی را اجرا می‌کند.
async function runGrpcStreamingRealtimeMainServerPingSmoke() {
    const protoRoot = loadRealtimeStreamProtoRoot();
    const client = createMainServerRealtimeClient(protoRoot, DEFAULT_TARGET);
    const pingRawJson = createMainServerPingRawJson();
    const pongRawJson = await runMainServerPing(client, pingRawJson);

    assertMainServerPongResponse({
        pingRawJson,
        pongRawJson
    });

    logger.info("Grpc streaming realtime main server ping smoke passed", {
        target: DEFAULT_TARGET,
        pingLength: pingRawJson.length,
        pongLength: pongRawJson.length
    });

    return true;
}

//* این تابع خط فرمان تست پینگ سرور اصلی را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeMainServerPingSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime main server ping smoke failed", {
            target: DEFAULT_TARGET,
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل اتصال به سرور اصلی در حال اجرا است.
//* این فایل سرور جدید نمی‌سازد و فقط به سرور جی‌آر‌پی‌سی اصلی وصل می‌شود.
//* سپس سرویس اِستریم ریل‌تایم را باز می‌کند و یک اِنولوپ پینگ می‌فرستد.
//* پاسخ پونگ از همان سرور اصلی دریافت و کنترل می‌شود.
//* هدف این فایل بررسی فعال بودن مسیر جی‌آر‌پی‌سی ریل‌تایم در اجرای واقعی سرور است.

export {
    runGrpcStreamingRealtimeMainServerPingSmoke,
    createMainServerPingRawJson,
    assertMainServerPongResponse
};
