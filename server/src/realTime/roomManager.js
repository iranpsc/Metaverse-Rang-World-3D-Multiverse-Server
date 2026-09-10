// File => src/realTime/roomManager.js

import { registerPublicHealthRoomManager } from "../health/publicHealthWrapper.js";

//* این تابع شناسه کانکشن را از وَرَپِر، کانتکست یا آبجکت خام می خواند تا روم مَنِیجِر بتواند عضویت ها را ردیابی کند.
function readRoomConnectionId(connection) {
    return String(connection?.id ?? connection?.connectionId ?? connection?.context?.connectionId ?? connection?.socket?.id ?? connection?.remoteAddress ?? "");
}

//* این تابع کانتکست امن یک کانکشن روم را پیدا می کند تا روم مَنِیجِر بتواند عضویت منطقی userId را هم ردیابی کند.
function readRoomConnectionContext(connection) {
    return connection?.context ?? connection?.realtimeConnection?.context ?? null;
}

//* این تابع شناسه یوزر کانکشن را از کانتکست آث شده می خواند و به پِیلود کلاینت اعتماد نمی کند.
function readRoomConnectionUserId(connection) {
    const context = readRoomConnectionContext(connection);
    return String(context?.user?.id ?? context?.user?.userId ?? "").trim();
}

//* این تابع بررسی می کند که کانکشن هنوز باز است تا هنگام برادکست به کانکشن بسته شده پیام ارسال نشود.
function isRoomConnectionOpen(connection) {
    if (!connection) return false;
    if (typeof connection.isOpen === "function") return connection.isOpen();
    if (typeof connection.context?.connection?.isOpen === "function") return connection.context.connection.isOpen();
    if (typeof connection.readyState === "number") return connection.readyState === 1;
    if (typeof connection.socket?.readyState === "number") return connection.socket.readyState === 1;
    return true;
}

//* این تابع پیام را با توجه به نوع کانکشن ارسال می کند و خودش وارد رُتِر یا لاجیک بازی نمی شود.
function sendRoomMessage(connection, data) {
    if (!isRoomConnectionOpen(connection)) return false;
    if (typeof connection.sendRaw === "function" && typeof data === "string") return connection.sendRaw(data);
    if (typeof connection.sendEnvelope === "function" && data && typeof data === "object") return connection.sendEnvelope(data);
    if (typeof connection.sendRaw === "function") return connection.sendRaw(typeof data === "string" ? data : JSON.stringify(data));
    if (typeof connection.send === "function") { connection.send(data); return true; }
    if (typeof connection.socket?.send === "function") { connection.socket.send(data); return true; }
    return false;
}

class RoomManager {
    //* این سازنده نگاشت های اصلی روم را می سازد تا روم ها و عضویت هر کانکشن قابل مدیریت باشند.
    constructor() {
        this.rooms = new Map();
        this.roomsByConnectionId = new Map();

        //#region Phase 7.L - Public 3D Lobby

        //* این نگاشت فقط مشخصات روم های دائمی سیستمی را نگه می دارد و با عضویت کاربران قاطی نمی شود.
        this.permanentRoomDefinitions = new Map();

        //#endregion Phase 7.L - Public 3D Lobby

        //* این روم منیجر واقعی را فقط برای خواندن آمار عمومی به ورپر هلت معرفی می کند.
        registerPublicHealthRoomManager(this);
    }

    //#region Phase 7.L - Public 3D Lobby

    //* این تابع روم دائمی را در حافظه زنده ثبت می کند و اگر از قبل وجود داشته باشد همان نمونه را به روز می کند.
    registerPermanentRoom(roomId, options = {}) {
        const normalizedRoomId = String(roomId ?? "").trim();
        if (!normalizedRoomId) return null;

        const safeOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
        const parsedMaxPlayers = Number.parseInt(safeOptions.maxPlayers, 10);
        const existingDefinition = this.permanentRoomDefinitions.get(normalizedRoomId) ?? null;

        if (!this.rooms.has(normalizedRoomId)) this.rooms.set(normalizedRoomId, new Map());

        const definition = {
            roomId: normalizedRoomId,
            roomName: String(safeOptions.roomName ?? existingDefinition?.roomName ?? normalizedRoomId).trim() || normalizedRoomId,
            roomType: String(safeOptions.roomType ?? existingDefinition?.roomType ?? "system").trim() || "system",
            isPublic: safeOptions.isPublic === undefined ? existingDefinition?.isPublic === true : safeOptions.isPublic === true,
            isPermanent: true,
            autoCleanup: false,
            maxPlayers: Number.isInteger(parsedMaxPlayers) && parsedMaxPlayers > 0 ? parsedMaxPlayers : Number(existingDefinition?.maxPlayers ?? 0),
            metadata: {
                ...(existingDefinition?.metadata ?? {}),
                ...(safeOptions.metadata && typeof safeOptions.metadata === "object" && !Array.isArray(safeOptions.metadata) ? safeOptions.metadata : {})
            },
            registeredAt: existingDefinition?.registeredAt ?? Date.now(),
            updatedAt: Date.now()
        };

        this.permanentRoomDefinitions.set(normalizedRoomId, definition);

        return this.getRoomDefinition(normalizedRoomId);
    }

    //* این تابع مشخص می کند یک روم در حافظه زنده از نوع دائمی است یا خیر.
    isPermanentRoom(roomId) {
        return this.permanentRoomDefinitions.has(String(roomId ?? "").trim());
    }

    //* این تابع مشخصات امن یک روم دائمی را بر می گرداند تا کدهای دیگر به نگاشت داخلی دسترسی مستقیم نداشته باشند.
    getRoomDefinition(roomId) {
        const definition = this.permanentRoomDefinitions.get(String(roomId ?? "").trim());

        if (!definition) return null;

        return {
            ...definition,
            metadata: {
                ...(definition.metadata ?? {})
            }
        };
    }

    //* این تابع شناسه تمام روم های دائمی ثبت شده در حافظه زنده را بر می گرداند.
    getPermanentRoomIds() {
        return [...this.permanentRoomDefinitions.keys()];
    }

    //* این تابع یک روم را حذف می کند ولی بدون دستور اجباری اجازه حذف روم دائمی را نمی دهد.
    removeRoom(roomId, options = {}) {
        const normalizedRoomId = String(roomId ?? "").trim();

        if (!normalizedRoomId) return false;

        const force = options?.force === true;

        if (this.isPermanentRoom(normalizedRoomId) && !force) return false;

        const room = this.rooms.get(normalizedRoomId);

        if (room) {
            for (const [connectionId, connection] of room.entries()) {
                const connectionRooms = this.roomsByConnectionId.get(connectionId);

                if (connectionRooms) {
                    connectionRooms.delete(normalizedRoomId);

                    if (connectionRooms.size === 0)
                        this.roomsByConnectionId.delete(connectionId);
                }

                if (connection?.context?.roomId === normalizedRoomId)
                    connection.context.roomId = "";
            }
        }

        const removedRoom = this.rooms.delete(normalizedRoomId);
        const removedDefinition = force
            ? this.permanentRoomDefinitions.delete(normalizedRoomId)
            : false;

        return removedRoom || removedDefinition;
    }

    //#endregion Phase 7.L - Public 3D Lobby

    //* این تابع کانکشن را وارد روم می کند و عضویت کانکشن را در هر دو نگاشت روم و کانکشن ثبت می کند.
    join(roomId, connection) {
        const normalizedRoomId = String(roomId ?? "").trim();

        if (!normalizedRoomId || !connection) return false;

        const connectionId = readRoomConnectionId(connection);

        if (!connectionId) return false;

        if (!this.rooms.has(normalizedRoomId))
            this.rooms.set(normalizedRoomId, new Map());

        this.rooms.get(normalizedRoomId).set(connectionId, connection);

        if (!this.roomsByConnectionId.has(connectionId))
            this.roomsByConnectionId.set(connectionId, new Set());

        this.roomsByConnectionId.get(connectionId).add(normalizedRoomId);

        if (connection.context)
            connection.context.roomId = normalizedRoomId;

        return true;
    }

    //* این تابع بررسی می کند آیا یک userId از قبل در روم عضو است یا نه؛ برای idempotent کردن reconnect استفاده می شود.
    hasUser(roomId, userId, options = {}) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const normalizedUserId = String(userId ?? "").trim();

        if (!normalizedRoomId || !normalizedUserId) return false;

        const room = this.rooms.get(normalizedRoomId);

        if (!room) return false;

        const exceptConnectionId = options.exceptConnection
            ? readRoomConnectionId(options.exceptConnection)
            : String(options.exceptConnectionId ?? "");

        for (const [connectionId, connection] of [...room.entries()]) {
            if (exceptConnectionId && connectionId === exceptConnectionId) continue;

            if (!isRoomConnectionOpen(connection)) {
                this.leave(normalizedRoomId, connection);
                continue;
            }

            if (readRoomConnectionUserId(connection) === normalizedUserId)
                return true;
        }

        return false;
    }

    //* این تابع کانکشن های قدیمی همان userId را از روم حذف می کند تا reconnect باعث عضو تکراری و player_joined تکراری نشود.
    leaveConnectionsByUser(roomId, userId, options = {}) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const normalizedUserId = String(userId ?? "").trim();

        if (!normalizedRoomId || !normalizedUserId) return 0;

        const room = this.rooms.get(normalizedRoomId);

        if (!room) return 0;

        const exceptConnectionId = options.exceptConnection
            ? readRoomConnectionId(options.exceptConnection)
            : String(options.exceptConnectionId ?? "");

        let removed = 0;

        for (const [connectionId, connection] of [...room.entries()]) {
            if (exceptConnectionId && connectionId === exceptConnectionId) continue;
            if (readRoomConnectionUserId(connection) !== normalizedUserId) continue;

            if (this.leave(normalizedRoomId, connection))
                removed++;
        }

        return removed;
    }

    //* این تابع کانکشن را از یک روم مشخص خارج می کند و فقط روم های عادی خالی را حذف می کند.
    leave(roomId, connection) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const connectionId = readRoomConnectionId(connection);

        if (!normalizedRoomId || !connectionId) return false;

        const room = this.rooms.get(normalizedRoomId);

        if (!room) return false;

        const removed = room.delete(connectionId);

        //#region Phase 7.L - Public 3D Lobby

        //* روم دائمی حتی پس از خروج آخرین کاربر در حافظه زنده باقی می ماند.
        if (room.size === 0 && !this.isPermanentRoom(normalizedRoomId))
            this.rooms.delete(normalizedRoomId);

        //#endregion Phase 7.L - Public 3D Lobby

        const connectionRooms = this.roomsByConnectionId.get(connectionId);

        if (connectionRooms) {
            connectionRooms.delete(normalizedRoomId);

            if (connectionRooms.size === 0)
                this.roomsByConnectionId.delete(connectionId);
        }

        if (connection?.context?.roomId === normalizedRoomId)
            connection.context.roomId = "";

        return removed;
    }

    //* این تابع کانکشن را از همه روم هایی که عضو آن است خارج می کند و برای کلیناپ دیسکانکت استفاده می شود.
    leaveAll(connection) {
        const connectionId = readRoomConnectionId(connection);

        if (!connectionId) return 0;

        const roomIds = [...(this.roomsByConnectionId.get(connectionId) ?? [])];
        let removed = 0;

        for (const roomId of roomIds) {
            if (this.leave(roomId, connection))
                removed++;
        }

        return removed;
    }

    //* این تابع پیام را برای همه کانکشن های فعال داخل یک روم می فرستد و کانکشن های بسته شده را پاکسازی می کند.
    broadcast(roomId, data, options = {}) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const room = this.rooms.get(normalizedRoomId);

        if (!room) return 0;

        let sent = 0;

        const exceptConnectionId = options.exceptConnection
            ? readRoomConnectionId(options.exceptConnection)
            : String(options.exceptConnectionId ?? "");

        for (const [connectionId, connection] of [...room.entries()]) {
            if (exceptConnectionId && connectionId === exceptConnectionId) continue;

            if (!isRoomConnectionOpen(connection)) {
                this.leave(normalizedRoomId, connection);
                continue;
            }

            if (sendRoomMessage(connection, data))
                sent++;
        }

        return sent;
    }

    //* این تابع بررسی می کند که روم مشخص وجود دارد یا نه.
    hasRoom(roomId) {
        return this.rooms.has(String(roomId ?? "").trim());
    }

    //* این تابع بررسی می کند که کانکشن مشخص عضو روم مشخص هست یا نه.
    hasConnection(roomId, connection) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const connectionId = readRoomConnectionId(connection);

        return !!connectionId &&
            this.rooms.get(normalizedRoomId)?.has(connectionId) === true;
    }

    //* این تابع لیست کانکشن های فعال یک روم را برمی گرداند و کانکشن های بسته شده را همزمان پاکسازی می کند.
    getRoomConnections(roomId) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const room = this.rooms.get(normalizedRoomId);

        if (!room) return [];

        const result = [];

        for (const [connectionId, connection] of [...room.entries()]) {
            if (isRoomConnectionOpen(connection))
                result.push(connection);
            else
                this.leave(normalizedRoomId, connection);
        }

        return result;
    }

    //* این تابع لیست روم هایی را که کانکشن عضو آن هاست برمی گرداند.
    getConnectionRooms(connection) {
        const connectionId = readRoomConnectionId(connection);

        if (!connectionId) return [];

        return [...(this.roomsByConnectionId.get(connectionId) ?? [])];
    }

    //* این تابع تعداد کانکشن های داخل یک روم را برمی گرداند.
    getRoomSize(roomId) {
        return this.getRoomConnections(roomId).length;
    }

    //* این تابع تعداد userId های یکتای زنده داخل یک روم را برمی گرداند تا شمارنده آنلاین با reconnect باد نکند.
    getRoomUserCount(roomId) {
        const normalizedRoomId = String(roomId ?? "").trim();
        const room = this.rooms.get(normalizedRoomId);

        if (!room) return 0;

        const userIds = new Set();
        let anonymousConnections = 0;

        for (const [connectionId, connection] of [...room.entries()]) {
            if (!isRoomConnectionOpen(connection)) {
                this.leave(normalizedRoomId, connection);
                continue;
            }

            const userId = readRoomConnectionUserId(connection);

            if (userId)
                userIds.add(userId);
            else
                anonymousConnections++;
        }

        return userIds.size + anonymousConnections;
    }

    //* این تابع شناسه همه روم های موجود را برمی گرداند.
    getRoomIds() {
        return [...this.rooms.keys()];
    }

    //* این تابع تعداد کل روم های ثبت شده در حافظه زنده را برمی گرداند.
    count() {
        return this.rooms.size;
    }

    //* این تابع یک اسنپ شات امن از وضعیت روم ها می سازد تا برای لاگ، دیباگ و تست استفاده شود.
    getSnapshot() {
        const rooms = [...this.rooms.keys()].map((roomId) => {
            const definition = this.getRoomDefinition(roomId);
            const connectionCount = this.getRoomSize(roomId);

            return {
                roomId,
                roomName: definition?.roomName ?? roomId,
                roomType: definition?.roomType ?? "standard",
                isPublic: definition?.isPublic === true,
                isPermanent: definition?.isPermanent === true,
                autoCleanup: definition?.autoCleanup !== false,
                maxPlayers: Number(definition?.maxPlayers ?? 0),
                connectionCount,
                userCount: this.getRoomUserCount(roomId)
            };
        });

        return {
            //* برای سازگاری Health، این مقدار فقط روم های دارای کانکشن فعال را می شمارد.
            roomCount: rooms.filter((room) => room.connectionCount > 0).length,

            //* این مقدار همه روم های ثبت شده در حافظه، شامل لابی خالی دائمی را می شمارد.
            registeredRoomCount: rooms.length,

            permanentRoomCount: rooms.filter((room) => room.isPermanent).length,
            rooms
        };
    }

    //* این تابع همه روم ها و عضویت ها را پاک می کند و برای توقف سرور یا تست استفاده می شود.
    clear() {
        this.rooms.clear();
        this.roomsByConnectionId.clear();

        //#region Phase 7.L - Public 3D Lobby

        this.permanentRoomDefinitions.clear();

        //#endregion Phase 7.L - Public 3D Lobby
    }
}

/*
توضیح کلی اسکریپت:
این فایل روم مَنِیجِر ریل تایم سمت سرور را مدیریت می کند.
روم مَنِیجِر مشخص می کند هر کانکشن عضو کدام روم است و هر روم چه کانکشن هایی دارد.
تابع های قدیمی مانند جوین، لیو و برادکست حفظ شده اند تا کدهای قبلی نشکنند.
بخش مستقل فاز ۷.L روم های دائمی سیستمی مانند لابی عمومی سه بعدی را نگه می دارد.
روم دائمی بعد از خروج آخرین کاربر حذف نمی شود ولی روم های عادی رفتار قبلی خود را حفظ می کنند.
این فایل نباید آث واقعی، رُتِر، ترنسپورت خام یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط مدیریت عضویت روم ها و ارسال برادکست عمومی به اعضای روم است.
*/

export {
    RoomManager,
    readRoomConnectionId,
    readRoomConnectionUserId,
    isRoomConnectionOpen,
    sendRoomMessage
};
