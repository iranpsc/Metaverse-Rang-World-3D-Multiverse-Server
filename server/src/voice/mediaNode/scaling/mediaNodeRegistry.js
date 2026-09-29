const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;

//* این تابع متن شناسه نود را پاکسازی و اعتبارسنجی می کند.
function normalizeNodeId(value) {
    const text = String(value ?? "").trim();
    if (!text || text.length > 128) throw new TypeError("nodeId is invalid.");
    return text;
}

//* این تابع متن ناحیه را پاکسازی و اعتبارسنجی می کند.
function normalizeRegion(value) {
    const text = String(value ?? "").trim();
    if (!text || text.length > 64) throw new TypeError("region is invalid.");
    return text;
}

//* این تابع متن محدوده را پاکسازی می کند و خالی بودن آن را مجاز می داند.
function normalizeZone(value) {
    const text = String(value ?? "").trim();
    if (text.length > 64) throw new TypeError("zone is invalid.");
    return text;
}

//* این تابع شمارنده غیرمنفی را اعتبارسنجی می کند.
function normalizeCount(value, name) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} is invalid.`);
    return number;
}

//* این تابع درصد پردازنده را در بازه مجاز اعتبارسنجی می کند.
function normalizePercent(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new RangeError(`${name} is invalid.`);
    return number;
}

//* این تابع نرخ خروجی غیرمنفی را اعتبارسنجی می کند.
function normalizeRate(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} is invalid.`);
    return number;
}

//* این تابع رتبه مکانی نود را برای ناحیه و محدوده درخواستی می سازد.
function calculateLocalityRank(record, region, zone) {
    if (region && zone && record.region === region && record.zone === zone) return 0;
    if (region && record.region === region) return 1;
    return 2;
}

//* این کلاس فهرست نودهای رسانه و سلامت و بار گزارش شده آنها را نگه می دارد.
export class Phase11MediaNodeRegistry {
    //* این سازنده زمان سنج و مهلت سلامت نودها را دریافت می کند.
    constructor({ now = Date.now, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS } = {}) {
        if (typeof now !== "function") throw new TypeError("now is invalid.");
        if (!Number.isSafeInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs < 1000) throw new RangeError("heartbeatTimeoutMs is invalid.");
        this.now = now;
        this.heartbeatTimeoutMs = heartbeatTimeoutMs;
        this.nodesById = new Map();
    }

    //* این تابع یک نود رسانه را بدون تعریف ظرفیت بازیکن ثبت یا به روز می کند.
    registerNode({ nodeId, region, zone = "", peer = null } = {}) {
        const normalizedNodeId = normalizeNodeId(nodeId);
        const registeredAtMs = this.now();
        const previous = this.nodesById.get(normalizedNodeId) ?? null;
        const record = {
            nodeId: normalizedNodeId,
            region: normalizeRegion(region),
            zone: normalizeZone(zone),
            peer,
            registeredAtMs: previous?.registeredAtMs ?? registeredAtMs,
            lastHeartbeatMs: registeredAtMs,
            activeConnections: previous?.activeConnections ?? 0,
            cpuPercent: previous?.cpuPercent ?? 0,
            outboundKbps: previous?.outboundKbps ?? 0
        };
        this.nodesById.set(normalizedNodeId, record);
        return this.snapshotNode(record);
    }

    //* این تابع آخرین سلامت و بار واقعی گزارش شده نود رسانه را ثبت می کند.
    heartbeat(nodeId, { activeConnections = 0, cpuPercent = 0, outboundKbps = 0 } = {}) {
        const record = this.nodesById.get(normalizeNodeId(nodeId));
        if (!record) return null;
        record.activeConnections = normalizeCount(activeConnections, "activeConnections");
        record.cpuPercent = normalizePercent(cpuPercent, "cpuPercent");
        record.outboundKbps = normalizeRate(outboundKbps, "outboundKbps");
        record.lastHeartbeatMs = this.now();
        return this.snapshotNode(record);
    }

    //* این تابع نود مشخص را از فهرست نودهای رسانه حذف می کند.
    unregisterNode(nodeId) {
        return this.nodesById.delete(normalizeNodeId(nodeId));
    }

    //* این تابع رکورد داخلی نود را برای هماهنگ کننده برمی گرداند.
    getNodeRecord(nodeId) {
        return this.nodesById.get(normalizeNodeId(nodeId)) ?? null;
    }

    //* این تابع تازگی ضربان نود را برای آماده بودن آن بررسی می کند.
    isNodeReady(nodeId) {
        const record = this.getNodeRecord(nodeId);
        return Boolean(record && this.now() - record.lastHeartbeatMs < this.heartbeatTimeoutMs);
    }

    //* این تابع نودهای سالم را با رتبه نزدیکی برمی گرداند و عبور ناخواسته بین ناحیه ها را انجام نمی دهد.
    listReadyNodes({ region = "", zone = "", allowCrossRegionFallback = false } = {}) {
        const normalizedRegion = String(region ?? "").trim();
        const normalizedZone = String(zone ?? "").trim();
        const candidates = [];
        for (const record of this.nodesById.values()) {
            if (!this.isNodeReady(record.nodeId)) continue;
            const localityRank = calculateLocalityRank(record, normalizedRegion, normalizedZone);
            if (normalizedRegion && localityRank === 2 && allowCrossRegionFallback !== true) continue;
            candidates.push(Object.freeze({ node: this.snapshotNode(record), localityRank }));
        }
        candidates.sort((first, second) => first.localityRank - second.localityRank || first.node.nodeId.localeCompare(second.node.nodeId));
        return Object.freeze(candidates);
    }

    //* این تابع یک نمای خواندنی از وضعیت نود رسانه می سازد.
    snapshotNode(record) {
        return Object.freeze({
            nodeId: record.nodeId,
            region: record.region,
            zone: record.zone,
            activeConnections: record.activeConnections,
            cpuPercent: record.cpuPercent,
            outboundKbps: record.outboundKbps,
            registeredAtMs: record.registeredAtMs,
            lastHeartbeatMs: record.lastHeartbeatMs,
            ready: this.now() - record.lastHeartbeatMs < this.heartbeatTimeoutMs
        });
    }

    //* این تابع نمای کلی سلامت و بار نودهای رسانه را برای پایش برمی گرداند.
    getStats() {
        const nodes = Array.from(this.nodesById.values(), (record) => this.snapshotNode(record));
        nodes.sort((first, second) => first.nodeId.localeCompare(second.nodeId));
        return Object.freeze({
            heartbeatTimeoutMs: this.heartbeatTimeoutMs,
            totalNodes: nodes.length,
            readyNodes: nodes.filter((node) => node.ready).length,
            nodes: Object.freeze(nodes)
        });
    }
}
