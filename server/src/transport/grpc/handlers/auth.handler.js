// File ==> src/transport/grpc/handlers/auth.handler.js
// src/transport/grpc/handlers/auth.handler.js

import { authService, tokenService } from "../../../core/auth/auth.instance.js";
import { microserviceAuthUseCase, microserviceProfileRepository } from "../../../core/auth/microserviceAuth.instance.js";
import { AuthErrors } from "../../../domain/auth/authErrors.js";
import { mapAuthError } from "../mappers/auth.error.mapper.js";

/**
 * extractClientInfo
 * استخراج IP و User-Agent از metadata
 */
function extractClientInfo(metadata) {
    const userAgent =
        metadata?.get?.("user-agent")?.[0] ||
        "unknown";

    const forwardedFor =
        metadata?.get?.("x-forwarded-for")?.[0] ||
        "";

    const peer =
        metadata?.get?.("peer")?.[0] ||
        "";

    const ip = forwardedFor || peer || "unknown";

    return { ip, userAgent };
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
 * getAuthenticatedUserId
 * Uses call.user when available, otherwise falls back to verifying authorization metadata
 */
function getAuthenticatedUserId(call) {
    const fromInjectedUser = call?.user?.userId ?? call?.user?.id ?? "";
    if (fromInjectedUser) {
        return fromInjectedUser;
    }

    const accessToken = extractBearerToken(call?.metadata);
    const payload = tokenService.verifyAccessToken(accessToken);

    const userId = payload?.sub ?? "";
    if (!userId) {
        throw AuthErrors.unauth("missing user");
    }

    return userId;
}

/**
 * Auth gRPC Handlers
 */
export const authHandlers = {
    /**
     * Register
     * ایجاد کاربر جدید
     */
    async Register(call, callback) {
        try {
            const { email, password, userName } = call.request || {};

            const result = await authService.register({
                email,
                password,
                userName
            });

            callback(null, {
                success: result.success,
                message: result.message,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresIn: result.expiresIn,
                user: result.user
            });
        } catch (err) {
            const grpcError = mapAuthError(err);
            callback(grpcError);
        }
    },

    /**
     * Login
     * احراز هویت و صدور توکن
     */
    async Login(call, callback) {
        try {
            const { email, password } = call.request || {};
            const { ip, userAgent } = extractClientInfo(call.metadata);

            const result = await authService.login({
                email,
                password,
                ip,
                userAgent
            });

            callback(null, {
                success: result.success,
                message: result.message,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresIn: result.expiresIn,
                user: result.user
            });
        } catch (err) {
            const grpcError = mapAuthError(err);
            callback(grpcError);
        }
    },

    /**
     * Refresh
     * تمدید Access/Refresh Token
     */
    async Refresh(call, callback) {
        try {
            const { refreshToken } = call.request || {};
            const { ip, userAgent } = extractClientInfo(call.metadata);

            const result = await authService.refresh({
                refreshToken,
                ip,
                userAgent
            });

            callback(null, {
                success: result.success,
                message: result.message,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresIn: result.expiresIn,
                user: result.user
            });
        } catch (err) {
            const grpcError = mapAuthError(err);
            callback(grpcError);
        }
    },

    /**
     * GetUserData
     * دریافت اطلاعات کاربر لاگین‌شده
     */
    async GetUserData(call, callback) {
        try {
            const userId = getAuthenticatedUserId(call);

            const result = await authService.getUserData({
                userId
            });

            callback(null, {
                success: result.success,
                message: result.message,
                user: result.user
            });
        } catch (err) {
            const grpcError = mapAuthError(err);
            callback(grpcError);
        }
    },

    /**
  * Logout
  * خروج فقط از همین دستگاه
  */
    async Logout(call, callback) {
        try {
            const userId = getAuthenticatedUserId(call);
            const { refreshToken } = call.request || {};

            const result = await authService.logoutCurrentSession({
                userId,
                refreshToken
            });

            callback(null, {
                success: result.success,
                message: result.message
            });
        } catch (err) {
            const grpcError = mapAuthError(err);
            callback(grpcError);
        }
    },
    /**
 * LogoutAllDevices
 * خروج از همه دستگاه‌های همین کاربر
 */
    async LogoutAllDevices(call, callback) {
        try {
            const userId = getAuthenticatedUserId(call);

            const result = await authService.logoutAllDevices({
                userId
            });

            callback(null, {
                success: result.success,
                message: result.message
            });
        } catch (err) {
            const grpcError = mapAuthError(err);
            callback(grpcError);
        }
    }
};
/* 
فایل src / transport / grpc / handlers / auth.handler.js پیاده‌سازی handlerهای سرویس Auth در gRPC است.این فایل متدهای Register، Login، Refresh، GetUserData و Logout را از سمت gRPC دریافت می‌کند، داده‌های لازم را از call.request و call.metadata استخراج می‌کند، سپس عملیات اصلی را به authService می‌سپارد و نتیجه را با callback به کلاینت برمی‌گرداند.

در این فایل، متدهای Register، Login و Refresh برای دریافت یا تمدید token استفاده می‌شوند، اما متدهای GetUserData و Logout نیاز به کاربر احراز هویت‌شده دارند و از تابع getAuthenticatedUserId برای پیدا کردن userId استفاده می‌کنند.خطاهای داخلی نیز قبل از ارسال به کلاینت با mapAuthError به خطای استاندارد gRPC تبدیل می‌شوند.

 */

/**
 * LoginWithMicroservice
 * ورود ترکیبی با میکروسرویس و صدور توکن داخلی بازی
 * این متد به انتهای authHandlers اضافه می‌شود و هیچ تابع قبلی را حذف نمی‌کند.
 */
authHandlers.LoginWithMicroservice = async function LoginWithMicroservice(call, callback) {
    try {
        const { email, password, userName } = call.request || {};
        const { ip, userAgent } = extractClientInfo(call.metadata);
        const username = email || userName;

        const result = await microserviceAuthUseCase.loginOrRegisterWithMicroservice({
            username,
            password,
            ip,
            userAgent
        });

        callback(null, {
            success: result.success,
            message: result.message,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresIn: result.expiresIn,
            user: result.user
        });
    } catch (err) {
        const grpcError = mapAuthError(err);
        callback(grpcError);
    }
};


async function handleMicroserviceBackedAuthMethod(call, callback) {
    try {
        const { email, password, userName } = call.request || {};
        const { ip, userAgent } = extractClientInfo(call.metadata);
        const username = email || userName;

        const result = await microserviceAuthUseCase.loginOrRegisterWithMicroservice({
            username,
            password,
            ip,
            userAgent
        });

        callback(null, {
            success: result.success,
            message: result.message,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresIn: result.expiresIn,
            user: result.user
        });
    } catch (err) {
        const grpcError = mapAuthError(err);
        callback(grpcError);
    }
}

if (process.env.AUTH_MICROSERVICE_REPLACE_LOGIN_REGISTER === "true") {
    authHandlers.Register = handleMicroserviceBackedAuthMethod;
    authHandlers.Login = handleMicroserviceBackedAuthMethod;
}


authHandlers.GetMicroserviceUserData = async function GetMicroserviceUserData(call, callback) {
    try {
        const userId = getAuthenticatedUserId(call);
        const profile = await microserviceProfileRepository.findByUserId(userId);

        if (!profile) {
            callback(null, {
                success: false,
                message: "microservice profile not found",
                profile: null
            });
            return;
        }

        const lastSyncAtUnix = profile.lastSyncAt
            ? Math.floor(new Date(profile.lastSyncAt).getTime() / 1000)
            : 0;

        callback(null, {
            success: true,
            message: "ok",
            profile: {
                microserviceId: profile.microserviceId || "",
                name: profile.name || "",
                code: profile.code || "",
                avatar: profile.avatar || "",
                microserviceUserName: profile.microserviceUserName || "",
                lastSyncAtUnix
            }
        });
    } catch (err) {
        const grpcError = mapAuthError(err);
        callback(grpcError);
    }
};
