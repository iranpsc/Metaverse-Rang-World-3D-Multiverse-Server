// src/config/validation.js

import cfg from "./env.js";

/**
 * assertNonEmptyString
 * Ensures a config value exists and is a non-empty string
 */
function assertNonEmptyString(value, fieldName) {//مطمئن شود یک مقدار، رشته معتبر و غیرخالی است.
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${fieldName} is required`);
    }
}

/**
 * assertPositiveInt
 * Ensures a config value is a valid positive integer
 */
function assertPositiveInt(value, fieldName) {//مطمئن شود یک مقدار عدد صحیح مثبت است.
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid ${fieldName}`);
    }
}

function assertOneOf(value, allowedValues, fieldName) {
    if (!allowedValues.includes(value)) {
        throw new Error(`Invalid ${fieldName}`);
    }
}

/**
 * validateConfig
 * Validates required runtime configuration
 */
export function validateConfig() {
    assertNonEmptyString(cfg.app.nodeEnv, "NODE_ENV");

    assertNonEmptyString(cfg.grpc.host, "GRPC_HOST");
    assertPositiveInt(cfg.grpc.port, "GRPC_PORT");

    assertPositiveInt(cfg.ws.port, "WS_PORT");
    assertPositiveInt(cfg.envoy.tlsPort, "ENVOY_TLS_PORT");

    assertNonEmptyString(cfg.mongo.uri, "MONGO_URI");

    assertNonEmptyString(cfg.jwt.algorithm, "JWT_ALGORITHM");
    assertNonEmptyString(cfg.jwt.issuer, "JWT_ISSUER");
    assertNonEmptyString(cfg.jwt.audience, "JWT_AUDIENCE");

    assertNonEmptyString(cfg.jwt.accessPrivateKeyPath, "JWT_ACCESS_PRIVATE_KEY_PATH");
    assertNonEmptyString(cfg.jwt.accessPublicKeyPath, "JWT_ACCESS_PUBLIC_KEY_PATH");
    assertNonEmptyString(cfg.jwt.refreshPrivateKeyPath, "JWT_REFRESH_PRIVATE_KEY_PATH");
    assertNonEmptyString(cfg.jwt.refreshPublicKeyPath, "JWT_REFRESH_PUBLIC_KEY_PATH");

    assertNonEmptyString(cfg.jwt.accessExpiresIn, "JWT_ACCESS_EXPIRES_IN");
    assertNonEmptyString(cfg.jwt.refreshExpiresIn, "JWT_REFRESH_EXPIRES_IN");

    assertPositiveInt(cfg.jwt.accessTtlSeconds, "JWT_ACCESS_EXPIRES_IN");
    assertPositiveInt(cfg.jwt.refreshTtlSeconds, "JWT_REFRESH_EXPIRES_IN");
    assertPositiveInt(cfg.jwt.accessTtlMs, "JWT_ACCESS_EXPIRES_IN");
    assertPositiveInt(cfg.jwt.refreshTtlMs, "JWT_REFRESH_EXPIRES_IN");

    assertNonEmptyString(cfg.tls.certPath, "TLS_CERT_PATH");
    assertNonEmptyString(cfg.tls.keyPath, "TLS_KEY_PATH");

    assertNonEmptyString(cfg.jwt.accessKeyId, "JWT_ACCESS_KEY_ID");
    assertNonEmptyString(cfg.jwt.refreshKeyId, "JWT_REFRESH_KEY_ID");


    assertNonEmptyString(cfg.microservice.tokenUrl, "MICROSERVICE_TOKEN_URL");
    assertNonEmptyString(cfg.microservice.clientId, "MICROSERVICE_CLIENT_ID");
    assertNonEmptyString(cfg.microservice.clientSecret, "MICROSERVICE_CLIENT_SECRET");
    assertNonEmptyString(cfg.microservice.scope, "MICROSERVICE_SCOPE");
    assertPositiveInt(cfg.microservice.timeoutMs, "MICROSERVICE_TIMEOUT_MS");
    assertOneOf(cfg.microservice.tokenBodyMode, ["form-data", "urlencoded"], "MICROSERVICE_TOKEN_BODY_MODE");


    return true;
}
/* 
فایل src / config / validation.js مسئول اعتبارسنجی اولیه تنظیمات runtime سرور است.این فایل بعد از ساخته شدن config در env.js و قبل از راه اندازی دیتابیس، gRPC Server، HTTP Server، JWKS و Realtime اجرا می شود.هدف آن این است که اگر مقدارهای ضروری مانند پورت gRPC، پورت WebSocket / JWKS، پورت Envoy، آدرس MongoDB، تنظیمات JWT، مسیر کلیدهای RSA، زمان اعتبار tokenها یا مسیر certificateها ناقص باشند، سرور همان ابتدا متوقف شود و به صورت ناقص بالا نیاید.

این فایل سه تابع اصلی دارد.تابع assertNonEmptyString بررسی می کند که مقدارهای رشته ای خالی نباشند.تابع assertPositiveInt بررسی می کند که مقدارهای عددی مثل port و TTL عدد صحیح مثبت باشند.تابع validateConfig تابع اصلی export شده است و تمام بخش های مهم cfg را به ترتیب بررسی می کند.اگر همه مقدارها معتبر باشند، مقدار true برمی گرداند؛ اما اگر هر مقدار نامعتبر باشد، خطا throw می کند و این خطا در index.js باعث توقف startup می شود.

نقش این فایل در امنیت پروژه مهم است، چون قبل از فعال شدن Auth و Envoy JWT validation بررسی می کند که issuer، audience، algorithm، مسیر کلیدهای access و refresh و key idها خالی نباشند.با این حال، validation فعلی فقط حداقل اعتبار را بررسی می کند و وجود واقعی فایل های key، معتبر بودن certificate، اتصال واقعی MongoDB یا هماهنگی عملی با Envoy را کنترل نمی کند.برای production بهتر است این فایل در مراحل بعدی سخت گیرتر شود و وجود واقعی فایل های حساس و ممنوع بودن fallbackهای development را هم بررسی کند.پ
 */