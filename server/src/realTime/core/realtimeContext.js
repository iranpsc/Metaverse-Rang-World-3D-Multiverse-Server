// File => src/realTime/core/realtimeContext.js

import crypto from "crypto";

const RealtimeContextState = Object.freeze({
    connected: "connected",
    authenticated: "authenticated",
    closing: "closing",
    closed: "closed"
});

//* این تابع شناسه یکتای کانکشن را می سازد تا هر کانکشن در لاگ، رجیستری و رُتِر قابل ردیابی باشد.
function createConnectionId(prefix = "rt_conn") {
    return `${prefix}_${crypto.randomUUID()}`;
}

//* این تابع کانتکست اولیه هر کانکشن را می سازد و اطلاعات مشترک مورد نیاز کُر، رجیستری و رُتِر را یکجا نگه می دارد.
function createRealtimeContext({ connection, transportKind, logger = null, tokenService = null, registry = null, rooms = null } = {}) {
    return {
        connectionId: createConnectionId(),
        state: RealtimeContextState.connected,
        connection,
        transportKind: transportKind ?? connection?.kind ?? "unknown",
        logger,
        tokenService,
        registry,
        rooms,
        user: null,
        roomId: "",
        connectedAt: Date.now(),
        authenticatedAt: 0,
        lastMessageAt: 0,
        lastErrorAt: 0,
        meta: Object.create(null)
    };
}

//* این تابع بررسی می کند که کانتکست هنوز باز است و کانکشن در حالت بسته شدن یا بسته شده نباشد.
function isRealtimeContextOpen(ctx) {
    return !!ctx && ctx.state !== RealtimeContextState.closing && ctx.state !== RealtimeContextState.closed;
}

//* این تابع بررسی می کند که کانتکست بعد از آث موفق، یوزر معتبر داشته باشد.
function isRealtimeContextAuthenticated(ctx) {
    return !!ctx?.user && ctx.state === RealtimeContextState.authenticated;
}

//* این تابع بعد از آث موفق، اطلاعات یوزر را روی کانتکست ثبت می کند و وضعیت کانکشن را آثنتیکیتد می گذارد.
function markRealtimeContextAuthenticated(ctx, user) {
    if (!ctx) return null;
    ctx.user = user ?? null;
    ctx.state = RealtimeContextState.authenticated;
    ctx.authenticatedAt = Date.now();
    return ctx;
}

//* این تابع روم فعال کانکشن را روی کانتکست ثبت می کند تا هَندلِرهای بعدی بدانند یوزر در کدام روم است.
function setRealtimeContextRoom(ctx, roomId = "") {
    if (!ctx) return null;
    ctx.roomId = String(roomId ?? "");
    return ctx;
}

//* این تابع زمان آخرین پیام دریافتی را برای مانیتورینگ، تایم آوت و دیباگ روی کانتکست ذخیره می کند.
function touchRealtimeContextMessage(ctx) {
    if (!ctx) return null;
    ctx.lastMessageAt = Date.now();
    return ctx;
}

//* این تابع زمان آخرین خطای مربوط به کانکشن را روی کانتکست ذخیره می کند تا بعداً در لاگ و مانیتورینگ بررسی شود.
function touchRealtimeContextError(ctx) {
    if (!ctx) return null;
    ctx.lastErrorAt = Date.now();
    return ctx;
}

//* این تابع وضعیت کانتکست را به حالت در حال بسته شدن تغییر می دهد تا کُر بداند این کانکشن در مسیر بسته شدن است.
function markRealtimeContextClosing(ctx) {
    if (!ctx) return null;
    ctx.state = RealtimeContextState.closing;
    return ctx;
}

//* این تابع وضعیت کانتکست را به بسته شده تغییر می دهد تا بعد از کلیناپ دیگر به عنوان کانکشن فعال استفاده نشود.
function markRealtimeContextClosed(ctx) {
    if (!ctx) return null;
    ctx.state = RealtimeContextState.closed;
    return ctx;
}

//* این تابع یک اسنپ شات امن از کانتکست می سازد تا بدون لو دادن توکن یا اطلاعات حساس در لاگ استفاده شود.
function getRealtimeContextSnapshot(ctx) {
    return {
        connectionId: ctx?.connectionId ?? "",
        state: ctx?.state ?? "unknown",
        transportKind: ctx?.transportKind ?? "unknown",
        userId: ctx?.user?.id ?? ctx?.user?.userId ?? "",
        roomId: ctx?.roomId ?? "",
        connectedAt: ctx?.connectedAt ?? 0,
        authenticatedAt: ctx?.authenticatedAt ?? 0,
        lastMessageAt: ctx?.lastMessageAt ?? 0,
        lastErrorAt: ctx?.lastErrorAt ?? 0
    };
}

/*
توضیح کلی اسکریپت:
این فایل کانتکست هر کانکشن ریل تایم را می سازد و مدیریت می کند.
کانتکست یعنی اطلاعات زنده و مشترک یک کانکشن مثل شناسه کانکشن، وضعیت کانکشن، یوزر، روم، لاگر، توکن سرویس، رجیستری و روم ها.
کُر ریل تایم از این کانتکست استفاده می کند تا پیام ها را بدون وابستگی مستقیم به وب سوکت یا جی آر پی سی به رُتِر و هَندلِرها تحویل بدهد.
این فایل نباید وب سوکت خام، جی آر پی سی خام، آث واقعی، لاجیک روم یا لاجیک بازی اجرا کند.
وظیفه این فایل فقط ساخت و به روزرسانی وضعیت کانتکست کانکشن است.
*/

export {
    RealtimeContextState,
    createConnectionId,
    createRealtimeContext,
    isRealtimeContextOpen,
    isRealtimeContextAuthenticated,
    markRealtimeContextAuthenticated,
    setRealtimeContextRoom,
    touchRealtimeContextMessage,
    touchRealtimeContextError,
    markRealtimeContextClosing,
    markRealtimeContextClosed,
    getRealtimeContextSnapshot
};