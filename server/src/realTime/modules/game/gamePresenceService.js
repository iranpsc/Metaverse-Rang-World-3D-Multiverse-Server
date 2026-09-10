// File => src/realTime/modules/game/gamePresenceService.js

import { Channels } from "../../protocol/channels.js";
import { MessageTypes } from "../../protocol/messageTypes.js";
import { makeEnvelope } from "../../protocol/envelope.js";
import { readGameRoomIdFromEnvelope, readGameUserIdFromContext, requireGameRoomManager } from "./gameRoomService.js";

//* این تابع مقدار متنی را برای شناسه ها استاندارد می کند تا کلیدهای مپ وضعیت پلیر یکدست باشند.
function normalizePresenceText(value) {
    return String(value ?? "").trim();
}

//* این تابع کانتکست یک کانکشن ذخیره شده در روم را پیدا می کند تا اطلاعات یوزر از منبع امن خوانده شود.
function readPresenceContextFromConnection(connection) {
    return connection?.context ?? connection?.realtimeConnection?.context ?? null;
}

//* این تابع شناسه کانکشن را از کانکشن ریل تایم می خواند تا اعضای روم در اسنپ شات قابل ردیابی باشند.
function readPresenceConnectionIdFromConnection(connection) {
    const context = readPresenceContextFromConnection(connection);
    return normalizePresenceText(connection?.id ?? connection?.connectionId ?? context?.connectionId ?? "");
}

//* این تابع شناسه یوزر را از کانکشن عضو روم می خواند و به پِیلود کلاینت اعتماد نمی کند.
function readPresenceUserIdFromConnection(connection) {
    const context = readPresenceContextFromConnection(connection);
    return normalizePresenceText(context?.user?.userId ?? context?.user?.id ?? "");
}

//* این تابع نام یوزر را از کانکشن عضو روم می خواند تا کلاینت بتواند کلون ها را با نام درست نمایش دهد.
function readPresenceUserNameFromConnection(connection) {
    const context = readPresenceContextFromConnection(connection);
    return normalizePresenceText(context?.user?.userName ?? context?.user?.email ?? context?.user?.userId ?? context?.user?.id ?? "");
}

//* این تابع نوع ترنسپورت کانکشن را می خواند تا بعداً وب سوکت، جی آر پی سی یا یو دی پی در اسنپ شات قابل تشخیص باشند.
function readPresenceTransportKindFromConnection(connection) {
    const context = readPresenceContextFromConnection(connection);
    return normalizePresenceText(context?.transportKind ?? connection?.kind ?? "unknown");
}

//* این تابع دیتای حرکتی پلیر را از اِنولوپ می خواند و برای وب سوکت فعلی یا یو دی پی آینده قرارداد را یکسان نگه می دارد.
function readPlayerStateDataFromEnvelope(envelope) {
    const payload = envelope?.payload ?? null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    if (Object.prototype.hasOwnProperty.call(payload, "data")) return payload.data;
    if (Object.prototype.hasOwnProperty.call(payload, "state")) return payload.state;
    return payload;
}



class GamePresenceService {
    //* این سازنده وابستگی های سرویس پرزنس بازی را نگه می دارد و خودش کانکشن یا ترنسپورت نمی سازد.
    constructor({ rooms = null, logger = null } = {}) {
        this.rooms = rooms;
        this.logger = logger;
        this.lastPlayerStateByRoom = new Map();
    }

    //* این تابع روم مَنِیجِر فعال را از سرویس یا کانتکست پیدا می کند تا پرزنس در روم درست پخش شود.
    getRooms(ctx) {
        return requireGameRoomManager(this.rooms ?? ctx?.rooms);
    }


    //* این تابع مپ وضعیت های ذخیره شده یک روم را می خواند و در صورت نیاز آن را می سازد.
    getRoomStateMap(roomId, createIfMissing = false) {
        const normalizedRoomId = normalizePresenceText(roomId);
        if (!normalizedRoomId) return null;
        if (!this.lastPlayerStateByRoom.has(normalizedRoomId) && createIfMissing) this.lastPlayerStateByRoom.set(normalizedRoomId, new Map());
        return this.lastPlayerStateByRoom.get(normalizedRoomId) ?? null;
    }

    //* این تابع آخرین وضعیت پلیر را مستقل از نوع ترنسپورت ذخیره می کند تا بعداً یو دی پی هم از همین قرارداد استفاده کند.
    savePlayerState(roomId, userId, state, meta = {}) {
        const normalizedRoomId = normalizePresenceText(roomId);
        const normalizedUserId = normalizePresenceText(userId);
        if (!normalizedRoomId || !normalizedUserId) return null;

        const storedState = {
            roomId: normalizedRoomId,
            userId: normalizedUserId,
            userName: normalizePresenceText(meta.userName),
            connectionId: normalizePresenceText(meta.connectionId),
            transportKind: normalizePresenceText(meta.transportKind || "unknown"),
            data: state ?? null,
            state: state ?? null,
            ts: Number(meta.ts ?? Date.now()),
            receivedAt: Date.now()
        };

        this.getRoomStateMap(normalizedRoomId, true).set(normalizedUserId, storedState);
        return storedState;
    }

    //* این تابع آخرین وضعیت پلیر را از اِنولوپ فعلی ذخیره می کند و به وب سوکت وابسته نیست.
    savePlayerStateFromEnvelope(ctx, envelope, roomIdOverride = "") {
        const roomId = normalizePresenceText(roomIdOverride || readGameRoomIdFromEnvelope(envelope, ctx?.roomId));
        const userId = readGameUserIdFromContext(ctx);
        const state = readPlayerStateDataFromEnvelope(envelope);

        return this.savePlayerState(roomId, userId, state, {
            userName: ctx?.user?.userName ?? ctx?.user?.email ?? userId,
            connectionId: ctx?.connectionId ?? "",
            transportKind: ctx?.transportKind ?? "unknown",
            ts: envelope?.ts ?? Date.now()
        });
    }

    //* این تابع آخرین وضعیت ذخیره شده یک پلیر را در یک روم برمی گرداند.
    getPlayerState(roomId, userId) {
        const roomStates = this.getRoomStateMap(roomId, false);
        return roomStates?.get(normalizePresenceText(userId)) ?? null;
    }

    //* این تابع آخرین وضعیت همه پلیرهای یک روم را برمی گرداند.
    getRoomPlayerStates(roomId) {
        const roomStates = this.getRoomStateMap(roomId, false);
        return roomStates ? [...roomStates.values()] : [];
    }

    //* این تابع وضعیت ذخیره شده یک پلیر را هنگام خروج یا دیسکانکت پاک می کند.
    clearPlayerState(roomId, userId) {
        const normalizedRoomId = normalizePresenceText(roomId);
        const normalizedUserId = normalizePresenceText(userId);
        const roomStates = this.getRoomStateMap(normalizedRoomId, false);
        if (!roomStates || !normalizedUserId) return false;

        const removed = roomStates.delete(normalizedUserId);
        if (roomStates.size === 0) this.lastPlayerStateByRoom.delete(normalizedRoomId);
        return removed;
    }

    //* این تابع وضعیت ذخیره شده یوزر فعلی را از روم مشخص پاک می کند.
    clearPlayerStateForContext(ctx, roomIdOverride = "") {
        const roomId = normalizePresenceText(roomIdOverride || ctx?.roomId);
        const userId = readGameUserIdFromContext(ctx);
        return this.clearPlayerState(roomId, userId);
    }







    //* این تابع پِیلود امن پرزنس را از کانتکست و اِنولوپ می سازد تا اطلاعات حساس منتشر نشود.
    makePresencePayload(ctx, envelope, extra = {}) {
        return {
            userId: readGameUserIdFromContext(ctx),
            userName: normalizePresenceText(ctx?.user?.userName ?? ctx?.user?.email ?? readGameUserIdFromContext(ctx)),
            connectionId: ctx?.connectionId ?? "",
            roomId: readGameRoomIdFromEnvelope(envelope, ctx?.roomId),
            data: readPlayerStateDataFromEnvelope(envelope),
            ...extra
        };
    }

    //* این تابع پیام پرزنس استاندارد می سازد تا ورود، خروج و وضعیت پلیر با یک قالب ارسال شود.
    makePresenceEnvelope(ctx, envelope, type, extra = {}) {
        return makeEnvelope({
            ch: Channels.presence,
            t: type,
            room: readGameRoomIdFromEnvelope(envelope, ctx?.roomId),
            payload: this.makePresencePayload(ctx, envelope, extra),
            replyTo: envelope?.id ?? ""
        });
    }


    //* این تابع از کانکشن عضو روم، مدل امن member می سازد تا در اسنپ شات به درخواست کننده ارسال شود.
    makeRoomMemberSnapshot(connection, roomId, requesterUserId = "") {
        const userId = readPresenceUserIdFromConnection(connection);
        if (!userId) return null;

        return {
            roomId: normalizePresenceText(roomId),
            userId,
            userName: readPresenceUserNameFromConnection(connection),
            connectionId: readPresenceConnectionIdFromConnection(connection),
            transportKind: readPresenceTransportKindFromConnection(connection),
            isSelf: userId === normalizePresenceText(requesterUserId)
        };
    }

    //* این تابع اسنپ شات اعضای زنده روم را همراه آخرین وضعیت های حرکتی ذخیره شده می سازد.
    getRoomMembersSnapshot(ctx, envelope) {
        const rooms = this.getRooms(ctx);
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        const requesterUserId = readGameUserIdFromContext(ctx);
        const connections = typeof rooms.getRoomConnections === "function" ? rooms.getRoomConnections(roomId) : [];
        const members = connections.map((connection) => this.makeRoomMemberSnapshot(connection, roomId, requesterUserId)).filter(Boolean);
        const liveUserIds = new Set(members.map((member) => member.userId));
        const states = this.getRoomPlayerStates(roomId).filter((state) => liveUserIds.has(state.userId));

        return {
            roomId,
            requesterUserId,
            requesterConnectionId: ctx?.connectionId ?? "",
            members,
            states,
            memberCount: members.length,
            stateCount: states.length,
            ts: Date.now()
        };
    }

    //* این تابع اِنولوپ اسنپ شات اعضای روم را می سازد تا فقط برای درخواست کننده ارسال شود.
    makeRoomMembersSnapshotEnvelope(ctx, envelope) {
        const snapshot = this.getRoomMembersSnapshot(ctx, envelope);
        return makeEnvelope({
            ch: Channels.presence,
            t: MessageTypes.presence.roomMembersSnapshot,
            room: snapshot.roomId,
            payload: snapshot,
            replyTo: envelope?.id ?? ""
        });
    }

    //* این تابع اسنپ شات اعضای روم را فقط برای همان کانکشن درخواست کننده ارسال می کند.
    sendRoomMembersSnapshot(ctx, envelope) {
        const snapshotEnvelope = this.makeRoomMembersSnapshotEnvelope(ctx, envelope);
        const sent = ctx?.realtimeConnection?.sendEnvelope?.(snapshotEnvelope) === true ? 1 : 0;

        this.logger?.info?.("Game presence room members snapshot sent", {
            roomId: snapshotEnvelope.room,
            userId: readGameUserIdFromContext(ctx),
            memberCount: snapshotEnvelope.payload?.memberCount ?? 0,
            stateCount: snapshotEnvelope.payload?.stateCount ?? 0,
            sent
        });

        return { ...snapshotEnvelope.payload, sent };
    }




    //* این تابع ورود پلیر به روم را برای بقیه اعضای روم برادکست می کند.
    broadcastPlayerJoined(ctx, envelope) {
        const rooms = this.getRooms(ctx);
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        const presenceEnvelope = this.makePresenceEnvelope(ctx, envelope, MessageTypes.presence.playerJoined);
        const sent = rooms.broadcast(roomId, presenceEnvelope, { exceptConnection: ctx?.realtimeConnection }) ?? 0;
        this.logger?.info?.("Game presence player joined", { roomId, sent, userId: readGameUserIdFromContext(ctx) });
        return { roomId, sent };
    }

    //* این تابع خروج پلیر از روم را برای بقیه اعضای روم برادکست می کند و آخرین وضعیت حرکتی او را پاک می کند.
    broadcastPlayerLeft(ctx, envelope, roomIdOverride = "") {
        const rooms = this.getRooms(ctx);
        const roomId = normalizePresenceText(roomIdOverride || readGameRoomIdFromEnvelope(envelope, ctx?.roomId));
        const clearedState = this.clearPlayerStateForContext(ctx, roomId);
        const presenceEnvelope = this.makePresenceEnvelope(ctx, { ...envelope, room: roomId }, MessageTypes.presence.playerLeft, { clearedState });
        const sent = rooms.broadcast(roomId, presenceEnvelope, { exceptConnection: ctx?.realtimeConnection }) ?? 0;
        this.logger?.info?.("Game presence player left", { roomId, sent, clearedState, userId: readGameUserIdFromContext(ctx) });
        return { roomId, sent, clearedState };
    }

    //* این تابع وضعیت پلیر را ذخیره و برای اعضای روم برادکست می کند تا کلاینت ها موقعیت یا وضعیت همدیگر را ببینند.
    broadcastPlayerState(ctx, envelope) {
        const rooms = this.getRooms(ctx);
        const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);
        const savedState = this.savePlayerStateFromEnvelope(ctx, envelope, roomId);
        const presenceEnvelope = this.makePresenceEnvelope(ctx, envelope, MessageTypes.presence.playerState, {
            state: savedState?.state ?? null,
            receivedAt: savedState?.receivedAt ?? Date.now()
        });
        const sent = rooms.broadcast(roomId, presenceEnvelope, { exceptConnection: ctx?.realtimeConnection }) ?? 0;
        return { roomId, sent, stateSaved: !!savedState, userId: readGameUserIdFromContext(ctx) };
    }
}

//* این تابع سرویس پرزنس بازی را می سازد تا ساخت سرویس در بوت استرپ و رُت ها یکدست باشد.
function createGamePresenceService(options = {}) {
    return new GamePresenceService(options);
}

/*
توضیح کلی اسکریپت:
این فایل سرویس پرزنس بازی را مدیریت می کند.
پرزنس یعنی پیام هایی که حضور، خروج و وضعیت پلیر را به اعضای روم خبر می دهند.
این فایل پیام های پرزنس را با اِنولوپ استاندارد می سازد و به روم مربوطه برادکست می کند.
این فایل نباید ترنسپورت خام، آث واقعی، رُتِر یا لاجیک سنگین بازی را اجرا کند.
وظیفه این فایل جدا کردن لاجیک پرزنس بازی از رُت های بازی است.
*/

export { GamePresenceService, createGamePresenceService };
