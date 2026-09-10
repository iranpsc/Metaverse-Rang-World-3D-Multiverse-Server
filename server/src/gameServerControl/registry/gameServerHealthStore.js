// File => src/gameServerControl/registry/gameServerHealthStore.js

const GAME_SERVER_HEALTH_STATUS = Object.freeze({
    UNKNOWN: "unknown",
    HEALTHY: "healthy",
    WARNING: "warning",
    TIMEOUT: "timeout",
    OFFLINE: "offline",
    UNHEALTHY: "unhealthy"
});

const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 15;
const DEFAULT_WARNING_RATIO = 0.6;
const DEFAULT_MAX_HISTORY = 10;
const DEFAULT_MAX_STALE_AGE_SECONDS = 300;

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مقدار عدد صحیح را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار عدد اعشاری را در بازه امن نگه می دارد.
function clampNumber(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار رشته ای را تمیز می کند و اگر خالی بود مقدار پیش فرض می دهد.
function cleanString(value, fallbackValue) {
    if (!isNonEmptyString(value)) return fallbackValue;
    return value.trim();
}

//* این تابع وضعیت سلامت را بر اساس آخرین هارت بیت محاسبه می کند.
function resolveHealthStatus(record, heartbeatTimeoutMs, warningRatio) {
    if (!record) return GAME_SERVER_HEALTH_STATUS.UNKNOWN;
    if (record.status === GAME_SERVER_HEALTH_STATUS.OFFLINE) return GAME_SERVER_HEALTH_STATUS.OFFLINE;
    if (record.status === GAME_SERVER_HEALTH_STATUS.UNHEALTHY) return GAME_SERVER_HEALTH_STATUS.UNHEALTHY;

    const elapsedMs = nowMs() - record.lastHeartbeatAt;

    if (elapsedMs >= heartbeatTimeoutMs) return GAME_SERVER_HEALTH_STATUS.TIMEOUT;
    if (elapsedMs >= heartbeatTimeoutMs * warningRatio) return GAME_SERVER_HEALTH_STATUS.WARNING;

    return GAME_SERVER_HEALTH_STATUS.HEALTHY;
}

//* این تابع داده هارت بیت را به مدل متریک داخلی تبدیل می کند.
function createHeartbeatMetrics(heartbeat = {}) {
    return {
        fps: clampNumber(heartbeat.fps, 0, 0, 1000),
        tickRate: clampInteger(heartbeat.tickRate, 0, 0, 240),
        currentPlayers: clampInteger(heartbeat.currentPlayers, 0, 0, 100000),
        maxPlayers: clampInteger(heartbeat.maxPlayers, 0, 0, 100000),
        memoryMb: clampNumber(heartbeat.memoryMb, 0, 0, 1048576),
        cpuPercent: clampNumber(heartbeat.cpuPercent, 0, 0, 100),
        pingMs: clampNumber(heartbeat.pingMs, 0, 0, 600000),
        uptimeSeconds: clampNumber(heartbeat.uptimeSeconds, 0, 0, Number.MAX_SAFE_INTEGER)
    };
}

//* این تابع رکورد سلامت اولیه برای یک سرور می سازد.
function createHealthRecord(serverId, heartbeat = {}) {
    const receivedAt = nowMs();
    const metrics = createHeartbeatMetrics(heartbeat);

    return {
        serverId: serverId.trim(),
        status: GAME_SERVER_HEALTH_STATUS.HEALTHY,
        firstHeartbeatAt: receivedAt,
        lastHeartbeatAt: receivedAt,
        lastStatusChangeAt: receivedAt,
        heartbeatCount: 1,
        missedHeartbeatCount: 0,
        metrics,
        lastHeartbeat: {
            receivedAt,
            roomId: cleanString(heartbeat.roomId, ""),
            region: cleanString(heartbeat.region, ""),
            zone: cleanString(heartbeat.zone, ""),
            status: cleanString(heartbeat.status, ""),
            metadata: heartbeat.metadata ?? {}
        },
        history: [
            {
                receivedAt,
                metrics,
                status: cleanString(heartbeat.status, "")
            }
        ]
    };
}

//* این کلاس وضعیت سلامت و هارت بیت ددیکیتد سرورها را نگه می دارد.
class GameServerHealthStore {
    constructor(options = {}) {
        this.healthByServerId = new Map();

        this.heartbeatTimeoutMs = clampInteger(
            options.heartbeatTimeoutSeconds,
            DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
            3,
            300
        ) * 1000;

        this.warningRatio = clampNumber(
            options.warningRatio,
            DEFAULT_WARNING_RATIO,
            0.1,
            0.95
        );

        this.maxHistory = clampInteger(
            options.maxHistory,
            DEFAULT_MAX_HISTORY,
            1,
            100
        );

        this.maxStaleAgeMs = clampInteger(
            options.maxStaleAgeSeconds,
            DEFAULT_MAX_STALE_AGE_SECONDS,
            30,
            86400
        ) * 1000;
    }

    //* این تابع هارت بیت جدید یک ددیکیتد سرور را ثبت می کند.
    recordHeartbeat(serverId, heartbeat = {}) {
        this.validateServerId(serverId);

        const cleanServerId = serverId.trim();
        const existingRecord = this.healthByServerId.get(cleanServerId);

        if (!existingRecord) {
            const record = createHealthRecord(cleanServerId, heartbeat);
            this.healthByServerId.set(cleanServerId, record);
            return this.getHealth(cleanServerId);
        }

        const previousStatus = existingRecord.status;
        const receivedAt = nowMs();
        const metrics = createHeartbeatMetrics(heartbeat);
        const nextStatus = this.resolveIncomingStatus(heartbeat.status);

        existingRecord.status = nextStatus;
        existingRecord.lastHeartbeatAt = receivedAt;
        existingRecord.heartbeatCount++;
        existingRecord.metrics = metrics;
        existingRecord.lastHeartbeat = {
            receivedAt,
            roomId: cleanString(heartbeat.roomId, existingRecord.lastHeartbeat.roomId),
            region: cleanString(heartbeat.region, existingRecord.lastHeartbeat.region),
            zone: cleanString(heartbeat.zone, existingRecord.lastHeartbeat.zone),
            status: cleanString(heartbeat.status, ""),
            metadata: heartbeat.metadata ?? {}
        };

        if (previousStatus !== existingRecord.status) existingRecord.lastStatusChangeAt = receivedAt;

        existingRecord.history.push({
            receivedAt,
            metrics,
            status: cleanString(heartbeat.status, "")
        });

        while (existingRecord.history.length > this.maxHistory) existingRecord.history.shift();

        this.healthByServerId.set(cleanServerId, existingRecord);

        return this.getHealth(cleanServerId);
    }

    //* این تابع وضعیت سلامت یک سرور را برمی گرداند.
    getHealth(serverId) {
        if (!isNonEmptyString(serverId)) return null;

        const record = this.healthByServerId.get(serverId);
        if (!record) return null;

        return this.toPublicHealthRecord(record);
    }

    //* این تابع بررسی می کند برای سرور وضعیت سلامت ثبت شده یا نه.
    hasHealth(serverId) {
        if (!isNonEmptyString(serverId)) return false;
        return this.healthByServerId.has(serverId);
    }

    //* این تابع بررسی می کند سرور طبق آخرین هارت بیت سالم است یا نه.
    isHealthy(serverId) {
        const record = this.healthByServerId.get(serverId);
        if (!record) return false;

        const status = resolveHealthStatus(record, this.heartbeatTimeoutMs, this.warningRatio);
        return status === GAME_SERVER_HEALTH_STATUS.HEALTHY;
    }

    //* این تابع بررسی می کند سرور تایم اوت شده یا نه.
    isTimedOut(serverId) {
        const record = this.healthByServerId.get(serverId);
        if (!record) return false;

        const status = resolveHealthStatus(record, this.heartbeatTimeoutMs, this.warningRatio);
        return status === GAME_SERVER_HEALTH_STATUS.TIMEOUT;
    }

    //* این تابع سرور را آفلاین علامت گذاری می کند.
    markOffline(serverId) {
        return this.markStatus(serverId, GAME_SERVER_HEALTH_STATUS.OFFLINE);
    }

    //* این تابع سرور را ناسالم علامت گذاری می کند.
    markUnhealthy(serverId) {
        return this.markStatus(serverId, GAME_SERVER_HEALTH_STATUS.UNHEALTHY);
    }

    //* این تابع وضعیت سلامت سرور را دستی تغییر می دهد.
    markStatus(serverId, status) {
        if (!isNonEmptyString(serverId)) return null;

        const record = this.healthByServerId.get(serverId);
        if (!record) return null;

        const nextStatus = this.resolveIncomingStatus(status);
        record.status = nextStatus;
        record.lastStatusChangeAt = nowMs();
        this.healthByServerId.set(serverId, record);

        return this.getHealth(serverId);
    }

    //* این تابع رکورد سلامت یک سرور را حذف می کند.
    removeHealth(serverId) {
        if (!isNonEmptyString(serverId)) return false;
        return this.healthByServerId.delete(serverId);
    }

    //* این تابع لیست سلامت همه سرورها را با فیلتر اختیاری برمی گرداند.
    listHealth(filters = {}) {
        const result = [];

        for (const record of this.healthByServerId.values()) {
            const publicRecord = this.toPublicHealthRecord(record);
            if (!this.matchesFilters(publicRecord, filters)) continue;
            result.push(publicRecord);
        }

        return result;
    }

    //* این تابع سرورهای تایم اوت شده را برمی گرداند و شمارنده خطا را زیاد می کند.
    listTimedOutServers() {
        const timedOutServers = [];

        for (const record of this.healthByServerId.values()) {
            const status = resolveHealthStatus(record, this.heartbeatTimeoutMs, this.warningRatio);

            if (status !== GAME_SERVER_HEALTH_STATUS.TIMEOUT) continue;

            record.status = GAME_SERVER_HEALTH_STATUS.TIMEOUT;
            record.missedHeartbeatCount++;
            record.lastStatusChangeAt = nowMs();
            this.healthByServerId.set(record.serverId, record);

            timedOutServers.push(this.toPublicHealthRecord(record));
        }

        return timedOutServers;
    }

    //* این تابع رکوردهای خیلی قدیمی را پاکسازی می کند.
    cleanupStaleHealthRecords() {
        let removedCount = 0;
        const currentTime = nowMs();

        for (const [serverId, record] of this.healthByServerId.entries()) {
            if (currentTime - record.lastHeartbeatAt < this.maxStaleAgeMs) continue;

            this.healthByServerId.delete(serverId);
            removedCount++;
        }

        return removedCount;
    }

    //* این تابع کل وضعیت سلامت را پاک می کند و فقط برای تست یا شات داون استفاده می شود.
    clear() {
        const count = this.healthByServerId.size;
        this.healthByServerId.clear();
        return count;
    }

    //* این تابع آمار کلی سلامت سرورها را می سازد.
    getStats() {
        const stats = {
            total: this.healthByServerId.size,
            healthy: 0,
            warning: 0,
            timeout: 0,
            offline: 0,
            unhealthy: 0,
            unknown: 0,
            totalHeartbeats: 0,
            totalMissedHeartbeats: 0
        };

        for (const record of this.healthByServerId.values()) {
            const status = resolveHealthStatus(record, this.heartbeatTimeoutMs, this.warningRatio);

            if (stats[status] !== undefined) stats[status]++;
            else stats.unknown++;

            stats.totalHeartbeats += record.heartbeatCount;
            stats.totalMissedHeartbeats += record.missedHeartbeatCount;
        }

        return stats;
    }

    //* این تابع وضعیت ورودی از هارت بیت را به وضعیت سلامت داخلی تبدیل می کند.
    resolveIncomingStatus(status) {
        const cleanStatus = cleanString(status, GAME_SERVER_HEALTH_STATUS.HEALTHY);

        if (cleanStatus === GAME_SERVER_HEALTH_STATUS.OFFLINE) return GAME_SERVER_HEALTH_STATUS.OFFLINE;
        if (cleanStatus === GAME_SERVER_HEALTH_STATUS.UNHEALTHY) return GAME_SERVER_HEALTH_STATUS.UNHEALTHY;
        if (cleanStatus === GAME_SERVER_HEALTH_STATUS.WARNING) return GAME_SERVER_HEALTH_STATUS.WARNING;
        if (cleanStatus === GAME_SERVER_HEALTH_STATUS.TIMEOUT) return GAME_SERVER_HEALTH_STATUS.TIMEOUT;

        return GAME_SERVER_HEALTH_STATUS.HEALTHY;
    }

    //* این تابع رکورد داخلی سلامت را به مدل قابل خروجی تبدیل می کند.
    toPublicHealthRecord(record) {
        if (!record) return null;

        const computedStatus = resolveHealthStatus(record, this.heartbeatTimeoutMs, this.warningRatio);
        const elapsedMs = nowMs() - record.lastHeartbeatAt;

        return {
            serverId: record.serverId,
            status: computedStatus,
            storedStatus: record.status,
            firstHeartbeatAt: record.firstHeartbeatAt,
            lastHeartbeatAt: record.lastHeartbeatAt,
            lastStatusChangeAt: record.lastStatusChangeAt,
            elapsedMsSinceLastHeartbeat: elapsedMs,
            heartbeatTimeoutMs: this.heartbeatTimeoutMs,
            heartbeatCount: record.heartbeatCount,
            missedHeartbeatCount: record.missedHeartbeatCount,
            metrics: { ...record.metrics },
            lastHeartbeat: { ...record.lastHeartbeat },
            history: record.history.map((item) => ({ ...item }))
        };
    }

    //* این تابع بررسی می کند رکورد سلامت با فیلترها همخوان است یا نه.
    matchesFilters(record, filters = {}) {
        if (!record) return false;

        if (isNonEmptyString(filters.serverId) && record.serverId !== filters.serverId.trim()) return false;
        if (isNonEmptyString(filters.status) && record.status !== filters.status.trim()) return false;
        if (isNonEmptyString(filters.roomId) && record.lastHeartbeat.roomId !== filters.roomId.trim()) return false;
        if (isNonEmptyString(filters.region) && record.lastHeartbeat.region !== filters.region.trim()) return false;
        if (isNonEmptyString(filters.zone) && record.lastHeartbeat.zone !== filters.zone.trim()) return false;

        return true;
    }

    //* این تابع شناسه سرور را اعتبارسنجی می کند.
    validateServerId(serverId) {
        if (!isNonEmptyString(serverId)) {
            throw new Error("[GameServerHealthStore] serverId is required.");
        }
    }
}

//* این تابع یک نمونه جدید از استور سلامت گیم سرور می سازد.
function createGameServerHealthStore(options = {}) {
    return new GameServerHealthStore(options);
}

export {
    GAME_SERVER_HEALTH_STATUS,
    GameServerHealthStore,
    createGameServerHealthStore
};

// این فایل فقط سلامت و هارت بیت ددیکیتد سرورها را نگه می دارد و هنوز هیچ اتصال بیرونی یا تغییر در سرور اصلی ایجاد نمی کند.
