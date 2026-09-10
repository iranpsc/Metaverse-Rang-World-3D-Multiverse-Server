// File => src/realTime/modules/game/gameRoomService.js

import { RealtimeErrorCodes } from "../../protocol/envelope.js";
import { setRealtimeContextRoom } from "../../core/realtimeContext.js";

//* این تابع شناسه روم را از اِنولوپ یا پِیلود می خواند تا سرویس روم بازی ورودی های مختلف را یکدست کند.
function readGameRoomIdFromEnvelope(envelope, fallbackRoomId = "") {
    return String(envelope?.room ?? envelope?.payload?.roomId ?? envelope?.payload?.room ?? fallbackRoomId ?? "").trim();
}

//* این تابع شناسه یوزر را از کانتکست می خواند تا سرویس بازی بدون اعتماد به پِیلود کلاینت، یوزر را بشناسد.
function readGameUserIdFromContext(ctx) {
    return String(ctx?.user?.id ?? ctx?.user?.userId ?? "").trim();
}

//* این تابع بررسی می کند که روم مَنِیجِر در کانتکست یا سرویس موجود باشد تا عملیات روم بدون کرش انجام شود.
function requireGameRoomManager(rooms) {
    if (!rooms || typeof rooms.join !== "function" || typeof rooms.leave !== "function" || typeof rooms.broadcast !== "function") {
        throw { code: RealtimeErrorCodes.internalError, message: "Realtime room manager is not available" };
    }
    return rooms;
}

class GameRoomService {
    //* این سازنده وابستگی های سرویس روم بازی را نگه می دارد و خودش ترنسپورت یا رُتِر نمی سازد.
    constructor({ rooms = null, registry = null, logger = null } = {}) {
        this.rooms = rooms;
        this.registry = registry;
        this.logger = logger;
    }

    //* این تابع روم مَنِیجِر فعال را از سرویس یا کانتکست پیدا می کند تا عملیات روم روی منبع درست انجام شود.
    getRooms(ctx) {
        return requireGameRoomManager(this.rooms ?? ctx?.rooms);
    }

    //* این تابع کانکشن آث شده را وارد روم بازی می کند و نتیجه قابل اَک برای رُت برمی گرداند.
    joinRoom(ctx, envelope) {
        const roomId = readGameRoomIdFromEnvelope(envelope);
        if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

        const rooms = this.getRooms(ctx);
        const userId = readGameUserIdFromContext(ctx);
        const currentConnectionAlreadyJoined = rooms.hasConnection?.(roomId, ctx?.realtimeConnection) === true;
        const existingUserInRoom = userId && typeof rooms.hasUser === "function"
            ? rooms.hasUser(roomId, userId, { exceptConnection: ctx?.realtimeConnection })
            : false;
        const replacedConnections = userId && typeof rooms.leaveConnectionsByUser === "function"
            ? rooms.leaveConnectionsByUser(roomId, userId, { exceptConnection: ctx?.realtimeConnection })
            : 0;
        const joined = rooms.join(roomId, ctx?.realtimeConnection) === true;
        if (joined) setRealtimeContextRoom(ctx, roomId);
        const logicalRejoin = currentConnectionAlreadyJoined || existingUserInRoom || replacedConnections > 0;

        this.logger?.info?.("Game room joined", {
            roomId,
            connectionId: ctx?.connectionId,
            userId,
            logicalRejoin,
            replacedConnections
        });

        return {
            ok: joined,
            roomId,
            userId,
            logicalRejoin,
            replacedConnections,
            connectionCount: rooms.getRoomSize?.(roomId) ?? 0,
            userCount: rooms.getRoomUserCount?.(roomId) ?? rooms.getRoomSize?.(roomId) ?? 0
        };
    }

    //* این تابع کانکشن آث شده را از روم بازی خارج می کند و اگر همان روم فعال باشد، کانتکست را هم پاک می کند.
    leaveRoom(ctx, envelope) {
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

        const rooms = this.getRooms(ctx);
        const wasMember = rooms.hasConnection?.(roomId, ctx?.realtimeConnection) === true;
        const left = rooms.leave(roomId, ctx?.realtimeConnection) === true;
        if (left && ctx?.roomId === roomId) setRealtimeContextRoom(ctx, "");

        this.logger?.info?.("Game room left", { roomId, connectionId: ctx?.connectionId, userId: readGameUserIdFromContext(ctx), wasMember });
        return {
            ok: left,
            roomId,
            userId: readGameUserIdFromContext(ctx),
            wasMember,
            connectionCount: rooms.getRoomSize?.(roomId) ?? 0,
            userCount: rooms.getRoomUserCount?.(roomId) ?? rooms.getRoomSize?.(roomId) ?? 0
        };
    }

    //* این تابع کانکشن را از همه روم های بازی خارج می کند و برای کلیناپ دیسکانکت در فازهای بعدی استفاده می شود.
    leaveAllRooms(ctx) {
        const rooms = this.getRooms(ctx);
        const removed = rooms.leaveAll?.(ctx?.realtimeConnection) ?? 0;
        if (ctx) setRealtimeContextRoom(ctx, "");
        return { removed, userId: readGameUserIdFromContext(ctx) };
    }

    //* این تابع پیام را به روم بازی برادکست می کند و می تواند فرستنده را از دریافت همان پیام مستثنا کند.
    broadcastToRoom(ctx, envelope, { exceptSelf = false } = {}) {
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

        const rooms = this.getRooms(ctx);
        const sent = rooms.broadcast(roomId, envelope, exceptSelf ? { exceptConnection: ctx?.realtimeConnection } : {}) ?? 0;
        return { roomId, sent, userId: readGameUserIdFromContext(ctx) };
    }

    //* این تابع وضعیت خلاصه روم را برمی گرداند تا رُت ها برای اَک، تست و مانیتورینگ از آن استفاده کنند.
    getRoomInfo(ctx, roomId) {
        const rooms = this.getRooms(ctx);
        const normalizedRoomId = String(roomId ?? ctx?.roomId ?? "").trim();
        return {
            roomId: normalizedRoomId,
            exists: rooms.hasRoom?.(normalizedRoomId) === true,
            connectionCount: rooms.getRoomSize?.(normalizedRoomId) ?? 0,
            userCount: rooms.getRoomUserCount?.(normalizedRoomId) ?? rooms.getRoomSize?.(normalizedRoomId) ?? 0
        };
    }
}

//* این تابع سرویس روم بازی را می سازد تا ساخت سرویس در بوت استرپ و رُت ها یکدست باشد.
function createGameRoomService(options = {}) {
    return new GameRoomService(options);
}

/*
توضیح کلی اسکریپت:
این فایل سرویس روم بازی را مدیریت می کند.
سرویس روم بازی بین رُت های بازی و روم مَنِیجِر قرار می گیرد.
این فایل جوین روم، لیو روم، لیو آل و برادکست روم را به شکل تمیز و قابل تست انجام می دهد.
این فایل نباید ترنسپورت خام، آث واقعی، رُتِر یا قوانین سنگین بازی را اجرا کند.
وظیفه این فایل جدا کردن لاجیک پایه روم بازی از فایل رُت های بازی است.
*/

export {
    GameRoomService,
    createGameRoomService,
    readGameRoomIdFromEnvelope,
    readGameUserIdFromContext,
    requireGameRoomManager
};
