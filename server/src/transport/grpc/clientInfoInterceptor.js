// File =>  src\transport\grpc\clientInfoInterceptor.js
export function readClientInfo(call) {
    const meta = call.metadata?.getMap?.() ?? {};

    const platform =
        meta["x-client-platform"] ??
        meta["x-metaverse-client"] ??
        meta["platform"] ??
        "";

    const version =
        meta["x-client-version"] ??
        meta["x-metaverse-version"] ??
        meta["version"] ??
        "";

    return { platform, version };
}
/* برای خواندن اطلاعات کلاینت از metadata درخواست gRPC استفاده می‌شود.

این فایل تابع readClientInfo(call) را export می‌کند
و از داخل call.metadata مقدارهای مربوط به platform و version را استخراج می‌کند.

برای platform چند کلید مختلف مثل x - client - platform،
x - metaverse - client و platform بررسی می‌شود.

برای version هم کلیدهایی مثل x - client - version،
x - metaverse - version و version بررسی می‌شوند.

خروجی تابع یک object ساده شامل platform و version است
که می‌تواند برای لاگ، debug، analytics یا کنترل نسخه کلاینت استفاده شود.

 */