// مسیر فایل: src/voice/dedicated/createVoiceDedicatedSessionEligibilityHttpHandler.js

import {
    readVoiceDedicatedJsonBody,
    readVoiceDedicatedRequestPath
} from "./createVoiceDedicatedSessionDeltaHttpHandler.js";

const VOICE_DEDICATED_SESSION_ELIGIBILITY_PATH =
    "/game-server-control/dedicated/voice-session-eligibility";

const VOICE_DEDICATED_SESSION_ELIGIBILITY_MAX_BODY_BYTES =
    64 * 1024;

const VOICE_DEDICATED_SESSION_ELIGIBILITY_REQUEST_TIMEOUT_MS =
    10000;

//* این تابع پاسخ جیسون مسیر Eligibility را بدون وابستگی به سرور اصلی می‌نویسد.
function sendVoiceDedicatedEligibilityJson(
    res,
    statusCode,
    payload
) {
    if (
        !res ||
        res.destroyed === true ||
        res.writableEnded === true
    ) {
        return payload;
    }

    const normalizedStatusCode =
        Number.isInteger(statusCode) &&
        statusCode >= 100 &&
        statusCode <= 599
            ? statusCode
            : 500;

    const body = JSON.stringify(payload);

    if (typeof res.writeHead === "function") {
        res.writeHead(normalizedStatusCode, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control": "no-store"
        });
    } else {
        res.statusCode = normalizedStatusCode;
    }

    if (typeof res.end === "function") {
        res.end(body);
    } else {
        res.body = body;
    }

    return payload;
}

//* این تابع مسیر Snapshot Eligibility را روی همان HTTP Runtime فعلی Voice مدیریت می‌کند.
function createVoiceDedicatedSessionEligibilityHttpHandler({
    getService,
    logger = null,
    maximumBodyBytes = VOICE_DEDICATED_SESSION_ELIGIBILITY_MAX_BODY_BYTES,
    requestTimeoutMs = VOICE_DEDICATED_SESSION_ELIGIBILITY_REQUEST_TIMEOUT_MS
} = {}) {
    if (typeof getService !== "function") {
        throw new TypeError("getService must be a function.");
    }

    return async function voiceDedicatedSessionEligibilityHttpHandler(
        req,
        res
    ) {
        if (
            readVoiceDedicatedRequestPath(req) !==
            VOICE_DEDICATED_SESSION_ELIGIBILITY_PATH
        ) {
            return false;
        }

        if (String(req.method ?? "GET").toUpperCase() !== "POST") {
            sendVoiceDedicatedEligibilityJson(res, 405, {
                success: false,
                reason: "voice_session_eligibility_method_not_allowed",
                message: "POST method is required.",
                data: {},
                ts: Date.now()
            });
            return true;
        }

        const service = getService();

        if (!service || typeof service.getSnapshot !== "function") {
            sendVoiceDedicatedEligibilityJson(res, 503, {
                success: false,
                reason: "voice_session_eligibility_service_not_ready",
                message: "Voice session eligibility service is not ready.",
                data: {},
                ts: Date.now()
            });
            return true;
        }

        let requestBody;

        try {
            requestBody = await readVoiceDedicatedJsonBody(
                req,
                maximumBodyBytes,
                requestTimeoutMs
            );
        } catch (error) {
            sendVoiceDedicatedEligibilityJson(
                res,
                error?.message === "voice_delta_request_body_too_large" ? 413 : 400,
                {
                    success: false,
                    reason: "voice_session_eligibility_invalid_request_body",
                    message: error?.message ?? String(error),
                    data: {},
                    ts: Date.now()
                }
            );
            return true;
        }

        try {
            const result = service.getSnapshot(
                {
                    req,
                    headers: req.headers ?? {}
                },
                requestBody
            );

            const statusCode =
                Number.isInteger(result?.httpStatusCode) &&
                result.httpStatusCode >= 100 &&
                result.httpStatusCode <= 599
                    ? result.httpStatusCode
                    : result?.success
                        ? 200
                        : 400;

            sendVoiceDedicatedEligibilityJson(
                res,
                statusCode,
                result
            );
        } catch (error) {
            logger?.error?.(
                "[VoiceDedicatedSessionEligibilityHttp] Request failed.",
                {
                    error: String(error?.stack ?? error)
                }
            );

            sendVoiceDedicatedEligibilityJson(res, 500, {
                success: false,
                reason: "voice_session_eligibility_http_handler_failed",
                message: "Voice session eligibility request failed.",
                data: {},
                ts: Date.now()
            });
        }

        return true;
    };
}

export {
    VOICE_DEDICATED_SESSION_ELIGIBILITY_MAX_BODY_BYTES,
    VOICE_DEDICATED_SESSION_ELIGIBILITY_PATH,
    VOICE_DEDICATED_SESSION_ELIGIBILITY_REQUEST_TIMEOUT_MS,
    createVoiceDedicatedSessionEligibilityHttpHandler
};

/*
توضیح فایل:
این فایل فقط مسیر امن Snapshot شرط Mic/Speaker را به همان HTTP handler موجود Voice اضافه می‌کند و هیچ پورت یا سرور جداگانه‌ای باز نمی‌کند.
*/
