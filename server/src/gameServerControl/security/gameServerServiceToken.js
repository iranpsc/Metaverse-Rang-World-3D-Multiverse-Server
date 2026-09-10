// File => src/gameServerControl/security/gameServerServiceToken.js

import crypto from "crypto";

const SERVICE_TOKEN_VERSION = "mgst1";
const DEFAULT_TOKEN_TTL_SECONDS = 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 5;
const DEFAULT_PURPOSE = "game_server_control";
const DEFAULT_SERVICE_SECRET = "change_me";
const DEFAULT_MAX_TOKEN_TTL_SECONDS = 300;
const DEFAULT_MIN_SERVICE_SECRET_LENGTH = 64;
const DEFAULT_REQUIRE_STRONG_SERVICE_SECRET = true;
const DEFAULT_MAX_METADATA_JSON_BYTES = 2048;

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مقدار عدد صحیح را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار بولی را از اِنوی می خواند.
function readBooleanEnv(name, fallbackValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    const normalizedValue = String(rawValue).trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalizedValue)) return true;
    if (["0", "false", "no", "off"].includes(normalizedValue)) return false;

    return fallbackValue;
}

//* این تابع مقدار عدد صحیح را از اِنوی می خواند.
function readIntegerEnv(name, fallbackValue, minValue, maxValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    return clampInteger(rawValue, fallbackValue, minValue, maxValue);
}

//* این تابع رشته را تمیز می کند و اگر خالی بود مقدار پیش فرض می دهد.
function cleanString(value, fallbackValue = "") {
    if (!isNonEmptyString(value)) return fallbackValue;
    return value.trim();
}

//* این تابع مقدار باینری را به بیس شصت و چهار یو آر ال امن تبدیل می کند.
function base64UrlEncode(value) {
    return Buffer
        .from(value)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

//* این تابع مقدار بیس شصت و چهار یو آر ال امن را به رشته تبدیل می کند.
function base64UrlDecode(value) {
    if (!isNonEmptyString(value)) return "";

    const normalizedValue = value
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const padding = normalizedValue.length % 4 === 0 ? "" : "=".repeat(4 - (normalizedValue.length % 4));
    return Buffer.from(normalizedValue + padding, "base64").toString("utf8");
}

//* این تابع آبجکت را به جیسون بیس شصت و چهار یو آر ال امن تبدیل می کند.
function encodePayload(payload) {
    return base64UrlEncode(JSON.stringify(payload));
}

//* این تابع پِیلود توکن را از بیس شصت و چهار یو آر ال امن می خواند.
function decodePayload(encodedPayload) {
    const json = base64UrlDecode(encodedPayload);
    if (!json) return null;

    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

//* این تابع نانس امن برای توکن سرویس می سازد.
function createNonce() {
    return crypto.randomBytes(16).toString("hex");
}

//* این تابع امضای امن برای پِیلود توکن سرویس می سازد.
function signPayload(encodedPayload, serviceSecret) {
    return crypto
        .createHmac("sha256", serviceSecret)
        .update(encodedPayload)
        .digest("hex");
}

//* این تابع دو رشته را با مقایسه امن بررسی می کند.
function safeStringEquals(a, b) {
    if (!isNonEmptyString(a) || !isNonEmptyString(b)) return false;

    const aBuffer = Buffer.from(a, "utf8");
    const bBuffer = Buffer.from(b, "utf8");

    if (aBuffer.length !== bBuffer.length) return false;

    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

//* این تابع توکن سرویس را به بخش های داخلی تقسیم می کند.
function parseServiceToken(token) {
    if (!isNonEmptyString(token)) {
        return { success: false, reason: "token_required", version: "", encodedPayload: "", signature: "", payload: null };
    }

    const parts = token.trim().split(".");

    if (parts.length !== 3) {
        return { success: false, reason: "token_format_invalid", version: "", encodedPayload: "", signature: "", payload: null };
    }

    const [version, encodedPayload, signature] = parts;

    if (version !== SERVICE_TOKEN_VERSION) {
        return { success: false, reason: "token_version_invalid", version, encodedPayload, signature, payload: null };
    }

    const payload = decodePayload(encodedPayload);

    if (!payload) {
        return { success: false, reason: "token_payload_invalid", version, encodedPayload, signature, payload: null };
    }

    return { success: true, reason: "token_parsed", version, encodedPayload, signature, payload };
}

//* این تابع توکن سرویس را از هدرهای درخواست می خواند.
function extractServiceTokenFromHeaders(headers = {}) {
    const authorization = headers.authorization ?? headers.Authorization;

    if (isNonEmptyString(authorization)) {
        const normalizedAuthorization = authorization.trim();

        if (normalizedAuthorization.toLowerCase().startsWith("bearer ")) {
            return normalizedAuthorization.slice(7).trim();
        }
    }

    return headers["x-metaverse-game-server-token"] ??
        headers["X-Metaverse-Game-Server-Token"] ??
        headers["x-game-server-service-token"] ??
        headers["X-Game-Server-Service-Token"] ??
        "";
}

//* این کلاس ساخت و بررسی توکن سرویس ددیکیتد سرور را مدیریت می کند.
class GameServerServiceToken {
    constructor(options = {}) {
        this.serviceSecret = cleanString(options.serviceSecret, DEFAULT_SERVICE_SECRET);
        this.maxTtlSeconds = clampInteger(
            options.maxTtlSeconds ??
                readIntegerEnv("GAME_SERVER_SERVICE_TOKEN_MAX_TTL_SECONDS", DEFAULT_MAX_TOKEN_TTL_SECONDS, 5, 86400),
            DEFAULT_MAX_TOKEN_TTL_SECONDS,
            5,
            86400
        );
        this.defaultTtlSeconds = clampInteger(options.defaultTtlSeconds, DEFAULT_TOKEN_TTL_SECONDS, 5, this.maxTtlSeconds);
        this.clockSkewSeconds = clampInteger(options.clockSkewSeconds, DEFAULT_CLOCK_SKEW_SECONDS, 0, 60);
        this.purpose = cleanString(options.purpose, DEFAULT_PURPOSE);
        this.minServiceSecretLength = clampInteger(
            options.minServiceSecretLength ??
                readIntegerEnv("GAME_SERVER_SERVICE_SECRET_MIN_LENGTH", DEFAULT_MIN_SERVICE_SECRET_LENGTH, 16, 1024),
            DEFAULT_MIN_SERVICE_SECRET_LENGTH,
            16,
            1024
        );
        this.requireStrongServiceSecret = options.requireStrongServiceSecret ??
            readBooleanEnv("GAME_SERVER_SERVICE_SECRET_REQUIRE_STRONG", DEFAULT_REQUIRE_STRONG_SERVICE_SECRET);
        this.maxMetadataJsonBytes = clampInteger(
            options.maxMetadataJsonBytes ??
                readIntegerEnv("GAME_SERVER_SERVICE_TOKEN_MAX_METADATA_JSON_BYTES", DEFAULT_MAX_METADATA_JSON_BYTES, 128, 65536),
            DEFAULT_MAX_METADATA_JSON_BYTES,
            128,
            65536
        );
    }

    //* این تابع برای یک ددیکیتد سرور توکن سرویس کوتاه مدت می سازد.
    createToken(options = {}) {
        this.validateServiceSecret();

        const serverId = cleanString(options.serverId, "");
        if (!serverId) throw new Error("[GameServerServiceToken] serverId is required.");

        const issuedAt = nowMs();
        const ttlSeconds = clampInteger(options.ttlSeconds, this.defaultTtlSeconds, 5, this.maxTtlSeconds);
        const expiresAt = issuedAt + ttlSeconds * 1000;

        const payload = {
            serverId,
            purpose: cleanString(options.purpose, this.purpose),
            issuedAt,
            expiresAt,
            nonce: createNonce(),
            metadata: this.normalizeMetadata(options.metadata ?? {})
        };

        const encodedPayload = encodePayload(payload);
        const signature = signPayload(encodedPayload, this.serviceSecret);

        return `${SERVICE_TOKEN_VERSION}.${encodedPayload}.${signature}`;
    }

    //* این تابع توکن سرویس را بررسی می کند و نتیجه استاندارد برمی گرداند.
    verifyToken(token, expected = {}) {
        this.validateServiceSecret();

        const parsed = parseServiceToken(token);

        if (!parsed.success) {
            return this.failure(parsed.reason, "Service token could not be parsed.", null);
        }

        const expectedSignature = signPayload(parsed.encodedPayload, this.serviceSecret);

        if (!safeStringEquals(expectedSignature, parsed.signature)) {
            return this.failure("token_signature_invalid", "Service token signature is invalid.", parsed.payload);
        }

        const payloadValidation = this.validatePayloadShape(parsed.payload);

        if (!payloadValidation.success) {
            return this.failure(payloadValidation.reason, payloadValidation.message, parsed.payload);
        }

        const timeValidation = this.validateTokenTime(parsed.payload);

        if (!timeValidation.success) {
            return this.failure(timeValidation.reason, timeValidation.message, parsed.payload);
        }

        const expectedValidation = this.validateExpectedPayload(parsed.payload, expected);

        if (!expectedValidation.success) {
            return this.failure(expectedValidation.reason, expectedValidation.message, parsed.payload);
        }

        return this.success("token_valid", "Service token is valid.", parsed.payload);
    }

    //* این تابع توکن سرویس را از هدرها خوانده و بررسی می کند.
    verifyHeaders(headers = {}, expected = {}) {
        const token = extractServiceTokenFromHeaders(headers);
        return this.verifyToken(token, expected);
    }

    //* این تابع هدر استاندارد برای ارسال توکن سرویس می سازد.
    createAuthorizationHeader(token) {
        if (!isNonEmptyString(token)) throw new Error("[GameServerServiceToken] token is required.");

        return {
            Authorization: `Bearer ${token}`,
            "X-Metaverse-Game-Server-Token": token
        };
    }

    //* این تابع زمان صدور و انقضای توکن را بررسی می کند.
    validateTokenTime(payload) {
        if (!Number.isFinite(payload?.issuedAt)) {
            return { success: false, reason: "token_issued_at_invalid", message: "Service token issuedAt is invalid." };
        }

        if (!Number.isFinite(payload?.expiresAt)) {
            return { success: false, reason: "token_expires_at_invalid", message: "Service token expiresAt is invalid." };
        }

        const currentTime = nowMs();
        const skewMs = this.clockSkewSeconds * 1000;

        if (payload.issuedAt > currentTime + skewMs) {
            return { success: false, reason: "token_not_yet_valid", message: "Service token is not yet valid." };
        }

        if (payload.expiresAt <= currentTime - skewMs) {
            return { success: false, reason: "token_expired", message: "Service token has expired." };
        }

        if (payload.expiresAt <= payload.issuedAt) {
            return { success: false, reason: "token_time_range_invalid", message: "Service token time range is invalid." };
        }

        const ttlSeconds = Math.ceil((payload.expiresAt - payload.issuedAt) / 1000);

        if (ttlSeconds > this.maxTtlSeconds + this.clockSkewSeconds) {
            return { success: false, reason: "token_ttl_too_long", message: "Service token TTL is longer than allowed." };
        }

        return { success: true };
    }

    //* این تابع پِیلود توکن را با مقدارهای مورد انتظار مقایسه می کند.
    validateExpectedPayload(payload, expected = {}) {
        if (isNonEmptyString(expected.serverId) && payload.serverId !== expected.serverId.trim()) {
            return { success: false, reason: "token_server_mismatch", message: "Service token serverId does not match." };
        }

        if (isNonEmptyString(expected.purpose) && payload.purpose !== expected.purpose.trim()) {
            return { success: false, reason: "token_purpose_mismatch", message: "Service token purpose does not match." };
        }

        return { success: true };
    }

    //* این تابع ساختار پِیلود توکن سرویس را بررسی می کند.
    validatePayloadShape(payload) {
        if (!payload || typeof payload !== "object") {
            return { success: false, reason: "token_payload_shape_invalid", message: "Service token payload shape is invalid." };
        }

        if (!isNonEmptyString(payload.serverId)) {
            return { success: false, reason: "token_server_id_required", message: "Service token serverId is required." };
        }

        if (payload.serverId.length > 180 || !/^[a-zA-Z0-9_-]+$/.test(payload.serverId)) {
            return { success: false, reason: "token_server_id_invalid", message: "Service token serverId is invalid." };
        }

        if (!isNonEmptyString(payload.purpose)) {
            return { success: false, reason: "token_purpose_required", message: "Service token purpose is required." };
        }

        if (!isNonEmptyString(payload.nonce) || payload.nonce.length < 16 || payload.nonce.length > 128) {
            return { success: false, reason: "token_nonce_invalid", message: "Service token nonce is invalid." };
        }

        const metadataJson = JSON.stringify(payload.metadata ?? {});

        if (Buffer.byteLength(metadataJson, "utf8") > this.maxMetadataJsonBytes) {
            return { success: false, reason: "token_metadata_too_large", message: "Service token metadata is too large." };
        }

        return { success: true };
    }

    //* این تابع متادیتای توکن را قبل از امضا محدود و امن می کند.
    normalizeMetadata(metadata = {}) {
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};

        const metadataJson = JSON.stringify(metadata);

        if (Buffer.byteLength(metadataJson, "utf8") > this.maxMetadataJsonBytes) {
            throw new Error("[GameServerServiceToken] metadata is too large.");
        }

        return metadata;
    }

    //* این تابع وضعیت ایمنی سرویس توکن را بدون نمایش سکرت برمی گرداند.
    getSafetyStatus() {
        return {
            tokenVersion: SERVICE_TOKEN_VERSION,
            defaultTtlSeconds: this.defaultTtlSeconds,
            maxTtlSeconds: this.maxTtlSeconds,
            clockSkewSeconds: this.clockSkewSeconds,
            minServiceSecretLength: this.minServiceSecretLength,
            requireStrongServiceSecret: this.requireStrongServiceSecret,
            maxMetadataJsonBytes: this.maxMetadataJsonBytes,
            serviceSecretConfigured: isNonEmptyString(this.serviceSecret) && this.serviceSecret !== DEFAULT_SERVICE_SECRET,
            serviceSecretLength: isNonEmptyString(this.serviceSecret) ? this.serviceSecret.length : 0
        };
    }

    //* این تابع سکرت سرویس را قبل از ساخت یا بررسی توکن کنترل می کند.
    validateServiceSecret() {
        if (!isNonEmptyString(this.serviceSecret) || this.serviceSecret === DEFAULT_SERVICE_SECRET) {
            throw new Error("[GameServerServiceToken] serviceSecret must be configured.");
        }

        if (this.serviceSecret.length < this.minServiceSecretLength) {
            throw new Error(`[GameServerServiceToken] serviceSecret must be at least ${this.minServiceSecretLength} characters.`);
        }

        if (!this.requireStrongServiceSecret) return;

        const normalizedSecret = this.serviceSecret.trim().toLowerCase();
        const forbiddenSecrets = new Set([
            "change_me",
            "changeme",
            "secret",
            "password",
            "test",
            "development",
            "default"
        ]);

        if (forbiddenSecrets.has(normalizedSecret)) {
            throw new Error("[GameServerServiceToken] serviceSecret is too weak.");
        }

        if (/^(.)\1+$/.test(this.serviceSecret)) {
            throw new Error("[GameServerServiceToken] serviceSecret has low entropy.");
        }

        if (!/[a-zA-Z]/.test(this.serviceSecret) || !/[0-9]/.test(this.serviceSecret)) {
            throw new Error("[GameServerServiceToken] serviceSecret must contain letters and numbers.");
        }
    }

    //* این تابع پاسخ موفق استاندارد برای بررسی توکن سرویس می سازد.
    success(reason, message, payload) {
        return {
            success: true,
            reason,
            message,
            payload: payload ? { ...payload } : null
        };
    }

    //* این تابع پاسخ خطای استاندارد برای بررسی توکن سرویس می سازد.
    failure(reason, message, payload) {
        return {
            success: false,
            reason,
            message,
            payload: payload ? { ...payload } : null
        };
    }
}

//* این تابع یک نمونه جدید از سرویس توکن ددیکیتد سرور می سازد.
function createGameServerServiceToken(options = {}) {
    return new GameServerServiceToken(options);
}

export {
    SERVICE_TOKEN_VERSION,
    GameServerServiceToken,
    createGameServerServiceToken,
    extractServiceTokenFromHeaders,
    parseServiceToken
};

// این فایل فقط توکن سرویس داخلی ددیکیتد سرور را می سازد و بررسی می کند و هنوز هیچ اتصال بیرونی یا تغییر در سرور اصلی ایجاد نمی کند.
