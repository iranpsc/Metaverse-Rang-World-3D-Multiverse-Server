import path from "path";
import grpc from "@grpc/grpc-js";
import mongoose from "mongoose";
import protoLoader from "@grpc/proto-loader";
import { randomUUID } from "crypto";
import { attachGrpcStreamingRealtimeCore } from "./attachGrpcStreamingRealtimeCore.js";
import { authHandlers } from "../../../transport/grpc/handlers/auth.handler.js";
import { tokenService } from "../../../core/auth/auth.instance.js";
import { connectDatabase } from "../../../infra/mongo/connection.js";
import { UserModel } from "../../../infra/mongo/models/user.model.js";
import { RefreshTokenModel } from "../../../infra/mongo/models/refreshToken.model.js";

const DEFAULT_CORE_REGISTER_AUTH_SMOKE_PORT = Number(process.env.GRPC_REALTIME_CORE_REGISTER_AUTH_SMOKE_PORT || 50074);
const DEFAULT_CORE_REGISTER_AUTH_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CORE_REGISTER_AUTH_TIMEOUT_MS || 7000);
const SHOULD_KEEP_REGISTERED_USER = process.env.GRPC_REALTIME_CORE_REGISTER_AUTH_KEEP_USER === "1";

//* این آبجکت لاگ‌های ساده تست رجیستر و آث ریل‌تایم را در کنسول چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-CoreRegisterAuthSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-CoreRegisterAuthSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-CoreRegisterAuthSmoke][ERROR]", message, data)
};

//* این تابع مسیر کامل فایل پروتوی آث را از روی ریشه پروژه می‌سازد.
function resolveAuthProtoPath() {
    return path.join(process.cwd(), "protos/auth/auth.proto");
}

//* این تابع مسیر پوشه پروتوها را از روی ریشه پروژه می‌سازد.
function resolveProtoRootPath() {
    return path.join(process.cwd(), "protos");
}

//* این تابع پروتوی آث را لود می‌کند تا سرویس آث واقعی روی سرور تست ثبت شود.
function loadAuthProtoRoot() {
    const packageDefinition = protoLoader.loadSync(resolveAuthProtoPath(), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [resolveProtoRootPath()]
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع سرویس آث واقعی را روی سرور جی‌آر‌پی‌سی موقت ثبت می‌کند.
function registerAuthSmokeService(grpcServer, authProtoRoot) {
    const serviceDefinition = authProtoRoot?.metaverse?.v1?.AuthService?.service;

    if (!serviceDefinition) {
        throw new Error("Auth service definition was not found");
    }

    grpcServer.addService(serviceDefinition, authHandlers);

    return {
        ok: true,
        serviceName: "AuthService"
    };
}

//* این تابع سرور جی‌آر‌پی‌سی موقت تست را روی پورت مشخص اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_CORE_REGISTER_AUTH_SMOKE_PORT) {
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

//* این تابع کلاینت آث جی‌آر‌پی‌سی را از روی پروتوی لودشده می‌سازد.
function createAuthSmokeClient(authProtoRoot, port = DEFAULT_CORE_REGISTER_AUTH_SMOKE_PORT) {
    const AuthService = authProtoRoot?.metaverse?.v1?.AuthService;

    if (!AuthService) {
        throw new Error("Auth service client definition was not found");
    }

    return new AuthService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع کلاینت اِستریم ریل‌تایم جی‌آر‌پی‌سی را از روی پروتوی لودشده می‌سازد.
function createRealtimeSmokeClient(realtimeProtoRoot, port = DEFAULT_CORE_REGISTER_AUTH_SMOKE_PORT) {
    const RealtimeStreamService = realtimeProtoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک درخواست رجیستر واقعی و یکتا برای تست می‌سازد.
function createRegisterRequest() {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);

    return {
        email: `g8-grpc-register-${id}@test.local`,
        password: `Test_${id}_12345`,
        userName: `g8_grpc_${id}`.slice(0, 32)
    };
}

//* این تابع یک متد تک‌پاسخ جی‌آر‌پی‌سی را با نام‌های احتمالی پیدا و اجرا می‌کند.
function callUnaryGrpcMethod(client, methodNames = [], request = {}) {
    const methodName = methodNames.find((name) => typeof client?.[name] === "function");

    if (!methodName) {
        throw new Error(`Unary gRPC method was not found: ${methodNames.join(", ")}`);
    }

    return new Promise((resolve, reject) => {
        client[methodName](request, (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(response);
        });
    });
}

//* این تابع رجیستر واقعی را از مسیر سرویس آث جی‌آر‌پی‌سی اجرا می‌کند.
async function registerSmokeUser(authClient, registerRequest) {
    const response = await callUnaryGrpcMethod(authClient, ["Register", "register"], registerRequest);

    if (!response?.success) {
        throw new Error(`Register response was not successful: ${response?.message ?? ""}`);
    }

    if (!response?.accessToken) {
        throw new Error("Register response did not return access token");
    }

    if (!response?.user?.id) {
        throw new Error("Register response did not return user id");
    }

    return response;
}

//* این تابع اِنولوپ آث ریل‌تایم را با اَکسس توکن واقعی رجیستر می‌سازد.
function createRealtimeAuthRawJson(accessToken) {
    return JSON.stringify({
        v: 1,
        ch: "system",
        t: "auth",
        id: `core_register_auth_${Date.now()}`,
        ts: Date.now(),
        room: "",
        payload: {
            accessToken
        },
        requiresAck: false,
        replyTo: ""
    });
}

//* این تابع اِنولوپ آث را روی اوپن اِستریم می‌فرستد و پاسخ آث اوکی را دریافت می‌کند.
function runRealtimeAuthAfterRegister(realtimeClient, authRawJson) {
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
            reject(new Error(`Core register auth smoke timed out after ${DEFAULT_CORE_REGISTER_AUTH_TIMEOUT_MS}ms`));
        }, DEFAULT_CORE_REGISTER_AUTH_TIMEOUT_MS);

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
function assertRegisterRealtimeAuthOkResponse({ registerResponse, authRawJson, authOkRawJson }) {
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
async function cleanupRegisteredSmokeUser(userId) {
    if (SHOULD_KEEP_REGISTERED_USER || !userId) {
        return {
            skipped: true,
            userId
        };
    }

    await RefreshTokenModel.deleteMany({ userId });
    await UserModel.deleteOne({ userId });

    return {
        skipped: false,
        userId
    };
}

//* این تابع کل تست رجیستر واقعی و آث ریل‌تایم را از اتصال دیتابیس تا کنترل پاسخ اجرا می‌کند.
async function runGrpcStreamingRealtimeCoreRegisterAuthSmoke() {
    const grpcServer = new grpc.Server();
    let attachResult = null;
    let registeredUserId = "";

    try {
        await connectDatabase();

        const authProtoRoot = loadAuthProtoRoot();

        registerAuthSmokeService(grpcServer, authProtoRoot);

        attachResult = attachGrpcStreamingRealtimeCore({
            grpcServer,
            logger,
            tokenService
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_CORE_REGISTER_AUTH_SMOKE_PORT);
        const authClient = createAuthSmokeClient(authProtoRoot, boundPort);
        const realtimeClient = createRealtimeSmokeClient(attachResult.protoRoot, boundPort);

        const registerRequest = createRegisterRequest();
        const registerResponse = await registerSmokeUser(authClient, registerRequest);

        registeredUserId = registerResponse.user.id;

        const authRawJson = createRealtimeAuthRawJson(registerResponse.accessToken);
        const authOkRawJson = await runRealtimeAuthAfterRegister(realtimeClient, authRawJson);

        assertRegisterRealtimeAuthOkResponse({
            registerResponse,
            authRawJson,
            authOkRawJson
        });

        logger.info("Grpc streaming realtime core register auth smoke passed", {
            port: boundPort,
            userId: registeredUserId,
            email: registerResponse.user.email,
            userName: registerResponse.user.userName,
            authLength: authRawJson.length,
            authOkLength: authOkRawJson.length,
            stats: attachResult.getStats()
        });

        return true;
    } finally {
        const cleanup = await cleanupRegisteredSmokeUser(registeredUserId);

        logger.info("Grpc streaming realtime core register auth smoke cleanup completed", cleanup);

        attachResult?.stop?.();
        grpcServer.forceShutdown();

        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }
}

//* این تابع خط فرمان تست رجیستر و آث ریل‌تایم را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCoreRegisterAuthSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime core register auth smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل رجیستر واقعی و آث ریل‌تایم از مسیر جی‌آر‌پی‌سی است.
//* این تست ابتدا به دیتابیس وصل می‌شود و سرویس آث واقعی را روی سرور جی‌آر‌پی‌سی موقت ثبت می‌کند.
//* سپس یک یوزر واقعی را از مسیر رجیستر سرویس آث می‌سازد و اَکسس توکن واقعی همان یوزر را می‌گیرد.
//* بعد سرویس اِستریم ریل‌تایم را باز می‌کند و اِنولوپ آث را با همان توکن واقعی ارسال می‌کند.
//* پیام آث از مسیر جی‌آر‌پی‌سی وارد کُر ریل‌تایم، رُتِر سیستم و هندلر آث می‌شود.
//* در پایان پاسخ آث اوکی کنترل می‌شود و داده تستی از دیتابیس پاک می‌شود.
//* هدف این فایل اثبات مسیر کامل رجیستر واقعی تا آث ریل‌تایم بدون تغییر مسیر وب‌سوکت است.

export {
    runGrpcStreamingRealtimeCoreRegisterAuthSmoke,
    createRegisterRequest,
    createRealtimeAuthRawJson,
    assertRegisterRealtimeAuthOkResponse
};
