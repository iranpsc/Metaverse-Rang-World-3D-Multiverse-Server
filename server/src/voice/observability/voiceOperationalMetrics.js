class VoiceOperationalMetrics {
    //* این سازنده Counterها و Gaugeهای عددی را بدون نگهداری داده صوتی آماده می‌کند.
    constructor({ now = () => Date.now() } = {}) {
        if (typeof now !== "function") throw new TypeError("now must be a function.");
        this.now = now;
        this.startedAtMs = now();
        this.counters = new Map();
        this.gauges = new Map();
        this.latencyBuckets = new Map([
            [5, 0], [10, 0], [20, 0], [50, 0], [100, 0], [250, 0], [500, 0], [1000, 0]
        ]);
        this.latencyOverflow = 0;
    }

    //* این تابع یک Counter شناخته‌شده را افزایش می‌دهد.
    increment(name, amount = 1) {
        if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Metric amount is invalid.");
        const key = this.normalizeName(name);
        this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
    }

    //* این تابع مقدار جاری Gauge را ثبت می‌کند.
    setGauge(name, value) {
        if (!Number.isFinite(value) || value < 0) throw new RangeError("Metric gauge is invalid.");
        this.gauges.set(this.normalizeName(name), value);
    }

    //* این تابع زمان مسیر یک فریم را داخل Histogram محدود ثبت می‌کند.
    observeRouteLatency(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError("Route latency is invalid.");
        for (const maximum of this.latencyBuckets.keys()) {
            if (durationMs <= maximum) {
                this.latencyBuckets.set(maximum, this.latencyBuckets.get(maximum) + 1);
                return;
            }
        }
        this.latencyOverflow += 1;
    }

    //* این تابع Snapshot قفل‌شده Metrics را برای Health برمی‌گرداند.
    getSnapshot() {
        return Object.freeze({
            startedAtMs: this.startedAtMs,
            uptimeMs: Math.max(0, this.now() - this.startedAtMs),
            counters: Object.freeze(Object.fromEntries(this.counters)),
            gauges: Object.freeze(Object.fromEntries(this.gauges)),
            routeLatencyMs: Object.freeze({
                buckets: Object.freeze(Object.fromEntries(this.latencyBuckets)),
                overflow: this.latencyOverflow
            })
        });
    }

    //* این تابع نام Metric را به مجموعه محدود حروف و زیرخط تبدیل می‌کند.
    normalizeName(name) {
        const value = String(name ?? "").trim();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new TypeError("Metric name is invalid.");
        return value;
    }
}

export { VoiceOperationalMetrics };

/*
توضیح فایل:
این فایل Counter، Gauge و Histogram محدود عملیات Voice را بدون متن حساس، Token یا Payload صوتی نگه می‌دارد.
*/
