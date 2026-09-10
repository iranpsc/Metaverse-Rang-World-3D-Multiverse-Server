// File => src/domain/auth/authError.js

// src/domain/auth/authError.js

/**
 * AuthError
 * کلاس خطای پایه برای بخش احراز هویت
 */
export class AuthError extends Error {
    constructor(code, message) {
        super(message || "Authentication error");

        this.name = "AuthError";
        this.code = code || "INTERNAL";

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AuthError);
        }
    }
}

/**
 * AuthErrors
 * کارخانه تولید خطاهای استاندارد با کدهای مشخص
 */
export const AuthErrors = {
    invalidInput: (msg) =>
        new AuthError("INVALID_ARGUMENT", msg || "Invalid request"),

    conflict: (msg) =>
        new AuthError("ALREADY_EXISTS", msg || "Resource already exists"),

    emailAlreadyExists: (msg) =>
        new AuthError("ALREADY_EXISTS", msg || "EMAIL_ALREADY_EXISTS"),

    userNameAlreadyExists: (msg) =>
        new AuthError("ALREADY_EXISTS", msg || "USERNAME_ALREADY_EXISTS"),

    unauth: (msg) =>
        new AuthError("UNAUTHENTICATED", msg || "Authentication failed"),

    forbidden: (msg) =>
        new AuthError("PERMISSION_DENIED", msg || "Access denied"),

    notFound: (msg) =>
        new AuthError("NOT_FOUND", msg || "Resource not found"),

    internal: (msg) =>
        new AuthError("INTERNAL", msg || "Internal server error")
};
/* 
مسئول تعریف خطاهای استاندارد بخش Auth است.

این فایل یک کلاس پایه به نام AuthError دارد
که علاوه بر پیام خطا، یک code مشخص هم نگه می‌دارد.

کدهایی مثل INVALID_ARGUMENT، ALREADY_EXISTS،
UNAUTHENTICATED، PERMISSION_DENIED، NOT_FOUND و INTERNAL.

همچنین object آماده‌ای به نام AuthErrors دارد
که برای ساخت خطاهای رایج Auth استفاده می‌شود.

مثلاً برای ورودی اشتباه از invalidInput،
برای ایمیل تکراری از conflict،
و برای token نامعتبر از unauth استفاده می‌شود.

این خطاها بعداً در auth.error.mapper.js
به status code استاندارد gRPC تبدیل می‌شوند.

 */