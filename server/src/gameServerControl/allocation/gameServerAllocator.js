// File => src/gameServerControl/allocation/gameServerAllocator.js

import { GAME_SERVER_STATUS } from "../registry/gameServerRegistry.js";
import { GAME_SERVER_HEALTH_STATUS } from "../registry/gameServerHealthStore.js";

const DEFAULT_MIN_FREE_SLOTS = 1;
const DEFAULT_REGION_WEIGHT = 30;
const DEFAULT_ZONE_WEIGHT = 20;
const DEFAULT_ROOM_WEIGHT = 50;
const DEFAULT_CAPACITY_WEIGHT = 10;
const DEFAULT_HEALTH_WEIGHT = 100;

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

//* این تابع رشته را تمیز می کند و اگر خالی بود نال برمی گرداند.
function cleanOptionalString(value) {
    if (!isNonEmptyString(value)) return null;
    return value.trim();
}

//* این تابع ساختار روم های رزرو شده سرور را امن می خواند.
function getAssignedRooms(server = {}) {
    return server.assignedRooms && typeof server.assignedRooms === "object"
        ? server.assignedRooms
        : {};
}

//* این تابع روم رزرو شده روی سرور را بر اساس شناسه روم پیدا می کند.
function getAssignedRoom(server = {}, roomId = null) {
    if (!roomId) return null;
    return getAssignedRooms(server)[roomId] ?? null;
}

//* این تابع تعداد ظرفیت رزرو شده سرور را حساب می کند.
function getReservedPlayers(server = {}) {
    if (Number.isFinite(server.reservedPlayers)) return server.reservedPlayers;

    let reservedPlayers = 0;

    for (const room of Object.values(getAssignedRooms(server))) {
        reservedPlayers += clampInteger(room?.roomMaxPlayers, 0, 0, 1024);
    }

    return reservedPlayers;
}

//* این تابع ظرفیت آزاد رزرو سرور را حساب می کند.
function getAvailableReservedSlots(server = {}) {
    if (Number.isFinite(server.availableReservedSlots)) return Math.max(0, server.availableReservedSlots);
    return Math.max(0, (server.maxPlayers ?? 0) - getReservedPlayers(server));
}

//* این تابع ظرفیت قابل استفاده برای درخواست همان روم را حساب می کند.
function getAvailableReservedSlotsForRequest(server = {}, request = {}) {
    const assignedRoom = getAssignedRoom(server, request.roomId);
    const alreadyReservedForRoom = assignedRoom
        ? clampInteger(assignedRoom.roomMaxPlayers, 0, 0, 1024)
        : 0;

    return Math.max(0, getAvailableReservedSlots(server) + alreadyReservedForRoom);
}

//* این تابع ظرفیت مورد نیاز برای رزرو روم را از درخواست تخصیص می خواند.
function getRequiredReservedSlots(request = {}) {
    return Math.max(
        clampInteger(request.minFreeSlots, DEFAULT_MIN_FREE_SLOTS, 1, 1024),
        clampInteger(request.roomMaxPlayers, request.minFreeSlots ?? DEFAULT_MIN_FREE_SLOTS, 1, 1024)
    );
}

//* این تابع درخواست تخصیص سرور را به مدل داخلی تبدیل می کند.
function normalizeAllocationRequest(request = {}) {
    return {
        userId: cleanOptionalString(request.userId),
        roomId: cleanOptionalString(request.roomId),
        preferredServerId: cleanOptionalString(request.preferredServerId),
        region: cleanOptionalString(request.region),
        zone: cleanOptionalString(request.zone),
        minFreeSlots: clampInteger(request.minFreeSlots, DEFAULT_MIN_FREE_SLOTS, 1, 1024),
        roomMaxPlayers: clampInteger(request.roomMaxPlayers, request.minFreeSlots ?? DEFAULT_MIN_FREE_SLOTS, 1, 1024),
        requireHealthy: request.requireHealthy !== false,
        allowStarting: request.allowStarting === true,
        allowBusy: request.allowBusy !== false,
        allowWarm: request.allowWarm === true,
        allowReserved: request.allowReserved === true,
        allowClaimed: request.allowClaimed === true,
        metadata: request.metadata ?? {}
    };
}

//* این تابع پاسخ موفق تخصیص سرور را می سازد.
function createAllocationSuccess(reason, server, score, health = null) {
    return {
        success: true,
        reason,
        server,
        score,
        health,
        connection: {
            serverId: server.serverId,
            host: server.host,
            port: server.port,
            roomId: server.roomId,
            region: server.region,
            zone: server.zone
        }
    };
}

//* این تابع پاسخ خطای تخصیص سرور را می سازد.
function createAllocationFailure(reason, message, details = {}) {
    return {
        success: false,
        reason,
        message,
        details,
        server: null,
        score: 0,
        health: null,
        connection: null
    };
}

//* این کلاس انتخاب ددیکیتد سرور مناسب را مدیریت می کند.
class GameServerAllocator {
    constructor(options = {}) {
        this.registry = options.registry ?? null;
        this.healthStore = options.healthStore ?? null;

        this.weights = {
            room: clampInteger(options.roomWeight, DEFAULT_ROOM_WEIGHT, 0, 1000),
            region: clampInteger(options.regionWeight, DEFAULT_REGION_WEIGHT, 0, 1000),
            zone: clampInteger(options.zoneWeight, DEFAULT_ZONE_WEIGHT, 0, 1000),
            capacity: clampInteger(options.capacityWeight, DEFAULT_CAPACITY_WEIGHT, 0, 1000),
            health: clampInteger(options.healthWeight, DEFAULT_HEALTH_WEIGHT, 0, 1000)
        };
    }

    //* این تابع وابستگی های لازم برای تخصیص را بعد از ساخت کلاس تنظیم می کند.
    configure(options = {}) {
        if (options.registry) this.registry = options.registry;
        if (options.healthStore) this.healthStore = options.healthStore;
        return this;
    }

    //* این تابع بهترین ددیکیتد سرور را برای درخواست کلاینت انتخاب می کند.
    allocateServer(request = {}) {
        const normalizedRequest = normalizeAllocationRequest(request);

        if (!this.registry) {
            return createAllocationFailure("registry_missing", "Game server registry is not configured.");
        }

        if (normalizedRequest.preferredServerId) {
            const preferredResult = this.allocatePreferredServer(normalizedRequest);
            if (preferredResult.success) return preferredResult;
        }

        const candidates = this.findCandidates(normalizedRequest);

        if (candidates.length === 0) {
            return createAllocationFailure("no_available_server", "No available dedicated server found.", {
                roomId: normalizedRequest.roomId,
                region: normalizedRequest.region,
                zone: normalizedRequest.zone,
                minFreeSlots: normalizedRequest.minFreeSlots,
                roomMaxPlayers: normalizedRequest.roomMaxPlayers
            });
        }

        const scoredCandidates = candidates
            .map((server) => this.scoreServer(server, normalizedRequest))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (a.capacityWasteAfterAllocation !== b.capacityWasteAfterAllocation) {
                    return a.capacityWasteAfterAllocation - b.capacityWasteAfterAllocation;
                }
                if (b.reservedPlayers !== a.reservedPlayers) return b.reservedPlayers - a.reservedPlayers;
                return String(a.server.serverId ?? "").localeCompare(String(b.server.serverId ?? ""));
            });

        const bestCandidate = scoredCandidates[0];

        return createAllocationSuccess(
            "server_allocated",
            bestCandidate.server,
            bestCandidate.score,
            bestCandidate.health
        );
    }

    //* این تابع سرور مشخص شده توسط درخواست را بررسی و تخصیص می دهد.
    allocatePreferredServer(request) {
        const server = this.registry.getServer(request.preferredServerId);

        if (!server) {
            return createAllocationFailure("preferred_server_not_found", "Preferred server was not found.", {
                preferredServerId: request.preferredServerId
            });
        }

        const validation = this.validateServerCandidate(server, request);
        if (!validation.success) return validation;

        const scored = this.scoreServer(server, request);

        return createAllocationSuccess(
            "preferred_server_allocated",
            scored.server,
            scored.score,
            scored.health
        );
    }

    //* این تابع لیست همه سرورهای قابل استفاده را از ابتدا بررسی می کند.
    findCandidates(request) {
        let servers = this.registry.listServers();

        servers = servers.filter((server) => this.validateServerCandidate(server, request).success);

        if (request.region) {
            const regionServers = servers.filter((server) => server.region === request.region);
            if (regionServers.length > 0) return regionServers;
        }

        return servers;
    }

    //* این تابع بررسی می کند یک سرور برای تخصیص قابل استفاده است یا نه.
    validateServerCandidate(server, request) {
        if (!server) {
            return createAllocationFailure("server_missing", "Server record is missing.");
        }

        if (!this.isAllowedServerStatus(server.status, request)) {
            return createAllocationFailure("server_status_not_allowed", "Server status is not allowed for allocation.", {
                serverId: server.serverId,
                status: server.status
            });
        }

        const freeSlots = getAvailableReservedSlotsForRequest(server, request);
        const requiredSlots = getRequiredReservedSlots(request);

        if (freeSlots < requiredSlots) {
            return createAllocationFailure("server_reserved_capacity_not_enough", "Server does not have enough reserved capacity for this room.", {
                serverId: server.serverId,
                freeSlots,
                requiredSlots,
                minFreeSlots: request.minFreeSlots,
                roomMaxPlayers: request.roomMaxPlayers,
                reservedPlayers: getReservedPlayers(server),
                maxPlayers: server.maxPlayers
            });
        }

        if (
            request.roomId &&
            server.roomId &&
            server.roomId !== request.roomId &&
            (server.status === GAME_SERVER_STATUS.RESERVED || server.status === GAME_SERVER_STATUS.CLAIMED)
        ) {
            return createAllocationFailure("server_room_mismatch", "Reserved server roomId does not match allocation roomId.", {
                serverId: server.serverId,
                serverRoomId: server.roomId,
                requestedRoomId: request.roomId
            });
        }

        if (request.region && server.region && server.region !== request.region) {
            return createAllocationFailure("server_region_mismatch", "Server region does not match allocation region.", {
                serverId: server.serverId,
                serverRegion: server.region,
                requestedRegion: request.region
            });
        }

        if (request.zone && server.zone && server.zone !== request.zone) {
            return createAllocationFailure("server_zone_mismatch", "Server zone does not match allocation zone.", {
                serverId: server.serverId,
                serverZone: server.zone,
                requestedZone: request.zone
            });
        }

        if (request.requireHealthy && !this.isServerHealthy(server.serverId)) {
            return createAllocationFailure("server_not_healthy", "Server health is not valid for allocation.", {
                serverId: server.serverId,
                health: this.getServerHealth(server.serverId)
            });
        }

        return { success: true };
    }

    //* این تابع به سرور امتیاز می دهد تا بهترین گزینه انتخاب شود.
    scoreServer(server, request) {
        const health = this.getServerHealth(server.serverId);
        const freeSlots = getAvailableReservedSlotsForRequest(server, request);
        const requiredSlots = getRequiredReservedSlots(request);
        const reservedPlayers = getReservedPlayers(server);
        const capacityWasteAfterAllocation = Math.max(0, freeSlots - requiredSlots);
        const capacityFitRatio = server.maxPlayers > 0
            ? 1 - Math.min(1, capacityWasteAfterAllocation / server.maxPlayers)
            : 0;

        let score = 0;

        if (request.region && server.region === request.region) score += this.weights.region;
        if (request.zone && server.zone === request.zone) score += this.weights.zone;

        score += Math.round(capacityFitRatio * this.weights.capacity);

        if (!health || health.status === GAME_SERVER_HEALTH_STATUS.HEALTHY) {
            score += this.weights.health;
        }

        if (health && health.status === GAME_SERVER_HEALTH_STATUS.WARNING) {
            score += Math.round(this.weights.health * 0.5);
        }

        return {
            server,
            score,
            health,
            freeSlots,
            requiredSlots,
            reservedPlayers,
            capacityWasteAfterAllocation
        };
    }

    //* این تابع بررسی می کند وضعیت رجیستری سرور برای تخصیص مجاز است یا نه.
    isAllowedServerStatus(status, request) {
        if (status === GAME_SERVER_STATUS.ONLINE) return true;
        if (status === GAME_SERVER_STATUS.BUSY && request.allowBusy) return true;
        if (status === GAME_SERVER_STATUS.STARTING && request.allowStarting) return true;
        if (status === GAME_SERVER_STATUS.WARM && request.allowWarm) return true;
        if (status === GAME_SERVER_STATUS.RESERVED && request.allowReserved) return true;
        if (status === GAME_SERVER_STATUS.CLAIMED && request.allowClaimed) return true;

        return false;
    }

    //* این تابع سلامت سرور را از هلت استور می خواند.
    getServerHealth(serverId) {
        if (!this.healthStore || !isNonEmptyString(serverId)) return null;
        return this.healthStore.getHealth(serverId);
    }

    //* این تابع بررسی می کند سرور از نظر هلت استور سالم است یا نه.
    isServerHealthy(serverId) {
        if (!this.healthStore) return true;

        const health = this.healthStore.getHealth(serverId);
        if (!health) return false;

        return health.status === GAME_SERVER_HEALTH_STATUS.HEALTHY ||
               health.status === GAME_SERVER_HEALTH_STATUS.WARNING;
    }

    //* این تابع آمار سبک Allocator را برمی گرداند.
    getStats() {
        const registryStats = this.registry ? this.registry.getStats() : null;
        const healthStats = this.healthStore ? this.healthStore.getStats() : null;

        return {
            hasRegistry: !!this.registry,
            hasHealthStore: !!this.healthStore,
            weights: { ...this.weights },
            registry: registryStats,
            health: healthStats
        };
    }
}

//* این تابع یک نمونه جدید از Allocator گیم سرور می سازد.
function createGameServerAllocator(options = {}) {
    return new GameServerAllocator(options);
}

export {
    GameServerAllocator,
    createGameServerAllocator
};

// این فایل فقط انتخاب سرور مناسب را انجام می دهد و هنوز هیچ تیکت، مسیر بیرونی یا اتصال به سرور اصلی ایجاد نمی کند.
