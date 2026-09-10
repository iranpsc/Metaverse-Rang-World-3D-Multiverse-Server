// File => src/realTime/lobby/roomDirectoryService.js

import crypto from "crypto";
import { RoomRepository } from "../../infra/mongo/models/repositories/room.repository.js";

const RoomDirectoryErrorCodes = Object.freeze({
    invalidInput: "room_invalid_input",
    notAuthenticated: "room_not_authenticated",
    roomNotFound: "room_not_found",
    roomClosed: "room_closed",
    roomFull: "room_full",
    forbidden: "room_forbidden",
    internalError: "room_internal_error"
});

const RoomStatus = Object.freeze({
    open: "open",
    full: "full",
    empty: "empty",
    closed: "closed"
});

const RoomVisibility = Object.freeze({
    public: "public",
    private: "private"
});

//* این تابع متن ساده را برای استفاده در روم استاندارد می کند.
function normalizeText(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}

//* این تابع عدد ظرفیت روم را محدود و استاندارد می کند.
function normalizeMaxPlayers(value) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return 20;
    }

    const fixed = Math.floor(numberValue);

    if (fixed < 1) return 1;
    if (fixed > 100) return 100;

    return fixed;
}

//* این تابع تعداد آنلاین روم را محدود و استاندارد می کند.
function normalizeOnlineCount(value) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return 0;
    }

    const fixed = Math.floor(numberValue);

    return fixed < 0 ? 0 : fixed;
}

//* این تابع خطای استاندارد روم می سازد.
function createRoomDirectoryError(code, message, details = null) {
    return {
        code,
        message,
        details
    };
}

//* این تابع شناسه یوزر را از کانتکست ریل تایم می خواند.
function readContextUserId(ctx) {
    return String(ctx?.user?.userId ?? ctx?.user?.id ?? "").trim();
}

//* این تابع نام یوزر را از کانتکست ریل تایم می خواند.
function readContextUserName(ctx) {
    return String(ctx?.user?.userName ?? "").trim();
}

//* این تابع مطمئن می شود کانتکست ریل تایم یوزر معتبر دارد.
function requireContextUser(ctx) {
    const userId = readContextUserId(ctx);
    const userName = readContextUserName(ctx);

    if (!userId) {
        throw createRoomDirectoryError(
            RoomDirectoryErrorCodes.notAuthenticated,
            "Room requires authenticated user"
        );
    }

    if (!userName) {
        throw createRoomDirectoryError(
            RoomDirectoryErrorCodes.invalidInput,
            "Room requires userName"
        );
    }

    return {
        userId,
        userName
    };
}

//* این تابع نام روم را اعتبارسنجی و استاندارد می کند.
function normalizeAndValidateRoomName(roomName) {
    const normalized = normalizeText(roomName);

    if (normalized.length < 2) {
        throw createRoomDirectoryError(
            RoomDirectoryErrorCodes.invalidInput,
            "roomName is too short"
        );
    }

    if (normalized.length > 64) {
        throw createRoomDirectoryError(
            RoomDirectoryErrorCodes.invalidInput,
            "roomName is too long"
        );
    }

    return normalized;
}

//* این تابع توضیح روم را استاندارد و محدود می کند.
function normalizeDescription(description) {
    const normalized = normalizeText(description);

    if (normalized.length > 256) {
        return normalized.slice(0, 256);
    }

    return normalized;
}

//* این تابع حالت نمایش روم را استاندارد می کند.
function normalizeVisibility(visibility) {
    return visibility === RoomVisibility.private
        ? RoomVisibility.private
        : RoomVisibility.public;
}

//* این تابع شناسه امن برای روم جدید می سازد.
function createRoomId() {
    return `room_${crypto.randomUUID()}`;
}

//* این تابع مشخص می کند روم از نظر وضعیت قابل ورود است یا نه.
function isRoomJoinable(room) {
    if (!room) return false;
    if (room.status === RoomStatus.closed) return false;
    if (room.status === RoomStatus.full) return false;

    const onlineCount = normalizeOnlineCount(room.onlineCount);
    const maxPlayers = normalizeMaxPlayers(room.maxPlayers);

    return onlineCount < maxPlayers;
}

//* این تابع براساس تعداد آنلاین، وضعیت درست روم را مشخص می کند.
function resolveStatusFromOnlineCount(onlineCount, maxPlayers) {
    const fixedOnlineCount = normalizeOnlineCount(onlineCount);
    const fixedMaxPlayers = normalizeMaxPlayers(maxPlayers);

    if (fixedOnlineCount <= 0) {
        return RoomStatus.empty;
    }

    if (fixedOnlineCount >= fixedMaxPlayers) {
        return RoomStatus.full;
    }

    return RoomStatus.open;
}

//* این تابع خروجی روم را برای کلاینت آماده می کند.
function mapRoomForClient(room) {
    if (!room) {
        return null;
    }

    return {
        roomId: room.roomId ?? "",
        roomName: room.roomName ?? "",
        description: room.description ?? "",
        ownerUserId: room.ownerUserId ?? "",
        ownerUserName: room.ownerUserName ?? "",
        visibility: room.visibility ?? RoomVisibility.public,
        status: room.status ?? RoomStatus.open,
        maxPlayers: Number(room.maxPlayers ?? 20),
        onlineCount: Number(room.onlineCount ?? 0),
        createdAtUnix: Number(room.createdAtUnix ?? 0),
        updatedAtUnix: Number(room.updatedAtUnix ?? 0),
        lastActiveAtUnix: Number(room.lastActiveAtUnix ?? 0),
        closedAtUnix: Number(room.closedAtUnix ?? 0),
        canJoin: isRoomJoinable(room)
    };
}

//* این کلاس منطق اصلی دایرکتوری روم را مدیریت می کند.
export class RoomDirectoryService {
    constructor({ roomRepository = null, logger = console } = {}) {
        this.roomRepository = roomRepository ?? new RoomRepository();
        this.logger = logger;
    }

    //* ساخت روم جدید برای یوزر آث شده.
    async createRoomForUser(ctx, payload = {}) {
        const user = requireContextUser(ctx);

        const roomName = normalizeAndValidateRoomName(payload.roomName);
        const description = normalizeDescription(payload.description ?? "");
        const visibility = normalizeVisibility(payload.visibility ?? RoomVisibility.public);
        const maxPlayers = normalizeMaxPlayers(payload.maxPlayers ?? 20);

        const room = await this.roomRepository.createRoom({
            roomId: createRoomId(),
            roomName,
            description,
            ownerUserId: user.userId,
            ownerUserName: user.userName,
            visibility,
            maxPlayers,
            metadata: payload.metadata ?? {}
        });

        return mapRoomForClient(room);
    }

    //* گرفتن لیست روم های قابل نمایش برای یوزر.
    async listRoomsForUser(ctx, payload = {}) {
        requireContextUser(ctx);

        const rooms = await this.roomRepository.listOpenRooms({
            limit: payload.limit ?? 50,
            skip: payload.skip ?? 0,
            visibility: payload.visibility ?? RoomVisibility.public
        });

        return rooms.map(mapRoomForClient);
    }

    //* بررسی قابل ورود بودن روم.
    async canJoinRoom(ctx, roomId) {
        requireContextUser(ctx);

        const normalizedRoomId = normalizeText(roomId);

        if (!normalizedRoomId) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.invalidInput,
                "roomId is required"
            );
        }

        const room = await this.roomRepository.findRoomById(normalizedRoomId);

        if (!room) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.roomNotFound,
                "room not found"
            );
        }

        if (room.status === RoomStatus.closed) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.roomClosed,
                "room is closed"
            );
        }

        if (!isRoomJoinable(room)) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.roomFull,
                "room is full"
            );
        }

        return {
            ok: true,
            room: mapRoomForClient(room)
        };
    }

    //* ثبت ورود یوزر به روم و آپدیت شمارنده آنلاین.
    async markUserJoined(roomId, onlineCount) {
        const room = await this.roomRepository.findRoomById(roomId);

        if (!room) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.roomNotFound,
                "room not found"
            );
        }

        const fixedOnlineCount = normalizeOnlineCount(onlineCount);
        const nextStatus = resolveStatusFromOnlineCount(fixedOnlineCount, room.maxPlayers);

        await this.roomRepository.updateOnlineCount(roomId, fixedOnlineCount);
        await this.roomRepository.updateRoomStatus(roomId, nextStatus);

        const updatedRoom = await this.roomRepository.findRoomById(roomId);
        return mapRoomForClient(updatedRoom);
    }

    //* ثبت خروج یوزر از روم و آپدیت شمارنده آنلاین.
    async markUserLeft(roomId, onlineCount) {
        const room = await this.roomRepository.findRoomById(roomId);

        if (!room) {
            return null;
        }

        const fixedOnlineCount = normalizeOnlineCount(onlineCount);
        const nextStatus = resolveStatusFromOnlineCount(fixedOnlineCount, room.maxPlayers);

        await this.roomRepository.updateOnlineCount(roomId, fixedOnlineCount);
        await this.roomRepository.updateRoomStatus(roomId, nextStatus);

        const updatedRoom = await this.roomRepository.findRoomById(roomId);
        return mapRoomForClient(updatedRoom);
    }

    //* بستن روم توسط مالک روم.
    async closeRoomByOwner(ctx, roomId) {
        const user = requireContextUser(ctx);
        const room = await this.roomRepository.findRoomById(roomId);

        if (!room) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.roomNotFound,
                "room not found"
            );
        }

        if (room.ownerUserId !== user.userId) {
            throw createRoomDirectoryError(
                RoomDirectoryErrorCodes.forbidden,
                "only room owner can close room"
            );
        }

        await this.roomRepository.closeRoom(roomId);

        const updatedRoom = await this.roomRepository.findRoomById(roomId);
        return mapRoomForClient(updatedRoom);
    }
}

export {
    RoomDirectoryErrorCodes,
    RoomStatus,
    RoomVisibility,
    createRoomDirectoryError,
    isRoomJoinable,
    mapRoomForClient
};
