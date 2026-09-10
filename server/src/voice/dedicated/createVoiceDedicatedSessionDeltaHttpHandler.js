// مسیر فایل: src/voice/dedicated/createVoiceDedicatedSessionDeltaHttpHandler.js

const VOICE_DEDICATED_SESSION_DELTA_PATH =
    "/game-server-control/dedicated/voice-session-delta";

const VOICE_DEDICATED_SESSION_DELTA_MAX_BODY_BYTES =
    4 *
    1024 *
    1024;

const VOICE_DEDICATED_SESSION_DELTA_REQUEST_TIMEOUT_MS =
    10000;

//* این تابع مسیر درخواست را از آدرس خام استخراج می‌کند.
function readVoiceDedicatedRequestPath(
    req = {}
) {
    const host =
        req.headers?.host ??
        "127.0.0.1";

    try {
        return new URL(
            req.url ??
                "/",
            `http://${host}`
        ).pathname;
    } catch {
        return String(
            req.url ??
            "/"
        ).split("?")[0];
    }
}

//* این تابع پاسخ جیسون را با کد وضعیت تعیین‌شده روی پاسخ خام نود می‌نویسد.
function sendVoiceDedicatedJson(
    res,
    statusCode,
    payload
) {
    if (
        !res ||
        res.destroyed ===
            true ||
        res.writableEnded ===
            true
    ) {
        return payload;
    }

    const normalizedStatusCode =
        Number.isInteger(
            statusCode
        ) &&
        statusCode >= 100 &&
        statusCode <= 599
            ? statusCode
            : 500;

    const body =
        JSON.stringify(
            payload
        );

    if (
        typeof res.writeHead ===
        "function"
    ) {
        res.writeHead(
            normalizedStatusCode,
            {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Content-Length":
                    Buffer.byteLength(
                        body
                    ),

                "Cache-Control":
                    "no-store"
            }
        );
    } else {
        res.statusCode =
            normalizedStatusCode;
    }

    if (
        typeof res.end ===
        "function"
    ) {
        res.end(
            body
        );
    } else {
        res.body =
            body;
    }

    return payload;
}

//* این تابع بدنه درخواست را با محدودیت حجم تعیین‌شده دریافت و به جیسون تبدیل می‌کند.
function readVoiceDedicatedJsonBody(
    req,
    maximumBytes =
        VOICE_DEDICATED_SESSION_DELTA_MAX_BODY_BYTES,
    timeoutMs =
        VOICE_DEDICATED_SESSION_DELTA_REQUEST_TIMEOUT_MS
) {
    if (
        !req ||
        typeof req.on !==
            "function" ||
        typeof req.removeListener !==
            "function"
    ) {
        return Promise.reject(
            new TypeError(
                "req must provide the Node.js request event interface."
            )
        );
    }

    if (
        !Number.isSafeInteger(
            maximumBytes
        ) ||
        maximumBytes <= 0
    ) {
        return Promise.reject(
            new RangeError(
                "maximumBytes must be a positive safe integer."
            )
        );
    }

    if (
        !Number.isSafeInteger(
            timeoutMs
        ) ||
        timeoutMs <= 0
    ) {
        return Promise.reject(
            new RangeError(
                "timeoutMs must be a positive safe integer."
            )
        );
    }

    return new Promise(
        (
            resolve,
            reject
        ) => {
            const chunks =
                [];

            let totalBytes =
                0;

            let completed =
                false;

            let timer =
                null;

            //* این تابع شنونده‌ها و زمان‌سنج خواندن بدنه را در تمام مسیرهای پایان پاک می‌کند.
            function cleanup() {
                req.removeListener(
                    "data",
                    handleData
                );

                req.removeListener(
                    "end",
                    handleEnd
                );

                req.removeListener(
                    "error",
                    handleError
                );

                req.removeListener(
                    "aborted",
                    handleAborted
                );

                req.removeListener(
                    "close",
                    handleClose
                );

                if (timer) {
                    clearTimeout(
                        timer
                    );

                    timer =
                        null;
                }
            }

            //* این تابع عملیات خواندن بدنه را فقط یک بار با خطا تمام می‌کند.
            function fail(error) {
                if (completed) {
                    return;
                }

                completed =
                    true;

                cleanup();
                reject(error);
            }

            //* این تابع هر قطعه بدنه را جمع می‌کند و در عبور از سقف، ادامه بدنه را بدون بستن سوکت تخلیه می‌کند.
            function handleData(chunk) {
                    if (
                        completed
                    ) {
                        return;
                    }

                    const buffer =
                        Buffer.isBuffer(
                            chunk
                        )
                            ? chunk
                            : Buffer.from(
                                String(
                                    chunk
                                ),
                                "utf8"
                            );

                    totalBytes +=
                        buffer.length;

                    if (
                        totalBytes >
                        maximumBytes
                    ) {
                        fail(
                            new Error(
                                "voice_delta_request_body_too_large"
                            )
                        );

                        req.resume?.();

                        return;
                    }

                    chunks.push(
                        buffer
                    );
            }

            //* این تابع پس از دریافت کامل، بدنه را به جیسون تبدیل می‌کند.
            function handleEnd() {
                    if (
                        completed
                    ) {
                        return;
                    }

                    completed =
                        true;

                    cleanup();

                    const rawBody =
                        Buffer.concat(
                            chunks
                        ).toString(
                            "utf8"
                        );

                    if (
                        !rawBody.trim()
                    ) {
                        reject(
                            new Error(
                                "voice_delta_request_body_required"
                            )
                        );

                        return;
                    }

                    try {
                        resolve(
                            JSON.parse(
                                rawBody
                            )
                        );
                    } catch {
                        reject(
                            new Error(
                                "voice_delta_invalid_json_body"
                            )
                        );
                    }
            }

            //* این تابع خطای جریان درخواست را به پایان کنترل‌شده تبدیل می‌کند.
            function handleError(error) {
                fail(error);
            }

            //* این تابع قطع‌شدن درخواست توسط فرستنده را ثبت می‌کند.
            function handleAborted() {
                fail(
                    new Error(
                        "voice_delta_request_aborted"
                    )
                );
            }

            //* این تابع بسته‌شدن زودهنگام جریان پیش از دریافت کامل بدنه را ثبت می‌کند.
            function handleClose() {
                if (
                    req.complete ===
                    true
                ) {
                    return;
                }

                fail(
                    new Error(
                        "voice_delta_request_closed"
                    )
                );
            }

            req.on(
                "data",
                handleData
            );

            req.on(
                "end",
                handleEnd
            );

            req.on(
                "error",
                handleError
            );

            req.on(
                "aborted",
                handleAborted
            );

            req.on(
                "close",
                handleClose
            );

            timer =
                setTimeout(
                    () =>
                        fail(
                            new Error(
                                "voice_delta_request_timeout"
                            )
                        ),
                    timeoutMs
                );

            timer.unref?.();
        }
    );
}

//* این تابع هندلر مسیر دریافت رویدادهای سشن صوتی را برای سرور اچ‌تی‌تی‌پی اصلی می‌سازد.
function createVoiceDedicatedSessionDeltaHttpHandler({
    getService,
    logger = null,
    maximumBodyBytes =
        VOICE_DEDICATED_SESSION_DELTA_MAX_BODY_BYTES,
    requestTimeoutMs =
        VOICE_DEDICATED_SESSION_DELTA_REQUEST_TIMEOUT_MS
} = {}) {
    if (
        typeof getService !==
        "function"
    ) {
        throw new TypeError(
            "getService must be a function."
        );
    }

    if (
        !Number.isSafeInteger(
            maximumBodyBytes
        ) ||
        maximumBodyBytes <= 0
    ) {
        throw new RangeError(
            "maximumBodyBytes must be a positive safe integer."
        );
    }

    if (
        !Number.isSafeInteger(
            requestTimeoutMs
        ) ||
        requestTimeoutMs <= 0
    ) {
        throw new RangeError(
            "requestTimeoutMs must be a positive safe integer."
        );
    }

    return async function voiceDedicatedSessionDeltaHttpHandler(
        req,
        res
    ) {
        if (
            readVoiceDedicatedRequestPath(
                req
            ) !==
            VOICE_DEDICATED_SESSION_DELTA_PATH
        ) {
            return false;
        }

        if (
            String(
                req.method ??
                "GET"
            ).toUpperCase() !==
            "POST"
        ) {
            sendVoiceDedicatedJson(
                res,
                405,
                {
                    success:
                        false,

                    reason:
                        "voice_delta_method_not_allowed",

                    message:
                        "POST method is required.",

                    data:
                        {},

                    ts:
                        Date.now()
                }
            );

            return true;
        }

        const service =
            getService();

        if (
            !service ||
            typeof service
                .acceptBatch !==
                "function"
        ) {
            sendVoiceDedicatedJson(
                res,
                503,
                {
                    success:
                        false,

                    reason:
                        "voice_delta_service_not_ready",

                    message:
                        "Voice dedicated session delta service is not ready.",

                    data:
                        {},

                    ts:
                        Date.now()
                }
            );

            return true;
        }

        let requestBody;

        try {
            requestBody =
                await readVoiceDedicatedJsonBody(
                    req,
                    maximumBodyBytes,
                    requestTimeoutMs
                );
        } catch (error) {
            const tooLarge =
                error?.message ===
                "voice_delta_request_body_too_large";

            sendVoiceDedicatedJson(
                res,
                tooLarge
                    ? 413
                    : 400,
                {
                    success:
                        false,

                    reason:
                        error?.message ??
                        "voice_delta_request_read_failed",

                    message:
                        "Voice dedicated session delta request could not be read.",

                    data:
                        {},

                    ts:
                        Date.now()
                }
            );

            return true;
        }

        try {
            const result =
                await service.acceptBatch(
                    {
                        req,

                        headers:
                            req.headers ??
                            {}
                    },
                    requestBody
                );

            const statusCode =
                Number.isInteger(
                    result?.httpStatusCode
                ) &&
                result.httpStatusCode >=
                    100 &&
                result.httpStatusCode <=
                    599
                    ? result.httpStatusCode
                    : result?.success
                        ? 200
                        : 400;

            sendVoiceDedicatedJson(
                res,
                statusCode,
                result
            );
        } catch (error) {
            logger?.error?.(
                "[VoiceDedicatedSessionDeltaHttp] Request failed.",
                {
                    error:
                        String(
                            error?.stack ??
                            error
                        )
                }
            );

            sendVoiceDedicatedJson(
                res,
                500,
                {
                    success:
                        false,

                    reason:
                        "voice_delta_http_handler_failed",

                    message:
                        "Voice dedicated session delta request failed.",

                    data:
                        {},

                    ts:
                        Date.now()
                }
            );
        }

        return true;
    };
}

export {
    VOICE_DEDICATED_SESSION_DELTA_MAX_BODY_BYTES,
    VOICE_DEDICATED_SESSION_DELTA_PATH,
    VOICE_DEDICATED_SESSION_DELTA_REQUEST_TIMEOUT_MS,
    createVoiceDedicatedSessionDeltaHttpHandler,
    readVoiceDedicatedJsonBody,
    readVoiceDedicatedRequestPath
};

/*
توضیح فایل:
این فایل مسیر دریافت دسته رویدادهای سشن صوتی را روی همان سرور اچ‌تی‌تی‌پی اصلی مدیریت می‌کند، بدنه جیسون را با محدودیت چهار مگابایت می‌خواند و نتیجه سرویس قطعی را با کد وضعیت مناسب برمی‌گرداند.
*/
