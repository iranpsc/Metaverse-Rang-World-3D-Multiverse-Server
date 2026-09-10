// File => src/gameServerControl/registry/gameServerRegistry.js

const GAME_SERVER_STATUS = Object.freeze({
    STARTING: "starting",
    ONLINE: "online",
    BUSY: "busy",
    FULL: "full",
    DRAINING: "draining",
    OFFLINE: "offline",
    UNHEALTHY: "unhealthy",
    WARM: "warm",
    RESERVED: "reserved",
    CLAIMED: "claimed"
});

const DEFAULT_REGION = "default";
const DEFAULT_ZONE = "default";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const DEFAULT_MAX_PLAYERS = 20;
const DEFAULT_TICK_RATE = 20;

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

//* این تابع مقدار رشته ای را تمیز می کند و اگر خالی بود مقدار پیش فرض می دهد.
function cleanString(value, fallbackValue) {
    if (!isNonEmptyString(value)) return fallbackValue;
    return value.trim();
}

//* این تابع هاست را تمیز می کند تا فقط مقدار قابل اتصال بماند.
function cleanHost(value, fallbackValue = DEFAULT_HOST) {
    const host = cleanString(value, fallbackValue);
    return host.replace(/^https?:\/\//i, "").replace(/^wss?:\/\//i, "").replace(/\/+$/g, "");
}

//* این تابع رکورد رزرو ظرفیت یک روم را استاندارد می کند.
function createRoomAssignmentRecord(request = {}, fallbackMaxPlayers = DEFAULT_MAX_PLAYERS) {
    const roomId = cleanString(request.roomId, "");
    const assignedAt = Number.isFinite(request.assignedAt) ? request.assignedAt : nowMs();

    return {
        roomId,
        roomName: cleanString(request.roomName ?? request.name, roomId),
        roomMaxPlayers: clampInteger(request.roomMaxPlayers ?? request.maxPlayers, fallbackMaxPlayers, 1, 1024),
        assignedAt,
        updatedAt: Number.isFinite(request.updatedAt) ? request.updatedAt : assignedAt,
        metadata: request.metadata ?? {}
    };
}

//* این تابع ساختار روم های رزرو شده روی یک گیم سرور را استاندارد می کند.
function normalizeAssignedRooms(value = {}, fallbackMaxPlayers = DEFAULT_MAX_PLAYERS) {
    const assignedRooms = {};
    const entries = Array.isArray(value)
        ? value.map((item) => [item?.roomId, item])
        : Object.entries(value ?? {});

    for (const [key, rawRoom] of entries) {
        const roomId = cleanString(rawRoom?.roomId ?? key, "");
        if (!roomId) continue;

        assignedRooms[roomId] = createRoomAssignmentRecord({
            ...(rawRoom ?? {}),
            roomId
        }, fallbackMaxPlayers);
    }

    return assignedRooms;
}

//* این تابع مجموع ظرفیت رزرو شده روم های یک سرور را حساب می کند.
function calculateReservedPlayers(assignedRooms = {}) {
    let reservedPlayers = 0;

    for (const room of Object.values(assignedRooms ?? {})) {
        reservedPlayers += clampInteger(room?.roomMaxPlayers, 0, 0, 1024);
    }

    return reservedPlayers;
}

//* این تابع فیلدهای ظرفیت رزرو شده سرور را دوباره محاسبه می کند.
function recomputeServerReservedCapacity(record) {
    if (!record) return record;

    record.assignedRooms = normalizeAssignedRooms(record.assignedRooms ?? {}, record.maxPlayers);
    record.reservedPlayers = calculateReservedPlayers(record.assignedRooms);
    record.availableReservedSlots = Math.max(0, record.maxPlayers - record.reservedPlayers);

    return record;
}

//* این تابع بررسی می کند سرور حداقل یک روم رزرو شده دارد یا نه.
function hasAssignedRooms(record) {
    return Object.keys(record?.assignedRooms ?? {}).length > 0;
}

//* این تابع رکورد سرور را برای خروجی امن کپی می کند.
function cloneServerRecord(record) {
    if (!record) return null;

    return {
        ...record,
        assignedRooms: normalizeAssignedRooms(record.assignedRooms ?? {}, record.maxPlayers),
        reservedPlayers: Number.isFinite(record.reservedPlayers) ? record.reservedPlayers : calculateReservedPlayers(record.assignedRooms ?? {}),
        availableReservedSlots: Number.isFinite(record.availableReservedSlots)
            ? record.availableReservedSlots
            : Math.max(0, record.maxPlayers - calculateReservedPlayers(record.assignedRooms ?? {}))
    };
}

//* این تابع ظرفیت قابل استفاده برای یک روم مشخص را روی سرور حساب می کند.
function getAvailableReservedSlotsForRoom(record, roomId = "") {
    if (!record) return 0;

    const assignedRoom = isNonEmptyString(roomId)
        ? record.assignedRooms?.[roomId.trim()]
        : null;

    const alreadyReservedForRoom = assignedRoom
        ? clampInteger(assignedRoom.roomMaxPlayers, 0, 0, 1024)
        : 0;

    return Math.max(0, (record.availableReservedSlots ?? 0) + alreadyReservedForRoom);
}


//* این تابع لیست روم های هارت بیت را برای ذخیره در رجیستری استاندارد می کند.
function normalizeHeartbeatRoomList(rooms = []) {
    if (!Array.isArray(rooms)) return [];

    const result = [];

    for (const room of rooms) {
        if (!room || typeof room !== "object") continue;

        const roomId = cleanString(room.roomId, "");
        if (!roomId) continue;

        result.push({
            roomId,
            roomName: cleanString(room.roomName, ""),
            currentPlayers: clampInteger(room.currentPlayers, 0, 0, 100000),
            isPrimary: room.isPrimary === true
        });
    }

    return result;
}

//* این تابع جمع پلیرهای لیست روم های هارت بیت را محاسبه می کند.
function calculateHeartbeatRoomPlayers(rooms = []) {
    if (!Array.isArray(rooms)) return 0;
    return rooms.reduce((sum, room) => sum + clampInteger(room.currentPlayers, 0, 0, 100000), 0);
}

//* این تابع لیست روم های ثبت شده روی رکورد سرور را برمی گرداند.
function getHeartbeatRoomsFromServerRecord(record = {}) {
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    return normalizeHeartbeatRoomList(record.rooms ?? metadata.rooms ?? []);
}


//* این تابع روم اصلی سرور را با لیست واقعی روم ها هماهنگ می کند.

//* این تابع نام نمایشی روم را از هارت بیت، رزرو روم، یا متادیتا پیدا می کند.
function resolveRoomDisplayDataFromRecord(record = {}, room = {}) {
    const roomId = cleanString(room.roomId, "");
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    const assignedRooms = record.assignedRooms && typeof record.assignedRooms === "object"
        ? record.assignedRooms
        : {};

    const assignedRoom = roomId && assignedRooms[roomId] && typeof assignedRooms[roomId] === "object"
        ? assignedRooms[roomId]
        : {};

    const metadataRooms = Array.isArray(metadata.rooms) ? metadata.rooms : [];
    const metadataRoom = metadataRooms.find((candidate) =>
        cleanString(candidate?.roomId, "") === roomId
    ) ?? {};

    const roomName =
        cleanString(room.roomName, "") ||
        cleanString(assignedRoom.roomName, "") ||
        cleanString(metadataRoom.roomName, "");

    const displayName =
        roomName ||
        cleanString(room.displayName, "") ||
        cleanString(assignedRoom.displayName, "") ||
        cleanString(metadataRoom.displayName, "") ||
        roomId;

    return {
        ...room,
        roomName,
        displayName
    };
}

//* این تابع لیست روم ها را با نام نمایشی قابل خواندن کامل می کند.
function enrichRoomListWithNamesFromRecord(record = {}, rooms = []) {
    return normalizeHeartbeatRoomList(rooms).map((room) =>
        resolveRoomDisplayDataFromRecord(record, room)
    );
}

function normalizePrimaryRoomList(record = {}, rooms = []) {
    const normalizedRooms = enrichRoomListWithNamesFromRecord(record, rooms);
    if (normalizedRooms.length <= 0) {
        return {
            primaryRoomId: cleanString(record.roomId, ""),
            rooms: []
        };
    }

    const currentPrimaryRoomId = cleanString(record.roomId, "");
    const currentPrimaryRoom = currentPrimaryRoomId
        ? normalizedRooms.find((room) => room.roomId === currentPrimaryRoomId)
        : null;

    const markedPrimaryRoom = normalizedRooms.find((room) => room.isPrimary === true) ?? null;
    const activeRoom = normalizedRooms.find((room) => room.currentPlayers > 0) ?? null;

    const selectedPrimaryRoom =
        currentPrimaryRoom ??
        markedPrimaryRoom ??
        activeRoom ??
        normalizedRooms[0];

    const primaryRoomId = selectedPrimaryRoom ? selectedPrimaryRoom.roomId : "";

    return {
        primaryRoomId,
        rooms: normalizedRooms.map((room) => ({
            ...room,
            isPrimary: room.roomId === primaryRoomId
        }))
    };
}

//* این تابع وضعیت سرور را از روی تعداد پلیر و وضعیت درخواست شده نهایی می کند.
function resolveServerStatus(status, currentPlayers, maxPlayers) {
    const cleanStatus = cleanString(status, GAME_SERVER_STATUS.ONLINE);

    if (cleanStatus === GAME_SERVER_STATUS.OFFLINE) return GAME_SERVER_STATUS.OFFLINE;
    if (cleanStatus === GAME_SERVER_STATUS.UNHEALTHY) return GAME_SERVER_STATUS.UNHEALTHY;
    if (cleanStatus === GAME_SERVER_STATUS.DRAINING) return GAME_SERVER_STATUS.DRAINING;

    if (cleanStatus === GAME_SERVER_STATUS.WARM && currentPlayers === 0) return GAME_SERVER_STATUS.WARM;
    if (cleanStatus === GAME_SERVER_STATUS.RESERVED) return GAME_SERVER_STATUS.RESERVED;
    if (cleanStatus === GAME_SERVER_STATUS.CLAIMED) return GAME_SERVER_STATUS.CLAIMED;

    if (currentPlayers >= maxPlayers) return GAME_SERVER_STATUS.FULL;
    if (cleanStatus === GAME_SERVER_STATUS.FULL) return GAME_SERVER_STATUS.FULL;
    if (cleanStatus === GAME_SERVER_STATUS.STARTING) return GAME_SERVER_STATUS.STARTING;
    if (cleanStatus === GAME_SERVER_STATUS.BUSY) return GAME_SERVER_STATUS.BUSY;

    return GAME_SERVER_STATUS.ONLINE;
}

//* این تابع رکورد داخلی ددیکیتد سرور را از درخواست ثبت می سازد.
function createGameServerRecord(request) {
    const maxPlayers = clampInteger(request.maxPlayers, DEFAULT_MAX_PLAYERS, 1, 1024);
    const currentPlayers = clampInteger(request.currentPlayers, 0, 0, maxPlayers);
    const registeredAt = nowMs();
    const assignedRooms = normalizeAssignedRooms(request.assignedRooms ?? request.metadata?.assignedRooms ?? {}, maxPlayers);
    const requestRoomId = cleanString(request.roomId, "");
    const rawInitialRoomMaxPlayers = request.roomMaxPlayers ?? request.metadata?.roomMaxPlayers;
    const initialRoomMaxPlayers = Number.parseInt(rawInitialRoomMaxPlayers, 10);
    const hasInitialRoomCapacity = Number.isInteger(initialRoomMaxPlayers) && initialRoomMaxPlayers > 0;

    if (requestRoomId && hasInitialRoomCapacity && Object.keys(assignedRooms).length === 0) {
        assignedRooms[requestRoomId] = createRoomAssignmentRecord({
            roomId: requestRoomId,
            roomName: request.roomName ?? request.metadata?.roomName ?? requestRoomId,
            roomMaxPlayers: initialRoomMaxPlayers,
            metadata: {
                source: "register_server_initial_room"
            }
        }, maxPlayers);
    }

    const reservedPlayers = calculateReservedPlayers(assignedRooms);

    return {
        serverId: request.serverId.trim(),
        host: cleanHost(request.host, DEFAULT_HOST),
        port: clampInteger(request.port, DEFAULT_PORT, 1, 65535),
        roomId: cleanString(request.roomId, ""),
        region: cleanString(request.region, DEFAULT_REGION),
        zone: cleanString(request.zone, DEFAULT_ZONE),
        maxPlayers,
        currentPlayers,
        assignedRooms,
        reservedPlayers,
        availableReservedSlots: Math.max(0, maxPlayers - reservedPlayers),
        status: resolveServerStatus(request.status, currentPlayers, maxPlayers),
        tickRate: clampInteger(request.tickRate, DEFAULT_TICK_RATE, 1, 240),
        buildVersion: cleanString(request.buildVersion, ""),
        startedAt: Number.isFinite(request.startedAt) ? request.startedAt : registeredAt,
        registeredAt,
        updatedAt: registeredAt,
        lastHeartbeatAt: Number.isFinite(request.lastHeartbeatAt) ? request.lastHeartbeatAt : registeredAt,
        metadata: request.metadata ?? {}
    };
}

//* این کلاس رجیستری سرورهای ددیکیتد را در حافظه مدیریت می کند.
class GameServerRegistry {
    constructor(options = {}) {
        this.serversById = new Map();
        this.defaultHost = cleanHost(options.defaultHost, DEFAULT_HOST);
        this.defaultPort = clampInteger(options.defaultPort, DEFAULT_PORT, 1, 65535);
        this.defaultRegion = cleanString(options.defaultRegion, DEFAULT_REGION);
        this.defaultZone = cleanString(options.defaultZone, DEFAULT_ZONE);
        this.defaultMaxPlayers = clampInteger(options.defaultMaxPlayers, DEFAULT_MAX_PLAYERS, 1, 1024);
    }

    //* این تابع ددیکیتد سرور جدید را ثبت می کند یا رکورد قبلی همان سرور را به روز می کند.
    registerServer(request) {
        this.validateRegisterServerRequest(request);

        const normalizedRequest = {
            ...request,
            host: request.host ?? this.defaultHost,
            port: request.port ?? this.defaultPort,
            region: request.region ?? this.defaultRegion,
            zone: request.zone ?? this.defaultZone,
            maxPlayers: request.maxPlayers ?? this.defaultMaxPlayers
        };

        const existingRecord = this.serversById.get(normalizedRequest.serverId);
        const nextRecord = createGameServerRecord(normalizedRequest);

        if (existingRecord) {
            nextRecord.registeredAt = existingRecord.registeredAt;
            nextRecord.startedAt = existingRecord.startedAt;
            nextRecord.assignedRooms = normalizeAssignedRooms({
                ...(existingRecord.assignedRooms ?? {}),
                ...(nextRecord.assignedRooms ?? {})
            }, nextRecord.maxPlayers);
        }

        recomputeServerReservedCapacity(nextRecord);
        this.serversById.set(nextRecord.serverId, nextRecord);

        return cloneServerRecord(nextRecord);
    }

    //* این تابع رکورد یک ددیکیتد سرور را بر اساس شناسه برمی گرداند.
    getServer(serverId) {
        if (!isNonEmptyString(serverId)) return null;

        const record = this.serversById.get(serverId);
        if (!record) return null;

        return cloneServerRecord(record);
    }

    //* این تابع بررسی می کند سرور در رجیستری وجود دارد یا نه.
    hasServer(serverId) {
        if (!isNonEmptyString(serverId)) return false;
        return this.serversById.has(serverId);
    }

    //* این تابع سرور را از رجیستری حذف می کند.
    unregisterServer(serverId) {
        if (!isNonEmptyString(serverId)) return false;
        return this.serversById.delete(serverId);
    }

    //* این تابع وضعیت سرور را تغییر می دهد.
    updateServerStatus(serverId, status) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        record.status = resolveServerStatus(status, record.currentPlayers, record.maxPlayers);
        record.updatedAt = nowMs();
        this.serversById.set(serverId, record);

        return cloneServerRecord(record);
    }

    //* این تابع تعداد پلیرهای سرور را به روز می کند.
    updatePlayerCount(serverId, currentPlayers) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        record.currentPlayers = clampInteger(currentPlayers, record.currentPlayers, 0, record.maxPlayers);
        record.status = resolveServerStatus(record.status, record.currentPlayers, record.maxPlayers);
        record.updatedAt = nowMs();
        this.serversById.set(serverId, record);

        return cloneServerRecord(record);
    }

    //* این تابع یک پلیر به شمارنده سرور اضافه می کند.
    incrementPlayerCount(serverId) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        return this.updatePlayerCount(serverId, record.currentPlayers + 1);
    }

    //* این تابع یک پلیر از شمارنده سرور کم می کند.
    decrementPlayerCount(serverId) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        return this.updatePlayerCount(serverId, record.currentPlayers - 1);
    }

    //* این تابع هارت بیت سرور را ثبت می کند و وضعیت سلامت را تازه می کند.
    updateHeartbeat(serverId, heartbeat = {}) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        const previousStatus = record.status;
        const previousRoomId = cleanString(record.roomId, "");
        const previousMetadata = record.metadata ?? {};

        if (isNonEmptyString(heartbeat.roomId)) {
            record.roomId = cleanString(heartbeat.roomId, record.roomId);
        }

        if (isNonEmptyString(heartbeat.region)) {
            record.region = cleanString(heartbeat.region, record.region);
        }

        if (isNonEmptyString(heartbeat.zone)) {
            record.zone = cleanString(heartbeat.zone, record.zone);
        }

        if (Number.isFinite(heartbeat.currentPlayers)) {
            record.currentPlayers = clampInteger(heartbeat.currentPlayers, record.currentPlayers, 0, record.maxPlayers);
        }

        if (Number.isFinite(heartbeat.maxPlayers)) {
            record.maxPlayers = clampInteger(heartbeat.maxPlayers, record.maxPlayers, 1, 1024);
            record.currentPlayers = clampInteger(record.currentPlayers, 0, 0, record.maxPlayers);
        }

        if (Number.isFinite(heartbeat.tickRate)) {
            record.tickRate = clampInteger(heartbeat.tickRate, record.tickRate, 1, 240);
        }

        const incomingStatus = isNonEmptyString(heartbeat.status)
            ? heartbeat.status.trim()
            : record.status;

        const currentRoomId = cleanString(record.roomId, previousRoomId);
        const incomingWantsWarm = incomingStatus === GAME_SERVER_STATUS.WARM;

        const shouldPreserveClaimStatus =
            (previousStatus === GAME_SERVER_STATUS.RESERVED || previousStatus === GAME_SERVER_STATUS.CLAIMED) &&
            isNonEmptyString(currentRoomId) &&
            record.currentPlayers === 0 &&
            incomingWantsWarm;

        if (shouldPreserveClaimStatus) {
            record.status = previousStatus;
        } else {
            record.status = resolveServerStatus(incomingStatus, record.currentPlayers, record.maxPlayers);
        }

        record.lastHeartbeatAt = nowMs();
        record.updatedAt = record.lastHeartbeatAt;
        const nextMetadata = { ...previousMetadata, ...(heartbeat.metadata ?? {}) };
        const heartbeatRoomsWereProvided =
            Array.isArray(heartbeat.rooms) ||
            Array.isArray(heartbeat.metadata?.rooms);

        if (heartbeatRoomsWereProvided) {
            const heartbeatRooms = normalizeHeartbeatRoomList(heartbeat.rooms ?? heartbeat.metadata?.rooms ?? []);
            const primaryNormalized = normalizePrimaryRoomList(record, heartbeatRooms);
            const totalRoomPlayers = calculateHeartbeatRoomPlayers(primaryNormalized.rooms);

            if (primaryNormalized.primaryRoomId) {
                record.roomId = primaryNormalized.primaryRoomId;
            }

            record.rooms = primaryNormalized.rooms;
            nextMetadata.rooms = primaryNormalized.rooms;
            nextMetadata.activeRoomCount = primaryNormalized.rooms.length;
            nextMetadata.totalRoomPlayers = totalRoomPlayers;
        }

        record.metadata = nextMetadata;
        recomputeServerReservedCapacity(record);

        this.serversById.set(serverId, record);

        return cloneServerRecord(record);
    }

    //* این تابع سرور را آفلاین علامت گذاری می کند ولی رکورد را حذف نمی کند.
    markServerOffline(serverId) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        record.status = GAME_SERVER_STATUS.OFFLINE;
        record.updatedAt = nowMs();
        this.serversById.set(serverId, record);

        return cloneServerRecord(record);
    }

    //* این تابع سرور را ناسالم علامت گذاری می کند ولی رکورد را حذف نمی کند.
    markServerUnhealthy(serverId) {
        const record = this.serversById.get(serverId);
        if (!record) return null;

        record.status = GAME_SERVER_STATUS.UNHEALTHY;
        record.updatedAt = nowMs();
        this.serversById.set(serverId, record);

        return cloneServerRecord(record);
    }

    //* این تابع همه سرورها را با فیلتر اختیاری برمی گرداند.
    listServers(filters = {}) {
        const result = [];

        for (const record of this.serversById.values()) {
            if (!this.matchesFilters(record, filters)) continue;
            result.push(cloneServerRecord(record));
        }

        return result;
    }

    //* این تابع سرورهای گرم آماده را برای رزرو یا کلیم برمی گرداند.
    listWarmServers(filters = {}) {
        return this.listServers({
            ...filters,
            status: GAME_SERVER_STATUS.WARM
        })
            .filter((server) => server.currentPlayers === 0)
            .filter((server) => !isNonEmptyString(server.roomId))
            .filter((server) => !hasAssignedRooms(server))
            .sort((a, b) => a.updatedAt - b.updatedAt);
    }

    //* این تابع تعداد سرورهای گرم آماده را برمی گرداند.
    countWarmServers(filters = {}) {
        return this.listWarmServers(filters).length;
    }

    //* این تابع یک سرور گرم را برای یک روم رزرو می کند.
    claimWarmServerForRoom(request = {}) {
        const roomId = cleanString(request.roomId, "");
        const roomName = cleanString(request.roomName, roomId);
        const roomMaxPlayers = clampInteger(request.roomMaxPlayers, 0, 1, 1024);
        const region = cleanString(request.region, "");
        const zone = cleanString(request.zone, "");
        const requestedServerId = cleanString(request.serverId, "");
        const reason = cleanString(request.reason, "warm_server_claimed_for_room");

        if (!roomId) {
            return {
                success: false,
                reason: "room_id_required",
                message: "roomId is required to claim a warm game server.",
                server: null
            };
        }

        let candidates = this.listWarmServers({ region, zone });

        if (requestedServerId) {
            candidates = candidates.filter((server) => server.serverId === requestedServerId);
        }

        const selectedServer = candidates[0] ?? null;

        if (!selectedServer) {
            return {
                success: false,
                reason: "warm_server_not_available",
                message: "No warm game server is available for claim.",
                server: null
            };
        }

        const record = this.serversById.get(selectedServer.serverId);

        if (!record) {
            return {
                success: false,
                reason: "warm_server_record_missing",
                message: "Warm game server record was not found after selection.",
                server: null
            };
        }

        if (roomMaxPlayers > record.maxPlayers) {
            return {
                success: false,
                reason: "room_capacity_exceeds_server_capacity",
                message: "Room capacity is larger than selected warm server capacity.",
                server: cloneServerRecord(record)
            };
        }

        record.roomId = roomId;
        record.assignedRooms = normalizeAssignedRooms(record.assignedRooms ?? {}, record.maxPlayers);
        record.assignedRooms[roomId] = createRoomAssignmentRecord({
            roomId,
            roomName,
            roomMaxPlayers,
            metadata: {
                source: "warm_claim"
            }
        }, record.maxPlayers);
        record.status = GAME_SERVER_STATUS.RESERVED;
        record.updatedAt = nowMs();
        record.metadata = {
            ...record.metadata,
            warmPool: {
                ...(record.metadata?.warmPool ?? {}),
                claimedAt: record.updatedAt,
                claimedRoomId: roomId,
                claimedRoomName: roomName,
                claimedRoomMaxPlayers: roomMaxPlayers,
                claimReason: reason
            }
        };
        recomputeServerReservedCapacity(record);

        this.serversById.set(record.serverId, record);

        return {
            success: true,
            reason,
            message: "Warm game server claimed for room.",
            server: cloneServerRecord(record)
        };
    }

    //* این تابع ظرفیت یک روم را روی سرور مشخص رزرو یا به روز می کند.
    assignRoomToServer(request = {}) {
        const serverId = cleanString(request.serverId, "");
        const roomId = cleanString(request.roomId, "");
        const roomName = cleanString(request.roomName, roomId);
        const roomMaxPlayers = clampInteger(request.roomMaxPlayers, 0, 1, 1024);
        const reason = cleanString(request.reason, "room_capacity_reserved");

        if (!serverId) {
            return {
                success: false,
                reason: "server_id_required",
                message: "serverId is required to assign room capacity.",
                server: null
            };
        }

        if (!roomId) {
            return {
                success: false,
                reason: "room_id_required",
                message: "roomId is required to assign room capacity.",
                server: null
            };
        }

        const record = this.serversById.get(serverId);

        if (!record) {
            return {
                success: false,
                reason: "server_not_found",
                message: "Game server was not found for room capacity assignment.",
                server: null
            };
        }

        recomputeServerReservedCapacity(record);

        const existingRoom = record.assignedRooms[roomId] ?? null;
        const previousRoomMaxPlayers = existingRoom
            ? clampInteger(existingRoom.roomMaxPlayers, 0, 0, 1024)
            : 0;
        const availableForThisRoom = getAvailableReservedSlotsForRoom(record, roomId);

        if (roomMaxPlayers > availableForThisRoom) {
            return {
                success: false,
                reason: "server_reserved_capacity_not_enough",
                message: "Game server does not have enough reserved capacity for this room.",
                server: cloneServerRecord(record),
                data: {
                    roomId,
                    requestedRoomMaxPlayers: roomMaxPlayers,
                    previousRoomMaxPlayers,
                    availableForThisRoom,
                    reservedPlayers: record.reservedPlayers,
                    maxPlayers: record.maxPlayers
                }
            };
        }

        record.assignedRooms[roomId] = createRoomAssignmentRecord({
            ...(existingRoom ?? {}),
            roomId,
            roomName,
            roomMaxPlayers,
            assignedAt: existingRoom?.assignedAt,
            updatedAt: nowMs(),
            metadata: {
                ...(existingRoom?.metadata ?? {}),
                lastAssignReason: reason
            }
        }, record.maxPlayers);

        if (!isNonEmptyString(record.roomId)) {
            record.roomId = roomId;
        }

        recomputeServerReservedCapacity(record);
        record.updatedAt = nowMs();
        this.serversById.set(serverId, record);

        return {
            success: true,
            reason,
            message: "Room capacity assigned to game server.",
            server: cloneServerRecord(record),
            room: record.assignedRooms[roomId]
        };
    }

    //* این تابع سرورهای قابل اتصال را با ظرفیت آزاد برمی گرداند.
    listAvailableServers(filters = {}) {
        return this.listServers(filters)
            .filter((server) => this.isServerAvailable(server, filters))
            .sort((a, b) => {
                const aFreeSlots = getAvailableReservedSlotsForRoom(a, filters.roomId ?? "");
                const bFreeSlots = getAvailableReservedSlotsForRoom(b, filters.roomId ?? "");
                return bFreeSlots - aFreeSlots;
            });
    }

    //* این تابع یک سرور مناسب برای روم مشخص پیدا می کند.
    findServerForRoom(roomId, filters = {}) {
        if (!isNonEmptyString(roomId)) return null;

        const availableServers = this.listAvailableServers({
            ...filters,
            roomId: roomId.trim()
        });

        return availableServers.length > 0 ? availableServers[0] : null;
    }

    //* این تابع یک سرور مناسب در یک منطقه مشخص پیدا می کند.
    findServerForRegion(region, filters = {}) {
        if (!isNonEmptyString(region)) return null;

        const availableServers = this.listAvailableServers({
            ...filters,
            region: region.trim()
        });

        return availableServers.length > 0 ? availableServers[0] : null;
    }

    //* این تابع آمار کلی رجیستری سرورها را می سازد.
    getStats() {
        const stats = {
            total: this.serversById.size,
            online: 0,
            full: 0,
            busy: 0,
            starting: 0,
            draining: 0,
            offline: 0,
            unhealthy: 0,
            warm: 0,
            reserved: 0,
            claimed: 0,
            totalPlayers: 0,
            totalCapacity: 0,
            reservedPlayers: 0,
            availableReservedSlots: 0,
            assignedRooms: 0,
            regions: {},
            rooms: {
                total: 0,
                totalPlayers: 0,
                byServer: {},
                byRoom: {}
            }};

        for (const record of this.serversById.values()) {
            if (stats[record.status] !== undefined) stats[record.status]++;

            recomputeServerReservedCapacity(record);
            stats.totalPlayers += record.currentPlayers;
            stats.totalCapacity += record.maxPlayers;
            stats.reservedPlayers += record.reservedPlayers;
            stats.availableReservedSlots += record.availableReservedSlots;
            stats.assignedRooms += Object.keys(record.assignedRooms ?? {}).length;

            if (!stats.regions[record.region]) {
                stats.regions[record.region] = {
                    servers: 0,
                    players: 0,
                    capacity: 0,
                    reservedPlayers: 0,
                    availableReservedSlots: 0,
                    assignedRooms: 0
                };
            }

            stats.regions[record.region].servers++;
            stats.regions[record.region].players += record.currentPlayers;
            stats.regions[record.region].capacity += record.maxPlayers;

            const heartbeatRooms = getHeartbeatRoomsFromServerRecord(record);
            const primaryNormalized = normalizePrimaryRoomList(record, heartbeatRooms);

            if (primaryNormalized.rooms.length > 0) {
                const roomPlayers = calculateHeartbeatRoomPlayers(primaryNormalized.rooms);

                stats.rooms.total += primaryNormalized.rooms.length;
                stats.rooms.totalPlayers += roomPlayers;
                stats.rooms.byServer[record.serverId] = {
                    serverId: record.serverId,
                    primaryRoomId: primaryNormalized.primaryRoomId,
                    status: record.status,
                    players: record.currentPlayers,
                    capacity: record.maxPlayers,
                    roomCount: primaryNormalized.rooms.length,
                    roomPlayers,
                    rooms: primaryNormalized.rooms
                };

                for (const room of primaryNormalized.rooms) {
                    stats.rooms.byRoom[room.roomId] = {
                        roomId: room.roomId,
                        roomName: room.roomName,
                        displayName: room.displayName || room.roomName || room.roomId,
                        serverId: record.serverId,
                        currentPlayers: room.currentPlayers,
                        isPrimary: room.isPrimary === true
                    };
                }
            }
            stats.regions[record.region].reservedPlayers += record.reservedPlayers;
            stats.regions[record.region].availableReservedSlots += record.availableReservedSlots;
            stats.regions[record.region].assignedRooms += Object.keys(record.assignedRooms ?? {}).length;
        }

        return stats;
    }


    //* این تابع روم های خالی و بدون سشن فعال را از رزرو سرور آزاد می کند.
    cleanupEmptyRoomReservations(options = {}) {
        const activeRoomIds = new Set(
            Array.isArray(options.activeRoomIds)
                ? options.activeRoomIds
                    .map((roomId) => cleanString(roomId, ""))
                    .filter((roomId) => roomId)
                : []
        );

        let changedServers = 0;
        let removedRooms = 0;
        const changed = [];

        for (const record of this.serversById.values()) {
            const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
            const assignedRooms = record.assignedRooms && typeof record.assignedRooms === "object"
                ? { ...record.assignedRooms }
                : {};

            const heartbeatRooms = Array.isArray(record.rooms)
                ? record.rooms
                : Array.isArray(metadata.rooms)
                    ? metadata.rooms
                    : [];

            const normalizedHeartbeatRooms = heartbeatRooms
                .map((room) => {
                    if (!room || typeof room !== "object") return null;

                    const roomId = cleanString(room.roomId, "");
                    if (!roomId) return null;

                    return {
                        roomId,
                        roomName: cleanString(room.roomName, ""),
                        currentPlayers: clampInteger(room.currentPlayers, 0, 0, 100000),
                        isPrimary: room.isPrimary === true
                    };
                })
                .filter(Boolean);

            const roomsById = new Map();

            for (const room of normalizedHeartbeatRooms) {
                roomsById.set(room.roomId, room);
            }

            for (const roomId of Object.keys(assignedRooms)) {
                if (!roomsById.has(roomId)) {
                    roomsById.set(roomId, {
                        roomId,
                        roomName: cleanString(assignedRooms[roomId]?.roomName, ""),
                        currentPlayers: 0,
                        isPrimary: cleanString(record.roomId, "") === roomId
                    });
                }
            }

            const removedRoomIds = [];

            for (const [roomId, room] of roomsById.entries()) {
                if (activeRoomIds.has(roomId)) continue;
                if (room.currentPlayers > 0) continue;

                if (assignedRooms[roomId]) {
                    delete assignedRooms[roomId];
                }

                removedRoomIds.push(roomId);
                removedRooms++;
            }

            if (removedRoomIds.length <= 0) continue;

            const nextRooms = Array.from(roomsById.values())
                .filter((room) => !removedRoomIds.includes(room.roomId));

            const nextReservedPlayers = Object.values(assignedRooms).reduce((sum, room) => {
                const roomMaxPlayers = clampInteger(room?.roomMaxPlayers, 0, 0, record.maxPlayers);
                return sum + roomMaxPlayers;
            }, 0);

            const primaryNormalized = normalizePrimaryRoomList(record, nextRooms);

            record.assignedRooms = assignedRooms;
            record.reservedPlayers = nextReservedPlayers;
            record.availableReservedSlots = Math.max(0, record.maxPlayers - nextReservedPlayers);
            record.roomId = primaryNormalized.primaryRoomId;
            record.rooms = primaryNormalized.rooms;

            record.metadata = {
                ...metadata,
                rooms: primaryNormalized.rooms,
                activeRoomCount: primaryNormalized.rooms.length,
                totalRoomPlayers: primaryNormalized.rooms.reduce((sum, room) => sum + room.currentPlayers, 0),
                emptyRoomReservationCleanup: {
                    lastCleanupAt: nowMs(),
                    removedRoomIds,
                    activeRoomIds: Array.from(activeRoomIds)
                }
            };

            record.updatedAt = nowMs();

            this.serversById.set(record.serverId, record);
            changedServers++;

            changed.push({
                serverId: record.serverId,
                removedRoomIds,
                reservedPlayers: record.reservedPlayers,
                availableReservedSlots: record.availableReservedSlots,
                roomCount: nextRooms.length
            });
        }

        return {
            changedServers,
            removedRooms,
            changed
        };
    }


    //* این تابع کل رجیستری را پاک می کند و فقط برای تست یا شات داون استفاده می شود.
    clear() {
        const count = this.serversById.size;
        this.serversById.clear();
        return count;
    }

    //* این تابع بررسی می کند رکورد سرور با فیلترها همخوان است یا نه.
    matchesFilters(record, filters = {}) {
        if (isNonEmptyString(filters.serverId) && record.serverId !== filters.serverId.trim()) return false;
        if (isNonEmptyString(filters.roomId)) {
            const requestedRoomId = filters.roomId.trim();
            if (record.roomId !== requestedRoomId && !record.assignedRooms?.[requestedRoomId]) return false;
        }
        if (isNonEmptyString(filters.region) && record.region !== filters.region.trim()) return false;
        if (isNonEmptyString(filters.zone) && record.zone !== filters.zone.trim()) return false;
        if (isNonEmptyString(filters.status) && record.status !== filters.status.trim()) return false;

        return true;
    }

    //* این تابع بررسی می کند سرور برای پذیرش پلیر جدید مناسب است یا نه.
    isServerAvailable(record, filters = {}) {
        if (!record) return false;

        const allowedStatuses = new Set([
            GAME_SERVER_STATUS.ONLINE,
            GAME_SERVER_STATUS.BUSY,
            GAME_SERVER_STATUS.RESERVED,
            GAME_SERVER_STATUS.CLAIMED
        ]);

        if (!allowedStatuses.has(record.status)) return false;

        recomputeServerReservedCapacity(record);

        const roomId = cleanString(filters.roomId, "");
        const minFreeSlots = clampInteger(filters.minFreeSlots, 1, 1, 1024);
        const roomMaxPlayers = filters.roomMaxPlayers !== undefined
            ? clampInteger(filters.roomMaxPlayers, minFreeSlots, 1, 1024)
            : minFreeSlots;
        const requiredSlots = Math.max(minFreeSlots, roomMaxPlayers);
        const freeSlots = getAvailableReservedSlotsForRoom(record, roomId);

        return freeSlots >= requiredSlots;
    }

    //* این تابع درخواست ثبت سرور را اعتبارسنجی می کند.
    validateRegisterServerRequest(request) {
        if (!request || typeof request !== "object") {
            throw new Error("[GameServerRegistry] registerServer request object is required.");
        }

        if (!isNonEmptyString(request.serverId)) {
            throw new Error("[GameServerRegistry] serverId is required.");
        }

        if (request.port !== undefined) {
            const port = Number.parseInt(request.port, 10);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error("[GameServerRegistry] port must be between 1 and 65535.");
            }
        }

        if (request.maxPlayers !== undefined) {
            const maxPlayers = Number.parseInt(request.maxPlayers, 10);
            if (!Number.isInteger(maxPlayers) || maxPlayers < 1) {
                throw new Error("[GameServerRegistry] maxPlayers must be at least 1.");
            }
        }

        if (request.currentPlayers !== undefined) {
            const currentPlayers = Number.parseInt(request.currentPlayers, 10);
            if (!Number.isInteger(currentPlayers) || currentPlayers < 0) {
                throw new Error("[GameServerRegistry] currentPlayers must be zero or greater.");
            }
        }
    }
}

//* این تابع یک نمونه جدید از رجیستری ددیکیتد سرور می سازد.
function createGameServerRegistry(options = {}) {
    return new GameServerRegistry(options);
}

export {
    GAME_SERVER_STATUS,
    GameServerRegistry,
    createGameServerRegistry
};

// این فایل فقط رجیستری داخلی ددیکیتد سرورها را مدیریت می کند و هنوز هیچ اتصال بیرونی یا تغییر در سرور اصلی ایجاد نمی کند.
