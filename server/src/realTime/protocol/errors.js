// File => src/realTime/protocol/errors.js

const RealtimeErrorCodes = Object.freeze({
    invalidEnvelope: "invalid_envelope",
    invalidChannel: "invalid_channel",
    invalidMessageType: "invalid_message_type",
    invalidPayload: "invalid_payload",
    unauthorized: "unauthorized",
    tokenExpired: "token_expired",
    invalidToken: "invalid_token",
    forbidden: "forbidden",
    notAuthenticated: "not_authenticated",
    roomRequired: "room_required",
    roomNotFound: "room_not_found",
    rateLimited: "rate_limited",
    ackTimeout: "ack_timeout",
    internalError: "internal_error"
});

//* این تابع آبجکت استاندارد اِرور ریل تایم را می سازد تا همه خطاها شکل یکسان داشته باشند.
function makeRealtimeError(code, message, details = null) {
    return { code, message, details };
}

//* این تابع خطای خام یا متنی را به اِرور استاندارد ریل تایم تبدیل می کند تا کلاینت همیشه کد و پیام قابل فهم بگیرد.
function normalizeError(error, fallbackCode = RealtimeErrorCodes.internalError) {
    if (!error) return makeRealtimeError(fallbackCode, "Unknown realtime error");
    if (typeof error === "string") return makeRealtimeError(fallbackCode, error);
    if (error.code && error.message) return makeRealtimeError(error.code, error.message, error.details ?? null);
    return makeRealtimeError(fallbackCode, error.message ?? "Realtime error", error.details ?? null);
}

/*
توضیح کلی اسکریپت:
این فایل کدهای استاندارد اِرور ریل تایم و ابزار ساخت اِرور را نگه می دارد.
هدف این است که کُر، رُتِر، آث، روم و ترنسپورت هرکدام خطا را با شکل متفاوت نفرستند.
هر خطای خروجی باید کد، پیام و جزییات اختیاری داشته باشد تا یونیتی بتواند تصمیم درست بگیرد.
این فایل نباید آث واقعی، رُتِر، ترنسپورت یا لاجیک بازی اجرا کند.
وظیفه این فایل فقط یکدست کردن ساختار اِرورهای ریل تایم است.
*/

export { RealtimeErrorCodes, makeRealtimeError, normalizeError };
