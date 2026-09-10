import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

import cfg from "../../config/env.js";
import logger from "../../utils/logger.js";
import { authHandlers } from "./handlers/auth.handler.js";
import { authInterceptor } from "./interceptors/auth.interceptor.js";
import { healthHandlers } from "./handlers/health.handler.js";
import { wrapGrpcHandlers } from "./loggingInterceptor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_ROOT = path.resolve(__dirname, "../../../protos");
const AUTH_PROTO_PATH = path.join(PROTO_ROOT, "auth", "auth.proto");
const HEALTH_PROTO_PATH = path.join(PROTO_ROOT, "health.proto");

//* این تابع سرویس‌های پایه را از پکیج لودشده پروتو پیدا می‌کند.
function getGrpcServices(proto) {
    const metaversePackage = proto?.metaverse?.v1;

    if (!metaversePackage) {
        throw new Error("gRPC package metaverse.v1 was not loaded correctly");
    }

    const authServiceDefinition = metaversePackage.AuthService;
    const healthServiceDefinition = metaversePackage.HealthService;

    if (!authServiceDefinition?.service) {
        throw new Error("gRPC AuthService definition was not loaded correctly");
    }

    if (!healthServiceDefinition?.service) {
        throw new Error("gRPC HealthService definition was not loaded correctly");
    }

    return {
        authServiceDefinition,
        healthServiceDefinition
    };
}

//* این تابع پروتوهای پایه سرور جی‌آر‌پی‌سی را لود می‌کند.
function loadBaseGrpcProto() {
    const packageDefinition = protoLoader.loadSync(
        [AUTH_PROTO_PATH, HEALTH_PROTO_PATH],
        {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: false,
            oneofs: true,
            includeDirs: [PROTO_ROOT]
        }
    );

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع سرویس‌های آث و هلث را بدون تغییر مسیر قبلی روی سرور ثبت می‌کند.
function registerBaseGrpcServices(server, proto) {
    const { authServiceDefinition, healthServiceDefinition } = getGrpcServices(proto);

    const authHandlersWithLogging = wrapGrpcHandlers(authHandlers, "AuthService");
    const healthHandlersWithLogging = wrapGrpcHandlers(healthHandlers, "HealthService");

    server.addService(
        authServiceDefinition.service,
        authHandlersWithLogging,
        { interceptors: [authInterceptor] }
    );

    server.addService(
        healthServiceDefinition.service,
        healthHandlersWithLogging
    );
}

//* این تابع اگر کال‌بک اضافه داده شده باشد، آن را قبل از بایند شدن سرور جی‌آر‌پی‌سی اجرا می‌کند.
async function runBeforeBindHook(beforeBind, hookContext) {
    if (typeof beforeBind !== "function") return null;
    return await beforeBind(hookContext);
}

//* این تابع سرور جی‌آر‌پی‌سی پروژه را می‌سازد، سرویس‌های پایه را ثبت می‌کند و سپس روی پورت تنظیم‌شده بایند می‌کند.
export default async function startGrpcServer({ beforeBind = null } = {}) {
    const proto = loadBaseGrpcProto();
    const server = new grpc.Server();
    const bindAddress = `${cfg.grpc.host}:${cfg.grpc.port}`;

    registerBaseGrpcServices(server, proto);

    await runBeforeBindHook(beforeBind, {
        server,
        proto,
        bindAddress
    });

    return new Promise((resolve, reject) => {
        server.bindAsync(
            bindAddress,
            grpc.ServerCredentials.createInsecure(),
            (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                logger.info("✅ gRPC Server running", {
                    host: cfg.grpc.host,
                    port: cfg.grpc.port
                });

                resolve(server);
            }
        );
    });
}

//* توضیح کلی فایل:
//* این فایل سرور جی‌آر‌پی‌سی اصلی پروژه را آماده می‌کند.
//* ابتدا پروتوهای آث و هلث لود می‌شوند.
//* سپس سرویس‌های آث و هلث با همان هندلرها و اینترسپتورهای قبلی روی سرور ثبت می‌شوند.
//* اگر مسیر اضافه‌ای مثل ریل‌تایم جی‌آر‌پی‌سی نیاز به ثبت سرویس داشته باشد، قبل از بایند شدن سرور اجرا می‌شود.
//* در پایان سرور جی‌آر‌پی‌سی روی هاست و پورت تنظیم‌شده بایند می‌شود.
//* هدف این فایل حفظ مسیر قبلی آث و هلث و اضافه کردن نقطه امن برای ثبت سرویس ریل‌تایم است.
