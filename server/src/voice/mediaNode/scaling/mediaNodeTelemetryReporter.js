import http from "node:http";

const DEFAULT_REPORT_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

//* این تابع متن اجباری گزارش گر را پاکسازی می کند.
function normalizeRequiredText(value, fieldName, maximumLength = 255) {
    const text = String(value ?? "").trim();
    if (!text || text.length > maximumLength) throw new TypeError(`${fieldName} is invalid.`);
    return text;
}

//* این تابع یک گزارش بار نود را با احراز داخلی به رانتایم بک اند می فرستد.
function postMediaNodeMetrics({ host, port, secret, nodeId, metrics, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, httpModule = http } = {}) {
    const safeHost = normalizeRequiredText(host, "host");
    const safeSecret = String(secret ?? "");
    const safeNodeId = normalizeRequiredText(nodeId, "nodeId", 128);
    if (safeSecret.length < 32) throw new Error("Voice media node bridge secret must be at least 32 characters.");
    if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) throw new RangeError("port is invalid.");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new RangeError("timeoutMs is invalid.");
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new TypeError("metrics is invalid.");

    const body = Buffer.from(JSON.stringify({
        nodeId: safeNodeId,
        activeConnections: metrics.activeConnections,
        cpuPercent: metrics.cpuPercent,
        outboundKbps: metrics.outboundKbps
    }), "utf8");

    return new Promise((resolve, reject) => {
        const request = httpModule.request({
            host: safeHost,
            port: Number(port),
            method: "POST",
            path: "/media-node/metrics",
            headers: {
                Authorization: `Bearer ${safeSecret}`,
                "Content-Type": "application/json",
                "Content-Length": String(body.length)
            }
        }, (response) => {
            const chunks = [];
            let total = 0;
            response.on("data", (chunk) => {
                total += chunk.length;
                if (total <= 64 * 1024) chunks.push(Buffer.from(chunk));
            });
            response.once("end", () => {
                let payload = {};
                try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
                catch { payload = {}; }
                if (response.statusCode >= 200 && response.statusCode < 300 && payload?.success === true) {
                    resolve(payload);
                    return;
                }
                reject(new Error(String(payload?.error ?? `media_metrics_http_${response.statusCode}`)));
            });
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error("media_metrics_timeout")));
        request.once("error", reject);
        request.end(body);
    });
}

//* این تابع گزارش دوره ای بار نود را با جلوگیری از هم پوشانی درخواست ها می سازد.
function createMediaNodeTelemetryReporter({
    host,
    port,
    secret,
    nodeId,
    telemetryRuntime,
    intervalMs = DEFAULT_REPORT_INTERVAL_MS,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    logger = null,
    postMetrics = postMediaNodeMetrics
} = {}) {
    if (!telemetryRuntime || typeof telemetryRuntime.sampleTelemetry !== "function") throw new TypeError("telemetryRuntime is invalid.");
    if (typeof postMetrics !== "function") throw new TypeError("postMetrics is invalid.");
    if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60_000) throw new RangeError("intervalMs is invalid.");
    let timer = null;
    let inFlight = false;
    let stopped = false;

    //* این تابع یک نمونه بار را ارسال می کند و شکست را به دور بعد منتقل می کند.
    async function reportOnce() {
        if (stopped || inFlight) return false;
        inFlight = true;
        try {
            const metrics = telemetryRuntime.sampleTelemetry();
            await postMetrics({ host, port, secret, nodeId, metrics, timeoutMs });
            return true;
        } catch (error) {
            logger?.warn?.("VOICE_MEDIA_NODE_METRICS=FAIL", { nodeId, error: String(error?.message ?? error) });
            return false;
        } finally {
            inFlight = false;
        }
    }

    //* این تابع گزارش دوره ای را فعال و نخستین گزارش را بدون انتظار یک دور کامل ارسال می کند.
    function start() {
        if (stopped) throw new Error("Media node telemetry reporter is stopped.");
        if (timer) return;
        void reportOnce();
        timer = setInterval(() => { void reportOnce(); }, intervalMs);
        timer.unref?.();
    }

    //* این تابع زمان سنج گزارش را پاک می کند و گزارش جدیدی آغاز نمی کند.
    function stop() {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
    }

    //* این تابع وضعیت محدود گزارش گر را برای سلامت نود برمی گرداند.
    function getStats() {
        return Object.freeze({ running: Boolean(timer), inFlight, stopped, intervalMs, timeoutMs });
    }

    return Object.freeze({ start, stop, reportOnce, getStats });
}

export {
    DEFAULT_REPORT_INTERVAL_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    createMediaNodeTelemetryReporter,
    postMediaNodeMetrics
};
