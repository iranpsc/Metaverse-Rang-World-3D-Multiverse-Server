// File => src/realTime/stability/ackTracker.js

import { AckStatus, isAckEnvelope } from "../protocol/ack.js";

const DefaultAckTrackerConfig = Object.freeze({
    timeoutMs: 5000,
    cleanupIntervalMs: 10000
});

//* این تابع شناسه پیام اصلی را از اِنولوپ اَک می خواند تا اَک به پیام درست وصل شود.
function readAckOriginalMessageId(envelope) {
    return String(envelope?.payload?.originalMessageId ?? envelope?.replyTo ?? "");
}

//* این تابع یک رکورد انتظار اَک می سازد تا پیام های مهم تا زمان دریافت اَک قابل پیگیری باشند.
function createPendingAckRecord({ envelope, timeoutMs, onAck = null, onTimeout = null }) {
    const createdAt = Date.now();
    return {
        messageId: String(envelope?.id ?? ""),
        envelope,
        createdAt,
        timeoutAt: createdAt + timeoutMs,
        onAck,
        onTimeout
    };
}

//* این تابع اَک ترَکِر می سازد تا پیام های نیازمند اَک را تا دریافت تاییدیه یا تایم آوت دنبال کند.
function createAckTracker({ timeoutMs = DefaultAckTrackerConfig.timeoutMs, cleanupIntervalMs = DefaultAckTrackerConfig.cleanupIntervalMs, logger = null } = {}) {
    const pending = new Map();
    let cleanupTimer = null;

    //* این تابع تایمر کلیناپ داخلی را شروع می کند تا اَک های تایم آوت شده پاک شوند.
    function start() {
        if (cleanupTimer) return;
        cleanupTimer = setInterval(() => cleanupExpired(), cleanupIntervalMs);
    }

    //* این تابع تایمر کلیناپ داخلی را متوقف می کند.
    function stop() {
        if (!cleanupTimer) return;
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }

    //* این تابع یک اِنولوپ نیازمند اَک را در لیست انتظار ثبت می کند.
    function track(envelope, { onAck = null, onTimeout = null } = {}) {
        if (!envelope?.id) return false;
        pending.set(envelope.id, createPendingAckRecord({ envelope, timeoutMs, onAck, onTimeout }));
        start();
        return true;
    }

    //* این تابع اِنولوپ اَک دریافتی را پردازش می کند و اگر پیام منتظر پیدا شود، کالبک آن را اجرا می کند.
    function resolve(envelope) {
        if (!isAckEnvelope(envelope)) return false;
        const originalMessageId = readAckOriginalMessageId(envelope);
        if (!originalMessageId || !pending.has(originalMessageId)) return false;

        const record = pending.get(originalMessageId);
        pending.delete(originalMessageId);
        safeAckCallback(record.onAck, envelope, record);
        return true;
    }

    //* این تابع پیام های منتظر اَک را که تایم آوت شده اند پاک می کند و کالبک تایم آوت را اجرا می کند.
    function cleanupExpired(now = Date.now()) {
        let removed = 0;
        for (const [messageId, record] of pending.entries()) {
            if (record.timeoutAt > now) continue;
            pending.delete(messageId);
            removed++;
            logger?.warn?.("Realtime ack timeout", { messageId, timeoutMs });
            safeAckCallback(record.onTimeout, { status: AckStatus.timeout, messageId }, record);
        }
        if (pending.size === 0) stop();
        return removed;
    }

    //* این تابع یک پیام را از لیست انتظار اَک حذف می کند.
    function untrack(messageId) {
        return pending.delete(String(messageId ?? ""));
    }

    //* این تابع همه اَک های در انتظار را پاک می کند و تایمر داخلی را متوقف می کند.
    function clear() {
        pending.clear();
        stop();
    }

    //* این تابع اسنپ شات وضعیت اَک ترَکِر را برای لاگ و تست برمی گرداند.
    function getSnapshot() {
        return { pendingCount: pending.size, timeoutMs, cleanupIntervalMs, isRunning: Boolean(cleanupTimer) };
    }

    return { start, stop, track, resolve, cleanupExpired, untrack, clear, getSnapshot };
}

//* این تابع کالبک های اَک را امن اجرا می کند تا خطای مصرف کننده باعث کرش شدن اَک ترَکِر نشود.
function safeAckCallback(callback, envelope, record) {
    try { return typeof callback === "function" ? callback(envelope, record) : undefined; } catch { return undefined; }
}

/*
توضیح کلی اسکریپت:
این فایل اَک ترَکِر ریل تایم را مدیریت می کند.
وقتی یک پیام مهم نیاز به اَک دارد، این فایل آن را در لیست انتظار نگه می دارد.
اگر اَک برسد، پیام از لیست انتظار حذف می شود.
اگر اَک در زمان مشخص نرسد، پیام تایم آوت می شود و کالبک تایم آوت اجرا می شود.
این فایل نباید آث، رُتِر، ترنسپورت یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط ردیابی اَک پیام های مهم است.
*/

export { DefaultAckTrackerConfig, readAckOriginalMessageId, createPendingAckRecord, createAckTracker, safeAckCallback };
