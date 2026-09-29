//* این تابع اندازه داده باینری را بدون کپی اضافه برمی گرداند.
function getBinaryByteLength(value) {
    if (Buffer.isBuffer(value)) return value.length;
    if (value instanceof Uint8Array) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    throw new TypeError("Outbound media packet must be binary.");
}

//* این تابع مقدار درصد را در بازه معتبر محدود می کند.
function clampPercent(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 100) return 100;
    return value;
}

//* این تابع یک لایه اندازه گیری مستقل پیرامون رانتایم نود رسانه می سازد.
function createMediaNodeTelemetryRuntimeAdapter({
    runtime,
    nowNs = () => process.hrtime.bigint(),
    readCpuUsage = () => process.cpuUsage()
} = {}) {
    if (!runtime || typeof runtime.acceptConnection !== "function" || typeof runtime.deliverMedia !== "function" || typeof runtime.closeMedia !== "function" || typeof runtime.stop !== "function" || typeof runtime.getStats !== "function") throw new TypeError("Media node runtime is invalid.");
    if (typeof nowNs !== "function" || typeof readCpuUsage !== "function") throw new TypeError("Telemetry clocks are invalid.");

    let outboundBytesTotal = 0;
    let previousOutboundBytesTotal = 0;
    let previousSampleNs = BigInt(nowNs());
    let previousCpuUsage = readCpuUsage();
    let lastTelemetry = Object.freeze({ activeConnections: 0, cpuPercent: 0, outboundKbps: 0, outboundBytesTotal: 0 });

    //* این تابع اتصال تازه را با شمارش بایت های خروجی به رانتایم اصلی تحویل می دهد.
    function acceptConnection(input = {}) {
        if (typeof input.sendPacket !== "function") throw new TypeError("sendPacket is invalid.");
        const originalSendPacket = input.sendPacket;
        return runtime.acceptConnection({
            ...input,
            async sendPacket(packet) {
                await Promise.resolve(originalSendPacket(packet));
                outboundBytesTotal += getBinaryByteLength(packet);
            }
        });
    }

    //* این تابع یک نمونه تازه از بار واقعی رانتایم را بر اساس بازه گذشته محاسبه می کند.
    function sampleTelemetry() {
        const currentSampleNs = BigInt(nowNs());
        const currentCpuUsage = readCpuUsage();
        const elapsedNs = currentSampleNs - previousSampleNs;
        const elapsedUs = Number(elapsedNs) / 1000;
        const elapsedMs = Number(elapsedNs) / 1_000_000;
        const cpuDeltaUs = Math.max(0, Number(currentCpuUsage?.user ?? 0) - Number(previousCpuUsage?.user ?? 0)) + Math.max(0, Number(currentCpuUsage?.system ?? 0) - Number(previousCpuUsage?.system ?? 0));
        const outboundBytesDelta = Math.max(0, outboundBytesTotal - previousOutboundBytesTotal);
        const stats = runtime.getStats();
        const activeConnections = Number(stats?.bound ?? 0);
        if (!Number.isSafeInteger(activeConnections) || activeConnections < 0) throw new RangeError("Runtime bound connection count is invalid.");
        const cpuPercent = elapsedUs > 0 ? clampPercent((cpuDeltaUs / elapsedUs) * 100) : lastTelemetry.cpuPercent;
        const outboundKbps = elapsedMs > 0 ? (outboundBytesDelta * 8) / elapsedMs : lastTelemetry.outboundKbps;

        previousSampleNs = currentSampleNs;
        previousCpuUsage = currentCpuUsage;
        previousOutboundBytesTotal = outboundBytesTotal;
        lastTelemetry = Object.freeze({ activeConnections, cpuPercent, outboundKbps, outboundBytesTotal });
        return lastTelemetry;
    }

    //* این تابع آمار پایه و آخرین نمونه بار را برای سلامت نود برمی گرداند.
    function getStats() {
        return Object.freeze({ ...runtime.getStats(), telemetry: lastTelemetry });
    }

    return Object.freeze({
        mediaRegistry: runtime.mediaRegistry,
        acceptConnection,
        deliverMedia: runtime.deliverMedia,
        closeMedia: runtime.closeMedia,
        stop: runtime.stop,
        getStats,
        sampleTelemetry
    });
}

export {
    createMediaNodeTelemetryRuntimeAdapter,
    getBinaryByteLength
};
