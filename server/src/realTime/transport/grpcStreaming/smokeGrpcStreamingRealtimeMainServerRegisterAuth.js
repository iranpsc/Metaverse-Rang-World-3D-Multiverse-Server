import path from "path";
import grpc from "@grpc/grpc-js";
import mongoose from "mongoose";
import protoLoader from "@grpc/proto-loader";
import { randomUUID } from "crypto";

import { connectDatabase } from "../../../infra/mongo/connection.js";
import { UserModel } from "../../../infra/mongo/models/user.model.js";
import { RefreshTokenModel } from "../../../infra/mongo/models/refreshToken.model.js";

const DEFAULT_TARGET = process.env.GRPC_REALTIME_MAIN_SERVER_TARGET || "127.0.0.1:50051";
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_MAIN_SERVER_AUTH_TIMEOUT_MS || 7000);
const SHOULD_KEEP_REGISTERED_USER = process.env.GRPC_REALTIME_MAIN_SERVER_AUTH_KEEP_USER === "1";

//* این آبجکت لاگ‌های ساده تست آث ریل‌تایم روی سرور اصلی را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-MainServerRegisterAuthSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-MainServerRegisterAuthSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-MainServerRegisterAuthSmoke][ERROR]", message, data)
};

//* این تابع مسیر فایل پروتوی آث را از روی ریشه پروژه می‌سازد.
function resolveAuthProtoPath() {
    return path.join(process.cwd(), "protos/auth/auth.proto");
}

//* این تابع مسیر فایل پروتوی اِستریم ریل‌تایم را از روی ریشه پروژه می‌سازد.
function resolveRealtimeStreamProtoPath() {
    return path.join(process.cwd(), "protos/realtime/realtime_stream.proto");
}

//* این تابع مسیر پوشه پروتوها را از روی ریشه پروژه می‌سازد.
function resolveProtoRootPath() {
    return path.join(process.cwd(), "protos");
}

//* این تابع یک فایل پروتو را لود می‌کند و ریشه پکیج جی‌آر‌پی‌سی را برمی‌گرداند.
function loadProtoRoot(protoPath) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [resolveProtoRootPath()]
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع کلاینت آث را برای اتصال به سرور اصلی می‌سازد.
function createMainServerAuthClient(authProtoRoot, target = DEFAULT_TARGET) {
    const AuthService = authProtoRoot?.metaverse?.v1?.AuthService;

    if (!AuthService) {
        throw new Error("Auth service client definition was not found");
    }

    return new AuthService(
        target,
        grpc.credentials.createInsecure()
    );
}

//* این تابع کلاینت اِستریم ریل‌تایم را برای اتصال به سرور اصلی می‌سازد.
function createMainServerRealtimeClient(realtimeProtoRoot, target = DEFAULT_TARGET) {
    const RealtimeStreamService = realtimeProtoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        target,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک درخواست رجیستر یکتا برای سرور اصلی می‌سازد.
function createMainServerRegisterRequest() {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);

    return {
        email: `g8-main-register-${id}@test.local`,
        password: `Test_${id}_12345`,
        userName: `g8_main_${id}`.slice(0, 32)
    };
}

//* این تابع یک متد تک‌پاسخ جی‌آر‌پی‌سی را با نام‌های احتمالی پیدا و اجرا می‌کند.
function callUnaryGrpcMethod(client, methodNames = [], request = {}, metadata = null) {
    const methodName = methodNames.find((name) => typeof client?.[name] === "function");

    if (!methodName) {
        throw new Error(`Unary gRPC method was not found: ${methodNames.join(", ")}`);
    }

    return new Promise((resolve, reject) => {
        const callback = (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(response);
        };

        if (metadata) {
            client[methodName](request, metadata, callback);
            return;
        }

        client[methodName](request, callback);
    });
}

//* این تابع رجیستر واقعی را از مسیر آث سرویس اصلی اجرا می‌کند.
async function registerMainServerUser(authClient, registerRequest) {
    const response = await callUnaryGrpcMethod(authClient, ["Register", "register"], registerRequest);

    if (!response?.success) {
        throw new Error(`Register response was not successful: ${response?.message ?? ""}`);
    }

    if (!response?.accessToken) {
        throw new Error("Register response did not return access token");
    }

    if (!response?.refreshToken) {
        throw new Error("Register response did not return refresh token");
    }

    if (!response?.user?.id) {
        throw new Error("Register response did not return user id");
    }

    return response;
}

//* این تابع اِنولوپ آث ریل‌تایم را با اَکسس توکن واقعی می‌سازد.
function createRealtimeAuthRawJson(accessToken) {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "auth",
        id: `main_server_auth_${Date.now()}`,
        ts: Date.now(),
        room: "",
        payload: {
            accessToken
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع اِنولوپ آث را روی اِستریم سرور اصلی می‌فرستد و پاسخ آث اوکی را دریافت می‌کند.
function runRealtimeAuthOnMainServer(realtimeClient, authRawJson) {
    return new Promise((resolve, reject) => {
        const openMethod = typeof realtimeClient?.Open === "function" ? "Open" : "open";

        if (typeof realtimeClient?.[openMethod] !== "function") {
            reject(new Error("Realtime open stream method was not found"));
            return;
        }

        const call = realtimeClient[openMethod]();
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            call.cancel();
            reject(new Error(`Main server realtime auth timed out after ${DEFAULT_TIMEOUT_MS}ms`));
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

        call.write({ rawJson: authRawJson });
    });
}

//* این تابع بررسی می‌کند پاسخ برگشتی از ریل‌تایم همان آث اوکی مربوط به یوزر رجیسترشده باشد.
function assertMainServerRealtimeAuthOkResponse({ registerResponse, authRawJson, authOkRawJson }) {
    if (!authOkRawJson) {
        throw new Error("Realtime auth did not return rawJson");
    }

    const authEnvelope = JSON.parse(authRawJson);
    const authOkEnvelope = JSON.parse(authOkRawJson);

    if (authOkEnvelope.ch !== "system") {
        throw new Error(`Expected system channel but got ${authOkEnvelope.ch}`);
    }

    if (authOkEnvelope.t !== "auth_ok") {
        throw new Error(`Expected auth_ok type but got ${authOkEnvelope.t}`);
    }

    if (authOkEnvelope.replyTo !== authEnvelope.id) {
        throw new Error("Auth ok replyTo does not match auth id");
    }

    if (authOkEnvelope.payload?.ok !== true) {
        throw new Error("Auth ok payload ok is not true");
    }

    if (authOkEnvelope.payload?.userId !== registerResponse.user.id) {
        throw new Error("Auth ok user id does not match registered user");
    }

    if (authOkEnvelope.payload?.userName !== registerResponse.user.userName) {
        throw new Error("Auth ok user name does not match registered user");
    }

    return true;
}

//* این تابع یوزر و رفرش توکن ساخته‌شده برای تست را از دیتابیس پاک می‌کند.
async function cleanupMainServerRegisteredUser(userId) {
    if (SHOULD_KEEP_REGISTERED_USER || !userId) {
        return {
            skipped: true,
            userId
        };
    }

    await connectDatabase();

    await RefreshTokenModel.deleteMany({ userId });
    await UserModel.deleteOne({ userId });

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    return {
        skipped: false,
        userId
    };
}

//* این تابع کل تست رجیستر واقعی و آث ریل‌تایم را روی سرور اصلی اجرا می‌کند.
async function runGrpcStreamingRealtimeMainServerRegisterAuthSmoke() {
    let registeredUserId = "";

    try {
        const authProtoRoot = loadProtoRoot(resolveAuthProtoPath());
        const realtimeProtoRoot = loadProtoRoot(resolveRealtimeStreamProtoPath());

        const authClient = createMainServerAuthClient(authProtoRoot, DEFAULT_TARGET);
        const realtimeClient = createMainServerRealtimeClient(realtimeProtoRoot, DEFAULT_TARGET);

        const registerRequest = createMainServerRegisterRequest();
        const registerResponse = await registerMainServerUser(authClient, registerRequest);

        registeredUserId = registerResponse.user.id;

        const authRawJson = createRealtimeAuthRawJson(registerResponse.accessToken);
        const authOkRawJson = await runRealtimeAuthOnMainServer(realtimeClient, authRawJson);

        assertMainServerRealtimeAuthOkResponse({
            registerResponse,
            authRawJson,
            authOkRawJson
        });

        logger.info("Grpc streaming realtime main server register auth smoke passed", {
            target: DEFAULT_TARGET,
            userId: registeredUserId,
            email: registerResponse.user.email,
            userName: registerResponse.user.userName,
            authLength: authRawJson.length,
            authOkLength: authOkRawJson.length
        });

        return true;
    } finally {
        const cleanup = await cleanupMainServerRegisteredUser(registeredUserId);

        logger.info("Grpc streaming realtime main server register auth cleanup completed", cleanup);
    }
}

//* این تابع خط فرمان تست آث ریل‌تایم روی سرور اصلی را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeMainServerRegisterAuthSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime main server register auth smoke failed", {
            target: DEFAULT_TARGET,
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل رجیستر واقعی و آث ریل‌تایم روی سرور اصلی در حال اجرا است.
//* این فایل سرور جدید نمی‌سازد و فقط به سرور جی‌آر‌پی‌سی اصلی وصل می‌شود.
//* ابتدا از مسیر آث سرویس اصلی یک یوزر واقعی ساخته می‌شود و اَکسس توکن گرفته می‌شود.
//* سپس سرویس اِستریم ریل‌تایم اصلی باز می‌شود و اِنولوپ آث با همان توکن ارسال می‌شود.
//* پاسخ آث اوکی از کُر واقعی ریل‌تایم دریافت و کنترل می‌شود.
//* در پایان داده تستی از دیتابیس پاک می‌شود.
//* هدف این فایل اثبات مسیر کامل رجیستر اصلی تا آث ریل‌تایم اصلی است.

export {
    runGrpcStreamingRealtimeMainServerRegisterAuthSmoke,
    createMainServerRegisterRequest,
    createRealtimeAuthRawJson,
    assertMainServerRealtimeAuthOkResponse
};
