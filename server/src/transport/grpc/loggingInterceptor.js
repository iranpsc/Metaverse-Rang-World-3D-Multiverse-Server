// File => src/transport/grpc/loggingInterceptor.js

import logger from "../../utils/logger.js";

const SENSITIVE_KEYS = new Set([
    "password",
    "confirmPassword",
    "accessToken",
    "refreshToken",
    "token",
    "authorization",
    "auth-token"
]);

//* Returns current timestamp in milliseconds.
function nowMs() {
    return Date.now();
}

//* Reads metadata value safely.
function safeMetaValue(meta, key) {
    const value = meta?.[key] ?? "";
    if (Array.isArray(value)) return value[0] ?? "";
    return value;
}

//* Reads client log info from gRPC metadata.
function readClientLogInfo(call) {
    const meta = call.metadata?.getMap?.() ?? {};

    const platform =
        safeMetaValue(meta, "x-client-platform") ||
        safeMetaValue(meta, "x-metaverse-client") ||
        safeMetaValue(meta, "platform") ||
        "unknown";

    const version =
        safeMetaValue(meta, "x-client-version") ||
        safeMetaValue(meta, "x-metaverse-version") ||
        safeMetaValue(meta, "version") ||
        "unknown";

    const transport =
        safeMetaValue(meta, "x-metaverse-transport") ||
        safeMetaValue(meta, "x-transport") ||
        "unknown";

    const requestId =
        safeMetaValue(meta, "x-request-id") ||
        safeMetaValue(meta, "request-id") ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return { platform, version, transport, requestId };
}

//* Masks sensitive values recursively.
function sanitizeValue(value) {
    if (value == null) return value;
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (Array.isArray(value)) return value.map(sanitizeValue);

    if (typeof value === "object") {
        const output = {};

        for (const [key, childValue] of Object.entries(value)) {
            const normalizedKey = key.toLowerCase();

            if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(normalizedKey)) {
                output[key] = "***";
                continue;
            }

            output[key] = sanitizeValue(childValue);
        }

        return output;
    }

    return value;
}

//* Converts data to readable JSON.
function toReadableJson(value) {
    try {
        const sanitized = sanitizeValue(value);
        return JSON.stringify(sanitized, null, 2);
    } catch {
        return String(value);
    }
}

//* Limits long log text.
function limitText(text, maxLength = 3000) {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "\n... [TRUNCATED]";
}

//* Formats one complete request log block after request finishes.
function formatCompletedRequestLog(info, serviceName, methodName, durationMs, status, requestBody, responseBody, error = null) {
    const requestText = limitText(toReadableJson(requestBody ?? {}));
    const responseText = error ? "" : limitText(toReadableJson(responseBody ?? {}));

    if (error) {
        return `
==================== gRPC REQUEST ====================
RequestId : ${info.requestId}
Service   : ${serviceName}
Method    : ${methodName}
Platform  : ${info.platform}
Version   : ${info.version}
Transport : ${info.transport}
Status    : ${status}
Code      : ${error?.code ?? "unknown"}
Message   : ${error?.message ?? "unknown"}
Duration  : ${durationMs}ms

Request Body:
${requestText}

Response:
[ERROR]
======================================================
`.trim();
    }

    return `
==================== gRPC REQUEST ====================
RequestId : ${info.requestId}
Service   : ${serviceName}
Method    : ${methodName}
Platform  : ${info.platform}
Version   : ${info.version}
Transport : ${info.transport}
Status    : ${status}
Duration  : ${durationMs}ms

Request Body:
${requestText}

Response:
${responseText}
======================================================
`.trim();
}

//* Logs a simple gRPC call metadata snapshot.
export function logCall(methodName, call) {
    const meta = call.metadata?.getMap?.() ?? {};
    const safeMeta = sanitizeValue(meta);

    logger.info(`gRPC call: ${methodName}`, { metadata: safeMeta });
}

//* Wraps one unary gRPC handler with one completed readable log.
export function wrapUnaryHandler(serviceName, methodName, handler) {
    return async function wrappedUnaryHandler(call, callback) {
        const startedAt = nowMs();
        const info = readClientLogInfo(call);
        const requestBody = call.request ?? {};
        let callbackCalled = false;

        const wrappedCallback = (err, response) => {
            if (callbackCalled) return;

            callbackCalled = true;

            const durationMs = nowMs() - startedAt;

            if (err) {
                logger.error(formatCompletedRequestLog(info, serviceName, methodName, durationMs, "ERROR", requestBody, null, err));
                callback(err);
                return;
            }

            logger.info(formatCompletedRequestLog(info, serviceName, methodName, durationMs, "OK", requestBody, response));
            callback(null, response);
        };

        try {
            await handler(call, wrappedCallback);
        } catch (err) {
            if (callbackCalled) return;

            callbackCalled = true;

            const durationMs = nowMs() - startedAt;

            logger.error(formatCompletedRequestLog(info, serviceName, methodName, durationMs, "THROWN", requestBody, null, err));
            callback(err);
        }
    };
}

//* Wraps all unary handlers of one gRPC service.
export function wrapGrpcHandlers(handlers, serviceName) {
    const wrapped = {};

    for (const [methodName, handler] of Object.entries(handlers)) {
        if (typeof handler === "function") wrapped[methodName] = wrapUnaryHandler(serviceName, methodName, handler);
        else wrapped[methodName] = handler;
    }

    return wrapped;
}

/* فایل src / transport / grpc / loggingInterceptor.js
برای ثبت لاگ ساده از callهای gRPC استفاده می‌شود.

این فایل تابع logCall(methodName, call) را export می‌کند
و با استفاده از call.metadata.getMap() metadata درخواست را می‌خواند.

سپس نام متد gRPC و metadata همراه آن
با logger.info در سیستم لاگ پروژه ثبت می‌شود.

در نسخه فعلی، این فایل request را متوقف نمی‌کند،
token را بررسی نمی‌کند و فقط نقش helper لاگ‌گیری دارد.

برای production بهتر است metadataهای حساس مثل authorization
قبل از ثبت در لاگ حذف یا mask شوند. */