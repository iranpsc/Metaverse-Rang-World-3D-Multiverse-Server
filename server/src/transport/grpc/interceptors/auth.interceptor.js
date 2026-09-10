// File ==> src/transport/grpc/interceptors/auth.interceptor.js
// src/transport/grpc/interceptors/auth.interceptor.js
//پس اینترسپتور کنترل ورود است، هندلر اجرای عملیات است.
import grpc from "@grpc/grpc-js";
import { tokenService } from "../../../core/auth/auth.instance.js";
import { AuthErrors } from "../../../domain/auth/authErrors.js";
import { mapAuthError } from "../mappers/auth.error.mapper.js";

/**
 * RPCs that do NOT require authentication
 */
const PUBLIC_METHODS = new Set(["Register", "Login", "LoginWithMicroservice", "Refresh"]);

/**
 * getMethodName
 * Extracts RPC method name from interceptor options
 */
function getMethodName(options) {
    const fullPath = options?.method_definition?.path || "";
    return fullPath.split("/").pop() || "";
}

/**
 * extractBearerToken
 * Reads Authorization metadata and returns bearer token
 */
function extractBearerToken(metadata) {
    const authHeader = metadata?.get?.("authorization")?.[0] || "";

    if (!authHeader || typeof authHeader !== "string") {
        throw AuthErrors.unauth("missing authorization header");
    }

    if (!authHeader.startsWith("Bearer ")) {
        throw AuthErrors.unauth("invalid authorization scheme");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
        throw AuthErrors.unauth("missing access token");
    }

    return token;
}

/**
 * authInterceptor
 * gRPC interceptor for Access Token verification
 */
export function authInterceptor(options, nextCall) {
    return new grpc.InterceptingCall(nextCall(options), {
        start(metadata, listener, next) {
            const methodName = getMethodName(options);

            if (PUBLIC_METHODS.has(methodName)) {
                return next(metadata, listener);
            }

            try {
                const accessToken = extractBearerToken(metadata);
                const payload = tokenService.verifyAccessToken(accessToken);

                if (!payload?.sub || !payload?.jti) {
                    throw AuthErrors.unauth("invalid token claims");
                }

                options.call.user = {
                    id: payload.sub,
                    userId: payload.sub,
                    tokenId: payload.jti,
                    issuedAt: payload.iat ?? 0,
                    email: payload.email ?? ""
                };

                return next(metadata, listener);
            } catch (err) {
                const grpcError = mapAuthError(err);

                listener.onReceiveStatus({
                    code: grpcError.code,
                    details: grpcError.message,
                    metadata: new grpc.Metadata()
                });
            }
        }
    });
}
/* 
فایل src / transport / grpc / interceptors / auth.interceptor.js مسئول کنترل احراز هویت قبل از رسیدن requestهای gRPC به handlerهای Auth است.این فایل نام متد gRPC را از مسیر request استخراج می‌کند و اگر متد جزو Register، Login یا Refresh باشد، اجازه می‌دهد بدون access token به handler برسد.

برای متدهای محافظت‌شده مثل GetUserData و Logout، این interceptor مقدار authorization را از metadata می‌خواند، access token را از قالب Bearer استخراج می‌کند و با استفاده از tokenService.verifyAccessToken آن را بررسی می‌کند.اگر token معتبر باشد، اطلاعات کاربر مانند userId، tokenId، زمان صدور و ایمیل داخل options.call.user قرار می‌گیرد و request به handler ادامه پیدا می‌کند.اگر token نامعتبر باشد یا وجود نداشته باشد، request قبل از رسیدن به handler متوقف می‌شود و خطای استاندارد gRPC به کلاینت برگردانده می‌شود.

 */