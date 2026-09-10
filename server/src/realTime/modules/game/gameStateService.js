// File => src/realTime/modules/game/gameStateService.js

import { readGameRoomIdFromEnvelope, readGameUserIdFromContext, requireGameRoomManager } from "./gameRoomService.js";

//* این تابع یک وضعیت خالی برای روم بازی می سازد تا سرویس بتواند آخرین اکشن ها و رویدادها را نگه دارد.
function createEmptyGameRoomState(roomId) {
    return {
        roomId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastPlayerAction: null,
        lastWorldEvent: null,
        actionCount: 0,
        worldEventCount: 0
    };
}

class GameStateService {
    //* این سازنده سرویس وضعیت بازی را می سازد و وضعیت روم ها را در حافظه همین پروسس نگه می دارد.
    constructor({ rooms = null, logger = null } = {}) {
        this.rooms = rooms;
        this.logger = logger;
        this.roomStates = new Map();
    }

    //* این تابع روم مَنِیجِر فعال را از سرویس یا کانتکست پیدا می کند تا رویدادها در روم درست پخش شوند.
    getRooms(ctx) {
        return requireGameRoomManager(this.rooms ?? ctx?.rooms);
    }

    //* این تابع وضعیت روم را پیدا می کند و اگر وجود نداشته باشد، یک وضعیت تازه می سازد.
    getOrCreateRoomState(roomId) {
        const normalizedRoomId = String(roomId ?? "").trim();
        if (!this.roomStates.has(normalizedRoomId)) this.roomStates.set(normalizedRoomId, createEmptyGameRoomState(normalizedRoomId));
        return this.roomStates.get(normalizedRoomId);
    }

    //* این تابع اکشن پلیر را روی وضعیت روم ثبت می کند و همان اِنولوپ را برای اعضای روم برادکست می کند.
    processPlayerAction(ctx, envelope) {
        const rooms = this.getRooms(ctx);
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        const state = this.getOrCreateRoomState(roomId);
        state.updatedAt = Date.now();
        state.actionCount++;
        state.lastPlayerAction = {
            userId: readGameUserIdFromContext(ctx),
            envelopeId: envelope?.id ?? "",
            payload: envelope?.payload ?? null,
            createdAt: Date.now()
        };

        const sent = rooms.broadcast(roomId, envelope, { exceptConnection: ctx?.realtimeConnection }) ?? 0;
        return { roomId, sent, actionCount: state.actionCount };
    }

    //* این تابع رویداد جهان بازی را روی وضعیت روم ثبت می کند و آن را برای اعضای روم برادکست می کند.
    processWorldEvent(ctx, envelope) {
        const rooms = this.getRooms(ctx);
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        const state = this.getOrCreateRoomState(roomId);
        state.updatedAt = Date.now();
        state.worldEventCount++;
        state.lastWorldEvent = {
            userId: readGameUserIdFromContext(ctx),
            envelopeId: envelope?.id ?? "",
            payload: envelope?.payload ?? null,
            createdAt: Date.now()
        };

        const sent = rooms.broadcast(roomId, envelope) ?? 0;
        return { roomId, sent, worldEventCount: state.worldEventCount };
    }

    //* این تابع یک اسنپ شات امن از وضعیت یک روم برمی گرداند تا برای اَک، تست و مانیتورینگ استفاده شود.
    getRoomStateSnapshot(roomId) {
        const state = this.roomStates.get(String(roomId ?? "").trim());
        if (!state) return null;
        return {
            roomId: state.roomId,
            createdAt: state.createdAt,
            updatedAt: state.updatedAt,
            actionCount: state.actionCount,
            worldEventCount: state.worldEventCount,
            lastPlayerAction: state.lastPlayerAction,
            lastWorldEvent: state.lastWorldEvent
        };
    }

    //* این تابع وضعیت یک روم را پاک می کند و برای خالی شدن روم یا تست استفاده می شود.
    removeRoomState(roomId) {
        return this.roomStates.delete(String(roomId ?? "").trim());
    }

    //* این تابع همه وضعیت های بازی را پاک می کند و برای توقف سرور یا تست استفاده می شود.
    clear() {
        this.roomStates.clear();
    }
}

//* این تابع سرویس وضعیت بازی را می سازد تا ساخت سرویس در بوت استرپ و رُت ها یکدست باشد.
function createGameStateService(options = {}) {
    return new GameStateService(options);
}

/*
توضیح کلی اسکریپت:
این فایل سرویس وضعیت بازی را مدیریت می کند.
در این فاز وضعیت بازی فقط در حافظه نگه داشته می شود و هنوز دیتابیس یا قوانین سنگین بازی اضافه نشده است.
این فایل آخرین اکشن پلیر و آخرین رویداد جهان را برای هر روم ثبت می کند و پیام را به اعضای روم برادکست می کند.
این فایل نباید ترنسپورت خام، آث واقعی، رُتِر یا منطق کامل گیم پلی را اجرا کند.
وظیفه این فایل جدا کردن لاجیک پایه وضعیت بازی از فایل رُت های بازی است.
*/

export { GameStateService, createGameStateService, createEmptyGameRoomState };
