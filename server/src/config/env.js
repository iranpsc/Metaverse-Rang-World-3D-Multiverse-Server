// src/config/env.js

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function get(name, fallback) {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

function must(name, fallback) {
    const value = get(name, fallback);
    if (!value) {
        throw new Error(`Missing env var: ${name}`);
    }
    return value;
}

function parseDurationToSeconds(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Invalid duration for ${fieldName}`);
    }

    const normalized = value.trim();
    const match = normalized.match(/^(\d+)(s|m|h|d)$/i);

    if (!match) {
        throw new Error(`Invalid duration format for ${fieldName}: ${value}`);
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case "s":
            return amount;
        case "m":
            return amount * 60;
        case "h":
            return amount * 60 * 60;
        case "d":
            return amount * 24 * 60 * 60;
        default:
            throw new Error(`Unsupported duration unit for ${fieldName}: ${value}`);
    }
}

const accessExpiresIn = must("JWT_ACCESS_EXPIRES_IN", "60s");
const refreshExpiresIn = must("JWT_REFRESH_EXPIRES_IN", "30d");

const accessTtlSeconds = parseDurationToSeconds(
    accessExpiresIn,
    "JWT_ACCESS_EXPIRES_IN"
);

const refreshTtlSeconds = parseDurationToSeconds(
    refreshExpiresIn,
    "JWT_REFRESH_EXPIRES_IN"
);

const cfg = {
    app: {
        nodeEnv: get("NODE_ENV", "development")
    },

    grpc: {
        host: get("GRPC_HOST", "0.0.0.0"),
        port: parseInt(get("GRPC_PORT", "50051"), 10)
    },

    ws: {
        port: parseInt(get("WS_PORT", "8080"), 10)
    },

    envoy: {
        tlsPort: parseInt(get("ENVOY_TLS_PORT", "8443"), 10)
    },

    mongo: {
        uri: must("MONGO_URI", "mongodb://localhost:27017/metaverse")
    },

    jwt: {
        algorithm: must("JWT_ALGORITHM", "RS256"),
        issuer: must("JWT_ISSUER", "metaverse"),
        audience: must("JWT_AUDIENCE", "metaverse-client"),

        accessKeyId: must("JWT_ACCESS_KEY_ID", "metaverse-access-key-1"),
        refreshKeyId: must("JWT_REFRESH_KEY_ID", "metaverse-refresh-key-1"),

        accessPrivateKeyPath: must(
            "JWT_ACCESS_PRIVATE_KEY_PATH",
            path.join(root, "envoy", "cert", "jwt", "access-private.pem")
        ),
        accessPublicKeyPath: must(
            "JWT_ACCESS_PUBLIC_KEY_PATH",
            path.join(root, "envoy", "cert", "jwt", "access-public.pem")
        ),

        refreshPrivateKeyPath: must(
            "JWT_REFRESH_PRIVATE_KEY_PATH",
            path.join(root, "envoy", "cert", "jwt", "refresh-private.pem")
        ),
        refreshPublicKeyPath: must(
            "JWT_REFRESH_PUBLIC_KEY_PATH",
            path.join(root, "envoy", "cert", "jwt", "refresh-public.pem")
        ),

        accessExpiresIn,
        refreshExpiresIn,

        accessTtlSeconds,
        refreshTtlSeconds,

        accessTtlMs: accessTtlSeconds * 1000,
        refreshTtlMs: refreshTtlSeconds * 1000
    },

    tls: {
        certPath: must(
            "TLS_CERT_PATH",
            path.join(root, "envoy", "cert", "server.crt")
        ),
        keyPath: must(
            "TLS_KEY_PATH",
            path.join(root, "envoy", "cert", "server.key")
        )
    }
    ,
    microservice: {
        tokenUrl: must("MICROSERVICE_TOKEN_URL", "https://accounts.irpsc.com/oauth/token"),
        clientId: must("MICROSERVICE_CLIENT_ID", ""),
        clientSecret: must("MICROSERVICE_CLIENT_SECRET", ""),
        scope: get("MICROSERVICE_SCOPE", "*"),
        timeoutMs: parseInt(get("MICROSERVICE_TIMEOUT_MS", "15000"), 10),
        tokenBodyMode: get("MICROSERVICE_TOKEN_BODY_MODE", "form-data")
    }
};

export default cfg;

/* 
src / config / env.js منبع اصلی تنظیمات runtime سرور متاورس است.این فایل متغیرهای.env را بارگذاری می کند، مقدارهای لازم را می خواند، برای بعضی مقدارها fallback قرار می دهد، مدت زمان tokenها را به ثانیه و میلی ثانیه تبدیل می کند و در نهایت یک object واحد به نام cfg می سازد.این object توسط فایل های اصلی سرور مثل index.js، validation.js، grpc / server.js، mongo / connection.js، token.service.js و jwks.js مصرف می شود.

در این فایل، تنظیمات اصلی پروژه شامل پورت gRPC، پورت HTTP / WebSocket، پورت Envoy، آدرس MongoDB، تنظیمات JWT، مسیر کلیدهای RSA، زمان اعتبار access token و refresh token، و مسیر certificateهای TLS تعریف می شوند.بنابراین اگر این فایل اشتباه تنظیم شود، مسیرهای اصلی پروژه مثل اتصال Envoy به gRPC backend، verify شدن JWT در Envoy، اتصال دیتابیس، صدور token و حتی پاسخ JWKS دچار مشکل می شوند.

از نظر معماری، env.js باید source of truth تنظیمات باشد و سایر فایل ها نباید مستقیم و پراکنده از process.env استفاده کنند.نکته بسیار مهم این است که مقدارهای JWT مثل issuer و audience باید دقیقاً با Envoy هماهنگ باشند؛ چون Envoy هنگام بررسی access token همین مقدارها را کنترل می کند.همچنین چون پروژه از RS256 استفاده می کند، private key برای امضای token در سرور استفاده می شود و public key از طریق JWKS در اختیار Envoy قرار می گیرد تا token را verify کند.

 */
