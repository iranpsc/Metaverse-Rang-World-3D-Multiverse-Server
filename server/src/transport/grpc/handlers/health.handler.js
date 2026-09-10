// File ==> src/transport/grpc/handlers/health.handler.js

/**
 * Health gRPC Handler
 * فقط برای liveness / readiness
 */
export const healthHandlers = {
    Check(call, callback) {
        callback(null, {
            ok: true,
            message: "ok"
        });
    }
};
/* 
فایل src / transport / grpc / handlers / health.handler.js پیاده سازی متد Check از سرویس HealthService است.این فایل یک object به نام healthHandlers export می کند که در src / transport / grpc / server.js به HealthService متصل می شود.وقتی متد HealthService / Check توسط کلاینت، Envoy یا ابزار تست صدا زده شود، تابع Check اجرا می شود و پاسخ { ok: true, message: "ok" } را برمی گرداند.

در نسخه فعلی، این فایل فقط یک Health Check ساده برای پاسخ دادن به liveness / readiness پایه ارائه می دهد.ورودی متد Check از نوع Empty است و handler از request body استفاده نمی کند.خروجی تابع با پیام HealthReply داخل health.proto هماهنگ است و شامل دو فیلد ok و message می شود.


 */