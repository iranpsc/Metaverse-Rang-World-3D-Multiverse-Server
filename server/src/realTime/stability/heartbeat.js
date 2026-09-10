// File => src/realTime/stability/heartbeat.js

const DefaultHeartbeatConfig = Object.freeze({
    intervalMs: 15000,
    timeoutMs: 30000,
    terminateOnTimeout: true
});

//* این تابع بررسی می کند که وب سوکت هنوز باز است و امکان پینگ فرستادن دارد یا نه.
function isHeartbeatSocketOpen(ws) {
    return ws?.readyState === ws?.OPEN || ws?.readyState === 1;
}

//* این تابع زمان فعلی را برمی گرداند تا همه محاسبه های هارت بیت از یک مسیر خوانده شوند.
function nowMs() {
    return Date.now();
}

//* این تابع یک اسنپ شات سبک از وضعیت هارت بیت می سازد تا برای لاگ، دیباگ و مانیتورینگ استفاده شود.
function makeHeartbeatSnapshot({ lastPongAt, lastPingAt, missedPongs, intervalMs, timeoutMs, isRunning }) {
    const now = nowMs();
    return {
        isRunning: Boolean(isRunning),
        lastPingAt: Number(lastPingAt ?? 0),
        lastPongAt: Number(lastPongAt ?? 0),
        missedPongs: Number(missedPongs ?? 0),
        intervalMs: Number(intervalMs ?? 0),
        timeoutMs: Number(timeoutMs ?? 0),
        ageSinceLastPongMs: lastPongAt ? now - lastPongAt : 0
    };
}

//* این تابع هارت بیت کامل برای یک وب سوکت خام را شروع می کند و در صورت تایم آوت، کالبک و بستن اتصال را مدیریت می کند.
function startHeartbeat(ws, { intervalMs = DefaultHeartbeatConfig.intervalMs, timeoutMs = DefaultHeartbeatConfig.timeoutMs, onTimeout, onPong, onPing, logger = null, terminateOnTimeout = DefaultHeartbeatConfig.terminateOnTimeout } = {}) {
    let lastPongAt = nowMs();
    let lastPingAt = 0;
    let missedPongs = 0;
    let isRunning = true;

    const handlePong = () => {
        missedPongs = 0;
        lastPongAt = nowMs();
        try { onPong?.(makeHeartbeatSnapshot({ lastPongAt, lastPingAt, missedPongs, intervalMs, timeoutMs, isRunning })); } catch { }
    };

    ws?.on?.("pong", handlePong);

    const timer = setInterval(() => {
        if (!isRunning || !isHeartbeatSocketOpen(ws)) return;

        const currentTime = nowMs();
        if (currentTime - lastPongAt > timeoutMs) {
            missedPongs++;
            const snapshot = makeHeartbeatSnapshot({ lastPongAt, lastPingAt, missedPongs, intervalMs, timeoutMs, isRunning });

            try { onTimeout?.(snapshot); } catch { }
            logger?.warn?.("Realtime heartbeat timeout", snapshot);

            if (terminateOnTimeout) {
                try { ws?.terminate?.(); } catch { }
                stopHeartbeat();
            }
            return;
        }

        try {
            lastPingAt = currentTime;
            ws.ping();
            onPing?.(makeHeartbeatSnapshot({ lastPongAt, lastPingAt, missedPongs, intervalMs, timeoutMs, isRunning }));
        } catch (error) {
            logger?.warn?.("Realtime heartbeat ping failed", { error: error?.message ?? String(error) });
        }
    }, intervalMs);

    //* این تابع هارت بیت فعال را متوقف می کند و تایمر داخلی آن را پاک می کند.
    function stopHeartbeat() {
        if (!isRunning) return;
        isRunning = false;
        clearInterval(timer);
        if (typeof ws?.off === "function") ws.off("pong", handlePong);
        else if (typeof ws?.removeListener === "function") ws.removeListener("pong", handlePong);
    }

    return stopHeartbeat;
}

//* این تابع یک کنترلر هارت بیت می سازد تا فازهای بعدی بتوانند وضعیت هارت بیت را به شکل قابل تست مدیریت کنند.
function createHeartbeatController(options = {}) {
    let stopCurrentHeartbeat = null;
    let lastSnapshot = makeHeartbeatSnapshot({ isRunning: false });

    return {
        //* این تابع هارت بیت کنترلر را برای وب سوکت داده شده شروع می کند.
        start(ws) {
            this.stop();
            stopCurrentHeartbeat = startHeartbeat(ws, {
                ...options,
                onPong: (snapshot) => {
                    lastSnapshot = snapshot;
                    options.onPong?.(snapshot);
                },
                onPing: (snapshot) => {
                    lastSnapshot = snapshot;
                    options.onPing?.(snapshot);
                },
                onTimeout: (snapshot) => {
                    lastSnapshot = snapshot;
                    options.onTimeout?.(snapshot);
                }
            });
            return this;
        },

        //* این تابع هارت بیت کنترلر را متوقف می کند.
        stop() {
            stopCurrentHeartbeat?.();
            stopCurrentHeartbeat = null;
            return this;
        },

        //* این تابع آخرین اسنپ شات هارت بیت را برای لاگ و تست برمی گرداند.
        getSnapshot() {
            return lastSnapshot;
        }
    };
}

/*
توضیح کلی اسکریپت:
این فایل هارت بیت ریل تایم را مدیریت می کند.
هارت بیت با پینگ و پونگ متوجه می شود که کانکشن هنوز زنده است یا نه.
اگر پونگ در زمان مجاز نرسد، تایم آوت ثبت می شود و در صورت نیاز کانکشن بسته می شود.
این فایل نباید آث، رُتِر، روم یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط پایش سلامت کانکشن و کمک به تشخیص قطع شدن اتصال است.
*/

export { DefaultHeartbeatConfig, isHeartbeatSocketOpen, makeHeartbeatSnapshot, startHeartbeat, createHeartbeatController };
