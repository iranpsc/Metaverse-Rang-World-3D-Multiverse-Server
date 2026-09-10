// File => src/gameServerControl/gameServerControlConfig.js

const DEFAULT_ENABLED = false;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const DEFAULT_TICKET_TTL_SECONDS = 60;
const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 15;
const DEFAULT_MAX_PLAYERS_PER_INSTANCE = 20;
const DEFAULT_SERVICE_SECRET = "change_me";
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 10;

//* این تابع مقدار بولین را از اِنوی می خواند و حالت های رایج را پشتیبانی می کند.
function readBooleanEnv(name, fallbackValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    const normalizedValue = String(rawValue).trim().toLowerCase();

    if (normalizedValue === "true") return true;
    if (normalizedValue === "1") return true;
    if (normalizedValue === "yes") return true;
    if (normalizedValue === "on") return true;

    if (normalizedValue === "false") return false;
    if (normalizedValue === "0") return false;
    if (normalizedValue === "no") return false;
    if (normalizedValue === "off") return false;

    return fallbackValue;
}

//* این تابع مقدار عدد صحیح را از اِنوی می خواند و در بازه امن نگه می دارد.
function readIntegerEnv(name, fallbackValue, minValue, maxValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    const parsedValue = Number.parseInt(String(rawValue).trim(), 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار رشته ای را از اِنوی می خواند و اگر خالی بود مقدار پیش فرض را برمی گرداند.
function readStringEnv(name, fallbackValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null) return fallbackValue;

    const value = String(rawValue).trim();
    return value.length > 0 ? value : fallbackValue;
}

//* این تابع آدرس هاست را از اِنوی می خواند و مقدار خالی را قبول نمی کند.
function readHostEnv(name, fallbackValue) {
    const value = readStringEnv(name, fallbackValue);
    return value.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

//* این تابع تنظیمات خام ماژول کنترل گیم سرور را از اِنوی می سازد.
function loadGameServerControlConfig() {
    const enabled = readBooleanEnv("GAME_SERVER_CONTROL_ENABLED", DEFAULT_ENABLED);
    const defaultHost = readHostEnv("GAME_SERVER_DEFAULT_HOST", DEFAULT_HOST);
    const defaultPort = readIntegerEnv("GAME_SERVER_DEFAULT_PORT", DEFAULT_PORT, 1, 65535);

    const ticketTtlSeconds = readIntegerEnv(
        "GAME_SERVER_TICKET_TTL_SECONDS",
        DEFAULT_TICKET_TTL_SECONDS,
        5,
        3600
    );

    const heartbeatTimeoutSeconds = readIntegerEnv(
        "GAME_SERVER_HEARTBEAT_TIMEOUT_SECONDS",
        DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
        3,
        300
    );

    const maxPlayersPerInstance = readIntegerEnv(
        "GAME_SERVER_MAX_PLAYERS_PER_INSTANCE",
        DEFAULT_MAX_PLAYERS_PER_INSTANCE,
        1,
        1024
    );

    const cleanupIntervalSeconds = readIntegerEnv(
        "GAME_SERVER_CLEANUP_INTERVAL_SECONDS",
        DEFAULT_CLEANUP_INTERVAL_SECONDS,
        1,
        300
    );

    const serviceSecret = readStringEnv("GAME_SERVER_SERVICE_SECRET", DEFAULT_SERVICE_SECRET);

    return validateGameServerControlConfig({
        enabled,
        defaultHost,
        defaultPort,
        ticketTtlSeconds,
        heartbeatTimeoutSeconds,
        maxPlayersPerInstance,
        cleanupIntervalSeconds,
        serviceSecret
    });
}

//* این تابع تنظیمات ماژول کنترل گیم سرور را اعتبارسنجی نهایی می کند.
function validateGameServerControlConfig(config) {
    const errors = [];

    if (!config.defaultHost) errors.push("GAME_SERVER_DEFAULT_HOST is required.");
    if (!Number.isInteger(config.defaultPort)) errors.push("GAME_SERVER_DEFAULT_PORT must be an integer.");
    if (config.defaultPort < 1 || config.defaultPort > 65535) errors.push("GAME_SERVER_DEFAULT_PORT must be between 1 and 65535.");

    if (!Number.isInteger(config.ticketTtlSeconds)) errors.push("GAME_SERVER_TICKET_TTL_SECONDS must be an integer.");
    if (config.ticketTtlSeconds < 5) errors.push("GAME_SERVER_TICKET_TTL_SECONDS must be at least 5 seconds.");

    if (!Number.isInteger(config.heartbeatTimeoutSeconds)) errors.push("GAME_SERVER_HEARTBEAT_TIMEOUT_SECONDS must be an integer.");
    if (config.heartbeatTimeoutSeconds < 3) errors.push("GAME_SERVER_HEARTBEAT_TIMEOUT_SECONDS must be at least 3 seconds.");

    if (!Number.isInteger(config.maxPlayersPerInstance)) errors.push("GAME_SERVER_MAX_PLAYERS_PER_INSTANCE must be an integer.");
    if (config.maxPlayersPerInstance < 1) errors.push("GAME_SERVER_MAX_PLAYERS_PER_INSTANCE must be at least 1.");

    if (!Number.isInteger(config.cleanupIntervalSeconds)) errors.push("GAME_SERVER_CLEANUP_INTERVAL_SECONDS must be an integer.");
    if (config.cleanupIntervalSeconds < 1) errors.push("GAME_SERVER_CLEANUP_INTERVAL_SECONDS must be at least 1 second.");

    if (config.enabled && config.serviceSecret === DEFAULT_SERVICE_SECRET) {
        errors.push("GAME_SERVER_SERVICE_SECRET must be changed when GAME_SERVER_CONTROL_ENABLED=true.");
    }

    if (errors.length > 0) {
        const message = `[GameServerControlConfig] Invalid config:\n${errors.map((error) => `- ${error}`).join("\n")}`;
        throw new Error(message);
    }

    return Object.freeze({
        enabled: config.enabled,
        defaultHost: config.defaultHost,
        defaultPort: config.defaultPort,
        ticketTtlSeconds: config.ticketTtlSeconds,
        heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
        maxPlayersPerInstance: config.maxPlayersPerInstance,
        cleanupIntervalSeconds: config.cleanupIntervalSeconds,
        serviceSecret: config.serviceSecret
    });
}

//* این تابع تنظیمات را برای لاگ امن آماده می کند و مقدار سکرت را مخفی نگه می دارد.
function toSafeGameServerControlConfigLog(config) {
    if (!config) return "[GameServerControlConfig] not loaded";

    return {
        enabled: config.enabled,
        defaultHost: config.defaultHost,
        defaultPort: config.defaultPort,
        ticketTtlSeconds: config.ticketTtlSeconds,
        heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
        maxPlayersPerInstance: config.maxPlayersPerInstance,
        cleanupIntervalSeconds: config.cleanupIntervalSeconds,
        serviceSecret: config.serviceSecret ? "***" : ""
    };
}

export {
    loadGameServerControlConfig,
    validateGameServerControlConfig,
    toSafeGameServerControlConfigLog
};

// این فایل فقط تنظیمات ماژول جدید کنترل گیم سرور را می خواند و هنوز هیچ اتصالی به استارتاپ اصلی سرور ندارد.
