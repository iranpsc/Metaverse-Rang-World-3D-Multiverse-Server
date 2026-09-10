// File => src/core/auth/auth.service.js

import crypto from "crypto";
import { AuthErrors } from "../../domain/auth/authErrors.js";
import { hashPassword, verifyPassword } from "../../domain/auth/passwordService.js";
import { mapAuthError } from "../../transport/grpc/mappers/auth.error.mapper.js";
import { logCall } from "../../transport/grpc/loggingInterceptor.js";
import { readClientInfo } from "../../transport/grpc/clientInfoInterceptor.js";

/**
 * normalizeEmail
 * Normalizes incoming email input
 */
function normalizeEmail(email) {
    if (!email || typeof email !== "string") {
        throw AuthErrors.invalidInput("email is required");
    }

    const normalized = email.trim().toLowerCase();

    if (normalized.length < 3) {
        throw AuthErrors.invalidInput("email is too short");
    }

    return normalized;
}

//* این تابع نام یوزر را برای ذخیره و نمایش استاندارد می کند.
function normalizeUserName(userName) {
    if (typeof userName !== "string") {
        return "";
    }

    const normalized = userName.trim();

    if (!normalized) {
        return "";
    }

    if (normalized.length < 2) {
        throw AuthErrors.invalidInput("userName is too short");
    }

    if (normalized.length > 32) {
        throw AuthErrors.invalidInput("userName is too long");
    }

    return normalized;
}

//* این تابع برای یوزرهای جدید، اگر نام یوزر ارسال نشده باشد، یک نام یوزر پیش فرض می سازد.
function createDefaultUserName(email, userId) {
    const emailText = typeof email === "string" ? email.trim() : "";
    const base = emailText.includes("@") ? emailText.split("@")[0] : emailText;
    const safeBase = base.replace(/[^a-zA-Z0-9_\-.]/g, "").slice(0, 16) || "user";
    const suffix = String(userId ?? "").replace(/-/g, "").slice(0, 8);

    return `${safeBase}_${suffix}`.slice(0, 32);
}

//* این تابع خطای تکراری بودن کلید در مونگو را تشخیص می دهد.
function isMongoDuplicateKeyError(error) {
    return error?.code === 11000 || error?.codeName === "DuplicateKey";
}

//* این تابع مشخص می کند خطای تکراری مونگو مربوط به کدام فیلد یوزر است.
function readMongoDuplicateUserField(error) {
    const keyPattern = error?.keyPattern ?? {};
    const keyValue = error?.keyValue ?? {};
    const keys = new Set([...Object.keys(keyPattern), ...Object.keys(keyValue)]);

    if (keys.has("userNameKey") || keys.has("userName")) {
        return "userName";
    }

    if (keys.has("email")) {
        return "email";
    }

    if (keys.has("userId")) {
        return "userId";
    }

    return "";
}

/**
 * toUserResponse
 * Maps database/domain user to protobuf-compatible user shape
 */
function toUserResponse(user) {
    const id = user?.id ?? user?.userId ?? "";
    const email = user?.email ?? "";
    const rawUserName = user?.userName ?? "";

    let userName = String(rawUserName ?? "").trim();

    if (!userName && email) {
        userName = email.includes("@") ? email.split("@")[0] : email;
    }

    let createdAtUnix = 0;

    if (user?.createdAtUnix !== undefined && user?.createdAtUnix !== null) {
        createdAtUnix = Number(user.createdAtUnix) || 0;
    } else if (user?.createdAt) {
        const ms = new Date(user.createdAt).getTime();
        createdAtUnix = Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
    }

    return {
        id,
        email,
        createdAtUnix,
        userName
    };
}

/**
 * AuthService
 * Core service layer for auth workflows
 */
export class AuthService {
    constructor({ userRepository, refreshTokenRepository, tokenService }) {
        if (!userRepository) {
            throw new Error("AuthService: userRepository is not provided");
        }

        if (!refreshTokenRepository) {
            throw new Error("AuthService: refreshTokenRepository is not provided");
        }

        if (!tokenService) {
            throw new Error("AuthService: tokenService is not provided");
        }

        this.userRepository = userRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.tokenService = tokenService;
    }

    /**
     * register
     * ایجاد کاربر جدید
     */
    async register({ email, password, userName }) {
        const normalizedEmail = normalizeEmail(email);

        if (!password || typeof password !== "string") {
            throw AuthErrors.invalidInput("password is required");
        }

        if (password.length < 4) {
            throw AuthErrors.invalidInput("password must be at least 4 chars");
        }

        const existingUser = await this.userRepository.findByEmail(normalizedEmail);

        if (existingUser) {
            throw AuthErrors.emailAlreadyExists();
        }

        const userId = crypto.randomUUID();
        const requestedUserName = normalizeUserName(userName ?? "");
        const finalUserName = requestedUserName || createDefaultUserName(normalizedEmail, userId);

        if (requestedUserName) {
            const existingUserName = await this.userRepository.findByUserName(requestedUserName);

            if (existingUserName) {
                throw AuthErrors.userNameAlreadyExists();
            }
        }

        const passwordHash = await hashPassword(password);

        let createdUser;

        try {
            createdUser = await this.userRepository.create({
                userId,
                email: normalizedEmail,
                userName: finalUserName,
                passwordHash
            });
        } catch (error) {
            if (isMongoDuplicateKeyError(error)) {
                const duplicateField = readMongoDuplicateUserField(error);

                if (duplicateField === "userName") {
                    throw AuthErrors.userNameAlreadyExists();
                }

                if (duplicateField === "email") {
                    throw AuthErrors.emailAlreadyExists();
                }

                throw AuthErrors.conflict("USER_ALREADY_EXISTS");
            }

            throw error;
        }

        const accessToken = this.tokenService.createAccessToken(createdUser);
        const refreshToken = await this.tokenService.createRefreshToken(createdUser);

        return {
            success: true,
            message: "ok",
            accessToken,
            refreshToken,
            expiresIn: this.tokenService.config.jwt.accessTtlSeconds,
            user: toUserResponse(createdUser)
        };
    }

    /**
     * login
     * احراز هویت و صدور توکن
     */
    async login({ email, password, ip = "", userAgent = "" }) {
        const normalizedEmail = normalizeEmail(email);

        if (!password || typeof password !== "string") {
            throw AuthErrors.invalidInput("password is required");
        }

        const user = await this.userRepository.findByEmail(normalizedEmail);

        if (!user) {
            throw AuthErrors.unauth("invalid credentials");
        }

        const ok = await verifyPassword(password, user.passwordHash);

        if (!ok) {
            throw AuthErrors.unauth("invalid credentials");
        }

        await this.userRepository.updateLastLogin(user.userId ?? user.id);

        const accessToken = this.tokenService.createAccessToken(user);
        const refreshToken = await this.tokenService.createRefreshToken(
            user,
            userAgent,
            ip
        );

        return {
            success: true,
            message: "ok",
            accessToken,
            refreshToken,
            expiresIn: this.tokenService.config.jwt.accessTtlSeconds,
            user: toUserResponse(user)
        };
    }

    /**
     * refresh
     * چرخش Refresh Token
     */
    async refresh({ refreshToken, ip = "", userAgent = "" }) {
        if (!refreshToken || typeof refreshToken !== "string") {
            throw AuthErrors.invalidInput("refreshToken is required");
        }

        const rotated = await this.tokenService.rotateRefreshToken(
            refreshToken,
            userAgent,
            ip
        );

        const payload = this.tokenService.verifyAccessToken(rotated.accessToken);
        const userId = payload?.sub;

        if (!userId) {
            throw AuthErrors.unauth("invalid access token");
        }

        const user = await this.userRepository.findByUserId(userId);

        if (!user) {
            throw AuthErrors.notFound("user not found");
        }

        return {
            success: true,
            message: "ok",
            accessToken: rotated.accessToken,
            refreshToken: rotated.refreshToken,
            expiresIn: rotated.expiresIn,
            user: toUserResponse(user)
        };
    }

    /**
     * getUserData
     * دریافت اطلاعات کاربر لاگین شده
     */
    async getUserData({ userId }) {
        if (!userId || typeof userId !== "string") {
            throw AuthErrors.unauth("missing user");
        }

        const user = await this.userRepository.findByUserId(userId);

        if (!user) {
            throw AuthErrors.notFound("user not found");
        }

        return {
            success: true,
            message: "ok",
            user: toUserResponse(user)
        };
    }

    /**
     * logout
     * Backward-compatible alias for logoutAllDevices
     */
    async logout({ userId }) {
        return this.logoutAllDevices({ userId });
    }

    /**
     * logoutCurrentSession
     * Logs out only the current device/session
     */
    async logoutCurrentSession({ userId, refreshToken }) {
        if (!userId || typeof userId !== "string") {
            throw AuthErrors.unauth("missing user");
        }

        if (!refreshToken || typeof refreshToken !== "string") {
            throw AuthErrors.invalidInput("refreshToken is required");
        }

        await this.tokenService.logoutCurrentSession({
            userId,
            refreshToken
        });

        return {
            success: true,
            message: "ok"
        };
    }

    /**
     * logoutAllDevices
     * Logs out the user from all devices
     */
    async logoutAllDevices({ userId }) {
        if (!userId || typeof userId !== "string") {
            throw AuthErrors.unauth("missing user");
        }

        await this.tokenService.logoutAllDevices(userId);

        return {
            success: true,
            message: "ok"
        };
    }
}

/**
 * createAuthServiceHandlers
 * Backward-compatible gRPC-style wrapper around AuthService
 */
export function createAuthServiceHandlers(authService) {
    return {
        Register: async (call, callback) => {
            logCall("AuthService.Register", call);
            const ci = readClientInfo(call);

            try {
                const { email, password, userName } = call.request || {};

                const res = await authService.register({
                    email,
                    password,
                    userName
                });

                callback(null, res);
            } catch (e) {
                const g = mapAuthError(e);
                const detailMsg = `${g.message} (platform=${ci.platform} version=${ci.version})`;
                callback({ code: g.code, details: detailMsg });
            }
        },

        Login: async (call, callback) => {
            logCall("AuthService.Login", call);
            const ci = readClientInfo(call);

            try {
                const { email, password } = call.request || {};
                const meta = call?.metadata;
                const userAgent = meta?.get?.("user-agent")?.[0] || "";
                const ip = meta?.get?.("x-forwarded-for")?.[0] || "";

                const res = await authService.login({
                    email,
                    password,
                    ip,
                    userAgent
                });

                callback(null, res);
            } catch (e) {
                const g = mapAuthError(e);
                const detailMsg = `${g.message} (platform=${ci.platform} version=${ci.version})`;
                callback({ code: g.code, details: detailMsg });
            }
        },

        Refresh: async (call, callback) => {
            logCall("AuthService.Refresh", call);
            const ci = readClientInfo(call);

            try {
                const { refreshToken } = call.request || {};
                const meta = call?.metadata;
                const userAgent = meta?.get?.("user-agent")?.[0] || "";
                const ip = meta?.get?.("x-forwarded-for")?.[0] || "";

                const res = await authService.refresh({
                    refreshToken,
                    ip,
                    userAgent
                });

                callback(null, res);
            } catch (e) {
                const g = mapAuthError(e);
                const detailMsg = `${g.message} (platform=${ci.platform} version=${ci.version})`;
                callback({ code: g.code, details: detailMsg });
            }
        },

        GetUserData: async (call, callback) => {
            logCall("AuthService.GetUserData", call);
            const ci = readClientInfo(call);

            try {
                const userId = call?.user?.userId ?? call?.user?.id ?? "";
                const res = await authService.getUserData({ userId });

                callback(null, res);
            } catch (e) {
                const g = mapAuthError(e);
                const detailMsg = `${g.message} (platform=${ci.platform} version=${ci.version})`;
                callback({ code: g.code, details: detailMsg });
            }
        },

        Logout: async (call, callback) => {
            logCall("AuthService.Logout", call);
            const ci = readClientInfo(call);

            try {
                const userId = call?.user?.userId ?? call?.user?.id ?? "";
                const res = await authService.logout({ userId });

                callback(null, res);
            } catch (e) {
                const g = mapAuthError(e);
                const detailMsg = `${g.message} (platform=${ci.platform} version=${ci.version})`;
                callback({ code: g.code, details: detailMsg });
            }
        },

        LogoutAllDevices: async (call, callback) => {
            logCall("AuthService.LogoutAllDevices", call);
            const ci = readClientInfo(call);

            try {
                const userId = call?.user?.userId ?? call?.user?.id ?? "";
                const res = await authService.logoutAllDevices({ userId });

                callback(null, res);
            } catch (e) {
                const g = mapAuthError(e);
                const detailMsg = `${g.message} (platform=${ci.platform} version=${ci.version})`;
                callback({ code: g.code, details: detailMsg });
            }
        }
    };
}