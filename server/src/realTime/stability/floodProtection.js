// File => src/realTime/stability/floodProtection.js

const DefaultFloodProtectionConfig = Object.freeze({
    maxPerWindow: 60,
    windowMs: 1000,
    blockMs: 5000
});

//* این تابع کلید محدودسازی را از کانکشن یا کانتکست می سازد تا هر یوزر یا کانکشن جداگانه کنترل شود.
function readFloodKey(source) {
    return String(source?.connectionId ?? source?.id ?? source?.user?.id ?? source?.userId ?? source?.remoteAddress ?? "anonymous");
}

//* این تابع یک وضعیت اولیه برای شمارش پیام ها در بازه زمانی می سازد.
function createFloodBucket(now = Date.now()) {
    return { count: 0, windowStart: now, blockedUntil: 0, lastSeenAt: now };
}

//* این تابع یک اسنپ شات امن از وضعیت محدودسازی می سازد تا برای لاگ، دیباگ و مانیتورینگ استفاده شود.
function makeFloodSnapshot(key, bucket, config) {
    return {
        key,
        count: bucket?.count ?? 0,
        windowStart: bucket?.windowStart ?? 0,
        blockedUntil: bucket?.blockedUntil ?? 0,
        lastSeenAt: bucket?.lastSeenAt ?? 0,
        maxPerWindow: config.maxPerWindow,
        windowMs: config.windowMs,
        blockMs: config.blockMs
    };
}

//* این تابع فلاد پروتکشن می سازد تا پیام های زیاد در یک بازه زمانی کنترل و در صورت نیاز بلاک شوند.
function makeFloodProtection({ maxPerWindow = DefaultFloodProtectionConfig.maxPerWindow, windowMs = DefaultFloodProtectionConfig.windowMs, blockMs = DefaultFloodProtectionConfig.blockMs, keyReader = readFloodKey, logger = null } = {}) {
    const buckets = new Map();
    const config = { maxPerWindow, windowMs, blockMs };

    //* این تابع بررسی می کند که منبع پیام اجازه ارسال دارد یا باید به دلیل اسپم رد شود.
    function allow(source = "default") {
        const key = keyReader(source);
        const now = Date.now();
        const bucket = buckets.get(key) ?? createFloodBucket(now);
        bucket.lastSeenAt = now;

        if (bucket.blockedUntil > now) {
            buckets.set(key, bucket);
            return false;
        }

        if (now - bucket.windowStart > windowMs) {
            bucket.windowStart = now;
            bucket.count = 0;
        }

        bucket.count++;
        if (bucket.count > maxPerWindow) {
            bucket.blockedUntil = now + blockMs;
            buckets.set(key, bucket);
            logger?.warn?.("Realtime flood protection blocked source", makeFloodSnapshot(key, bucket, config));
            return false;
        }

        buckets.set(key, bucket);
        return true;
    }

    //* این تابع وضعیت محدودسازی یک منبع را پاک می کند تا بعد از دیسکانکت یا پایان بلاک دوباره تمیز شروع شود.
    function reset(source = "default") {
        return buckets.delete(keyReader(source));
    }

    //* این تابع باکت های قدیمی را پاک می کند تا حافظه رجیستری محدودسازی بی دلیل رشد نکند.
    function cleanup(maxIdleMs = 60000) {
        const now = Date.now();
        let removed = 0;
        for (const [key, bucket] of buckets.entries()) {
            if (now - bucket.lastSeenAt > maxIdleMs) {
                buckets.delete(key);
                removed++;
            }
        }
        return removed;
    }

    //* این تابع یک اسنپ شات از وضعیت فعلی فلاد پروتکشن برمی گرداند.
    function getSnapshot() {
        return { bucketCount: buckets.size, maxPerWindow, windowMs, blockMs };
    }

    return { allow, reset, cleanup, getSnapshot };
}

/*
توضیح کلی اسکریپت:
این فایل فلاد پروتکشن ریل تایم را مدیریت می کند.
فلاد پروتکشن جلوی ارسال پیام های زیاد در زمان کوتاه را می گیرد.
هر کانکشن یا یوزر با یک کلید جدا کنترل می شود.
اگر تعداد پیام ها از حد مجاز بیشتر شود، منبع پیام برای مدت کوتاه بلاک می شود.
این فایل نباید آث، رُتِر، روم یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط کنترل اسپم و محافظت از کُر ریل تایم در برابر فشار پیام زیاد است.
*/

export { DefaultFloodProtectionConfig, readFloodKey, createFloodBucket, makeFloodSnapshot, makeFloodProtection };
