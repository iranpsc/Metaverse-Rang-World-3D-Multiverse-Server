// File => src/realTime/lobby/publicLobbyStartupService.js

import { RoomRepository } from "../../infra/mongo/models/repositories/room.repository.js";

//#region Phase 7.L - Public 3D Lobby Configuration

//* این تنظیمات مشخصات ثابت روم عمومی سه بعدی لابی را نگه می دارد.
const PUBLIC_LOBBY_ROOM_CONFIG = Object.freeze({
    roomId: "room_public_lobby_main",
    roomName: "Main Public Lobby",
    description: "Permanent public 3D lobby for all authenticated users.",
    ownerUserId: "system_public_lobby",
    ownerUserName: "System",
    visibility: "public",
    maxPlayers: 100,
    metadata: Object.freeze({
        roomType: "public_lobby",
        systemRoom: true,
        isPublic: true,
        isPermanent: true,
        autoCleanup: false,
        excludeFromRoomList: true,
        dedicatedRequired: true,
        sceneName: "Lobby 1",
        version: "7.L.1"
    })
});

//#endregion Phase 7.L - Public 3D Lobby Configuration

//#region Phase 7.L - Public 3D Lobby Validation

//* این تابع بررسی می کند مشخصات اصلی لابی عمومی قبل از ذخیره در دیتابیس معتبر باشند.
function validatePublicLobbyRoomConfig(config) {
    if (!config || typeof config !== "object")
        throw new Error("[PublicLobbyStartup] Public lobby configuration is missing.");

    if (!String(config.roomId ?? "").trim())
        throw new Error("[PublicLobbyStartup] Public lobby roomId is missing.");

    if (!String(config.roomName ?? "").trim())
        throw new Error("[PublicLobbyStartup] Public lobby roomName is missing.");

    if (!String(config.ownerUserId ?? "").trim())
        throw new Error("[PublicLobbyStartup] Public lobby ownerUserId is missing.");

    if (!String(config.ownerUserName ?? "").trim())
        throw new Error("[PublicLobbyStartup] Public lobby ownerUserName is missing.");

    const maxPlayers = Number(config.maxPlayers);

    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100)
        throw new Error("[PublicLobbyStartup] Public lobby maxPlayers must be between 1 and 100.");

    if (config.metadata?.roomType !== "public_lobby")
        throw new Error("[PublicLobbyStartup] Public lobby roomType must be public_lobby.");

    if (config.metadata?.isPermanent !== true)
        throw new Error("[PublicLobbyStartup] Public lobby must be permanent.");

    if (config.metadata?.autoCleanup !== false)
        throw new Error("[PublicLobbyStartup] Public lobby auto cleanup must be disabled.");

    if (config.metadata?.excludeFromRoomList !== true)
        throw new Error("[PublicLobbyStartup] Public lobby must be excluded from the normal room list.");

    return true;
}

//#endregion Phase 7.L - Public 3D Lobby Validation

//#region Phase 7.L - Public 3D Lobby Startup

//* این تابع روم عمومی لابی را هنگام راه اندازی سرور در دیتابیس ایجاد یا بازیابی می کند و از ساخت نمونه تکراری جلوگیری می کند.
async function ensurePublicLobbyRoomReady({
    roomRepository = null,
    logger = console
} = {}) {
    validatePublicLobbyRoomConfig(PUBLIC_LOBBY_ROOM_CONFIG);

    const repository = roomRepository ?? new RoomRepository();

    logger?.info?.("[PublicLobbyStartup] Ensuring permanent public lobby room...", {
        roomId: PUBLIC_LOBBY_ROOM_CONFIG.roomId,
        roomName: PUBLIC_LOBBY_ROOM_CONFIG.roomName,
        roomType: PUBLIC_LOBBY_ROOM_CONFIG.metadata.roomType,
        maxPlayers: PUBLIC_LOBBY_ROOM_CONFIG.maxPlayers
    });

    const room = await repository.upsertSystemRoom({
        roomId: PUBLIC_LOBBY_ROOM_CONFIG.roomId,
        roomName: PUBLIC_LOBBY_ROOM_CONFIG.roomName,
        description: PUBLIC_LOBBY_ROOM_CONFIG.description,
        ownerUserId: PUBLIC_LOBBY_ROOM_CONFIG.ownerUserId,
        ownerUserName: PUBLIC_LOBBY_ROOM_CONFIG.ownerUserName,
        visibility: PUBLIC_LOBBY_ROOM_CONFIG.visibility,
        maxPlayers: PUBLIC_LOBBY_ROOM_CONFIG.maxPlayers,
        metadata: {
            ...PUBLIC_LOBBY_ROOM_CONFIG.metadata
        }
    });

    if (!room?.roomId)
        throw new Error("[PublicLobbyStartup] Public lobby room could not be created or restored.");

    if (room.roomId !== PUBLIC_LOBBY_ROOM_CONFIG.roomId)
        throw new Error("[PublicLobbyStartup] Public lobby roomId mismatch.");

    logger?.info?.("[PublicLobbyStartup] Permanent public lobby room is ready.", {
        roomId: room.roomId,
        roomName: room.roomName,
        status: room.status,
        onlineCount: room.onlineCount,
        maxPlayers: room.maxPlayers,
        roomType: room.metadata?.roomType ?? "",
        isPermanent: room.metadata?.isPermanent === true,
        autoCleanup: room.metadata?.autoCleanup !== false,
        excludeFromRoomList: room.metadata?.excludeFromRoomList === true
    });

    return room;
}

//#endregion Phase 7.L - Public 3D Lobby Startup

export {
    PUBLIC_LOBBY_ROOM_CONFIG,
    ensurePublicLobbyRoomReady,
    validatePublicLobbyRoomConfig
};
