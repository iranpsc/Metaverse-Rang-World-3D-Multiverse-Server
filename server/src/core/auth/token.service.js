// src/core/auth/token.service.js

import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { AuthErrors } from "../../domain/auth/authErrors.js";

/**
 * TokenService
 * سرویس تولید و اعتبارسنجی Access Token و Refresh Token
 */
export class TokenService {//در auth.instance.js از این کلاس نمونه ساخته می‌شود و به AuthService داده می‌شود.
    constructor({ config, refreshTokenRepository = null }) {
        if (!config) {
            throw new Error("TokenService: config is not provided");
        }

        this.config = config;
        this.refreshTokenRepository = refreshTokenRepository;

        this.accessPrivateKey = this.readKeyFile(
            this.config.jwt.accessPrivateKeyPath,
            "JWT_ACCESS_PRIVATE_KEY_PATH"
        );

        this.accessPublicKey = this.readKeyFile(
            this.config.jwt.accessPublicKeyPath,
            "JWT_ACCESS_PUBLIC_KEY_PATH"
        );

        this.refreshPrivateKey = this.readKeyFile(
            this.config.jwt.refreshPrivateKeyPath,
            "JWT_REFRESH_PRIVATE_KEY_PATH"
        );

        this.refreshPublicKey = this.readKeyFile(
            this.config.jwt.refreshPublicKeyPath,
            "JWT_REFRESH_PUBLIC_KEY_PATH"
        );
    }

    /**
     * readKeyFile
     * Reads PEM key file from disk
     */
    readKeyFile(filePath, fieldName) {
        try {
            return fs.readFileSync(filePath, "utf8");
        } catch (error) {
            throw new Error(`TokenService: failed to read ${fieldName} at ${filePath}`);
        }
    }

    /**
     * ensureRefreshTokenRepository
     * Ensures repository-dependent methods are not called without repository
     */
    ensureRefreshTokenRepository(methodName) {
        if (!this.refreshTokenRepository) {
            throw AuthErrors.internal(
                `TokenService: refreshTokenRepository is required for ${methodName}`
            );
        }
    }

    /**
     * normalizeUserIdentity
     * Normalizes user payload for token generation
     */
    //این تابع ورودی کاربر را به یک شکل استاندارد تبدیل می‌کند.
    normalizeUserIdentity(userOrId) {
        if (!userOrId) {
            throw AuthErrors.invalidInput("user is required");
        }

        if (typeof userOrId === "string") {
            return {
                userId: userOrId,
                email: "",
                userName: ""
            };
        }

        const userId = userOrId.id ?? userOrId.userId ?? "";
        const email = userOrId.email ?? "";
        const rawUserName = userOrId.userName ?? "";
        const userName = String(rawUserName ?? "").trim();

        if (!userId) {
            throw AuthErrors.invalidInput("user id is required");
        }

        return {
            userId,
            email,
            userName
        };
    }

    /**
     * createAccessToken
     * تولید JWT کوتاه‌عمر برای دسترسی
     */
    createAccessToken(userOrId) {
        const { userId, email, userName } = this.normalizeUserIdentity(userOrId);

        const payload = {
            sub: userId,
            iss: this.config.jwt.issuer,
            aud: this.config.jwt.audience,
            ver: 1,
            jti: uuidv4()
        };

        if (email) {
            payload.email = email;
        }
        if (userName) {
            payload.userName = userName;
        }
        return jwt.sign(payload, this.accessPrivateKey, {
            algorithm: this.config.jwt.algorithm,
            expiresIn: this.config.jwt.accessExpiresIn,
            keyid: this.config.jwt.accessKeyId
        });
    }

    /**
     * createRefreshToken
     * تولید Refresh Token بلندمدت و ذخیره hash آن
     */
    async createRefreshToken(userOrId, userAgent = "", ip = "") {
        this.ensureRefreshTokenRepository("createRefreshToken");

        const { userId, email, userName } = this.normalizeUserIdentity(userOrId);
        const tokenId = uuidv4();

        const payload = {
            sub: userId,
            iss: this.config.jwt.issuer,
            aud: this.config.jwt.audience,
            jti: tokenId
        };

        if (email) {
            payload.email = email;
        }
        if (userName) {
            payload.userName = userName;
        }
        const refreshToken = jwt.sign(payload, this.refreshPrivateKey, {
            algorithm: this.config.jwt.algorithm,
            expiresIn: this.config.jwt.refreshExpiresIn,
            keyid: this.config.jwt.refreshKeyId
        });

        const refreshHash = await bcrypt.hash(refreshToken, 10);

        await this.refreshTokenRepository.create({
            tokenId,
            userId,
            refreshHash,
            userAgent,
            ip,
            expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlMs)
        });

        return refreshToken;
    }

    /**
     * verifyAccessToken
     * اعتبارسنجی Access Token
     */
    verifyAccessToken(token) {
        return jwt.verify(token, this.accessPublicKey, {
            algorithms: [this.config.jwt.algorithm],
            issuer: this.config.jwt.issuer,
            audience: this.config.jwt.audience
        });
    }

    /**
     * verifyRefreshToken
     * اعتبارسنجی اولیه Refresh Token
     */
    verifyRefreshToken(token) {
        return jwt.verify(token, this.refreshPublicKey, {
            algorithms: [this.config.jwt.algorithm],
            issuer: this.config.jwt.issuer,
            audience: this.config.jwt.audience
        });
    }

    /**
     * rotateRefreshToken
     * باطل کردن refresh قبلی و صدور جفت توکن جدید
     */
    async rotateRefreshToken(oldToken, userAgent = "", ip = "") {
        this.ensureRefreshTokenRepository("rotateRefreshToken");

        let decoded;
        try {
            decoded = this.verifyRefreshToken(oldToken);
        } catch (error) {
            throw AuthErrors.unauth("invalid refresh token");
        }

        const userId = decoded?.sub;
        const tokenId = decoded?.jti;
        const email = decoded?.email ?? "";
        const userName = decoded?.userName ?? "";

        if (!userId || !tokenId) {
            throw AuthErrors.unauth("invalid refresh token");
        }

        const record = await this.refreshTokenRepository.findByTokenId(tokenId);
        if (!record || record.isRevoked) {
            throw AuthErrors.unauth("refresh token revoked");
        }

        const match = await bcrypt.compare(oldToken, record.refreshHash);
        if (!match) {
            throw AuthErrors.unauth("invalid refresh token");
        }

        await this.refreshTokenRepository.revoke(tokenId);

        const userIdentity = {
            id: userId,
            email,
            userName
        };

        const newRefreshToken = await this.createRefreshToken(
            userIdentity,
            userAgent,
            ip
        );

        const newAccessToken = this.createAccessToken(userIdentity);

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: this.config.jwt.accessTtlSeconds
        };
    }


    /**
 * logoutCurrentSession
 * Revokes only the refresh token used by the current device/session
 */
    async logoutCurrentSession({ userId, refreshToken }) {
        this.ensureRefreshTokenRepository("logoutCurrentSession");

        if (!userId || typeof userId !== "string") {
            throw AuthErrors.unauth("missing user");
        }

        if (!refreshToken || typeof refreshToken !== "string") {
            throw AuthErrors.invalidInput("refreshToken is required");
        }

        let decoded;
        try {
            decoded = this.verifyRefreshToken(refreshToken);
        } catch (error) {
            throw AuthErrors.unauth("invalid refresh token");
        }

        const tokenUserId = decoded?.sub ?? "";
        const tokenId = decoded?.jti ?? "";

        if (!tokenUserId || !tokenId) {
            throw AuthErrors.unauth("invalid refresh token");
        }

        if (tokenUserId !== userId) {
            throw AuthErrors.unauth("refresh token user mismatch");
        }

        const record = await this.refreshTokenRepository.findByTokenId(tokenId);
        if (!record || record.isRevoked) {
            throw AuthErrors.unauth("refresh token revoked");
        }

        if (record.userId !== userId) {
            throw AuthErrors.unauth("refresh token user mismatch");
        }

        const match = await bcrypt.compare(refreshToken, record.refreshHash);
        if (!match) {
            throw AuthErrors.unauth("invalid refresh token");
        }

        await this.refreshTokenRepository.revoke(tokenId);
    }


    /**
* logout
* Backward-compatible alias for logoutAllDevices
*/
    async logout(userOrId) {
        await this.logoutAllDevices(userOrId);
    }


    /**
     * logoutAllDevices
     * Revokes all refresh tokens that belong to the same user
     */
    async logoutAllDevices(userOrId) {
        this.ensureRefreshTokenRepository("logoutAllDevices");

        const { userId } = this.normalizeUserIdentity(userOrId);
        await this.refreshTokenRepository.revokeAllForUser(userId);
    }
}

/* خواندن private key و public key از فایل‌های PEM
ساخت access token
ساخت refresh token
ذخیره hash مربوط به refresh token در دیتابیس
verify کردن access token
verify کردن refresh token
rotate کردن refresh token
logout و باطل کردن refresh tokenهای کاربر

 */
/* 
فایل src / core / auth / token.service.js مسئول ساخت، اعتبارسنجی و مدیریت tokenهای سیستم Auth است.این فایل هنگام ساخته شدن، کلیدهای خصوصی و عمومی مربوط به access token و refresh token را از مسیرهای تعریف‌شده در config می‌خواند و سپس با استفاده از jsonwebtoken توکن‌های JWT را ایجاد یا بررسی می‌کند.

در مسیر Register، بعد از اینکه کاربر جدید در دیتابیس ساخته شد، authService.register ابتدا متد createAccessToken را صدا می‌زند تا access token کوتاه‌مدت برای کاربر ساخته شود.سپس متد createRefreshToken اجرا می‌شود تا refresh token بلندمدت ساخته شود.در این مرحله، خود refresh token خام به کلاینت برگردانده می‌شود، اما hash آن با bcrypt در دیتابیس ذخیره می‌شود تا در آینده هنگام Refresh قابل بررسی باشد.

این فایل همچنین برای مسیر Refresh متد rotateRefreshToken را دارد که refresh token قدیمی را verify می‌کند، رکورد آن را در دیتابیس پیدا می‌کند، با hash ذخیره‌شده مقایسه می‌کند، token قبلی را revoke می‌کند و سپس یک access token و refresh token جدید می‌سازد.برای Logout نیز متد logout همه refresh tokenهای کاربر را از طریق repository باطل می‌کند. */