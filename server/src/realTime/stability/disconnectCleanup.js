// File => src/realTime/stability/disconnectCleanup.js

//* این تابع یک تابع را امن اجرا می کند تا خطای کلیناپ باعث کرش شدن مسیر دیسکانکت نشود.
function safeCleanupCall(fn, ...args) {
    try { return typeof fn === "function" ? fn(...args) : undefined; } catch { return undefined; }
}

//* این تابع کلیناپ کامل کانکشن را اجرا می کند و کانکشن را از روم ها و رجیستری خارج می کند.
function cleanupRealtimeConnection(ctx, { registry = ctx?.registry, rooms = ctx?.rooms, logger = ctx?.logger, closeInfo = null } = {}) {
    if (!ctx) return false;

    const connection = ctx.realtimeConnection ?? ctx.connection;
    safeCleanupCall(rooms?.leaveAll?.bind(rooms), connection);
    safeCleanupCall(registry?.removeConnection?.bind(registry), connection);
    safeCleanupCall(registry?.remove?.bind(registry), ctx.user?.id ?? ctx.user?.userId ?? ctx.connectionId);

    ctx.roomId = "";
    ctx.meta ??= Object.create(null);
    ctx.meta.cleanedAt = Date.now();
    ctx.meta.closeInfo = closeInfo;

    logger?.info?.("Realtime disconnect cleanup completed", {
        connectionId: ctx.connectionId,
        userId: ctx.user?.id ?? ctx.user?.userId ?? "",
        closeInfo
    });

    return true;
}

//* این تابع رویدادهای بسته شدن و خطای وب سوکت خام را به کلیناپ امن وصل می کند.
function attachDisconnectCleanup(ws, { onClose, onError, logger = null } = {}) {
    let cleaned = false;

    const runCleanup = (reason) => {
        if (cleaned) return;
        cleaned = true;
        safeCleanupCall(onClose, reason);
    };

    ws.on("close", (code, reason) => runCleanup({ code, reason: String(reason ?? "") }));
    ws.on("error", (error) => {
        logger?.warn?.("Realtime websocket cleanup after error", { error: error?.message ?? String(error) });
        safeCleanupCall(onError, error);
        runCleanup({ error: error?.message ?? String(error) });
    });
}

//* این تابع یک کلیناپر قابل استفاده در کُر می سازد تا فازهای بعدی دیسکانکت را از یک مسیر واحد انجام دهند.
function createDisconnectCleanup(options = {}) {
    return {
        //* این تابع کلیناپ کانکشن را با تنظیمات ذخیره شده اجرا می کند.
        cleanup(ctx, closeInfo = null) {
            return cleanupRealtimeConnection(ctx, { ...options, closeInfo });
        }
    };
}

/*
توضیح کلی اسکریپت:
این فایل کلیناپ دیسکانکت ریل تایم را مدیریت می کند.
وقتی کانکشن بسته می شود، باید از روم ها و رجیستری خارج شود تا حافظه و وضعیت سرور خراب نشود.
این فایل کلیناپ را امن اجرا می کند تا خطای یک بخش باعث کرش شدن کل مسیر دیسکانکت نشود.
این فایل نباید آث، رُتِر یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط پاکسازی امن وضعیت کانکشن بعد از دیسکانکت است.
*/

export { safeCleanupCall, cleanupRealtimeConnection, attachDisconnectCleanup, createDisconnectCleanup };
