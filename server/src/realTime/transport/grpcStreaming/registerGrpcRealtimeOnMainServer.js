import { attachGrpcStreamingRealtimeCore } from "./attachGrpcStreamingRealtimeCore.js";
import { tokenService } from "../../../core/auth/auth.instance.js";

//* این تابع مسیر جی‌آر‌پی‌سی ریل‌تایم را روی سرور اصلی جی‌آر‌پی‌سی ثبت می‌کند.
function registerGrpcRealtimeOnMainServer({
    grpcServer = null,
    websocketRealtimeRuntime = null,
    logger = null
} = {}) {
    return attachGrpcStreamingRealtimeCore({
        grpcServer,
        logger,
        tokenService,
        sharedRealtime: websocketRealtimeRuntime
    });
}

//* توضیح کلی فایل:
//* این فایل فقط مسیر جی‌آر‌پی‌سی ریل‌تایم را به سرور اصلی وصل می‌کند.
//* این فایل مسیر وب‌سوکت را تغییر نمی‌دهد.
//* این فایل از رانتایم وب‌سوکت برای مشترک کردن رجیستری، روم‌ها، رُتِر و سرویس‌های گیم استفاده می‌کند.
//* هدف این فایل جدا نگه داشتن فعال‌سازی جی‌آر‌پی‌سی ریل‌تایم از فایل شروع سرور است.

export { registerGrpcRealtimeOnMainServer };
