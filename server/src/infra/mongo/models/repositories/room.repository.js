// File => src/infra/mongo/models/repositories/room.repository.js

import { RoomModel } from "../../models/room.model.js";

//* این تابع متن را برای ذخیره و نمایش استاندارد می کند.
function normalizeText(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}

//* این تابع کلید جستجوی نام روم را می سازد.
function normalizeRoomNameKey(roomName) {
    const normalized = normalizeText(roomName);

    if (!normalized) {
        return "";
    }

    return normalized.toLowerCase();
}

//* این تابع عدد ظرفیت روم را محدود و استاندارد می کند.
function normalizeMaxPlayers(maxPlayers) {
    const value = Number(maxPlayers);

    if (!Number.isFinite(value)) {
        return 20;
    }

    const fixed = Math.floor(value);

    if (fixed < 1) return 1;
    if (fixed > 100) return 100;

    return fixed;
}

//* این تابع تعداد آنلاین را محدود و استاندارد می کند.
function normalizeOnlineCount(onlineCount) {
    const value = Number(onlineCount);

    if (!Number.isFinite(value)) {
        return 0;
    }

    const fixed = Math.floor(value);

    return fixed < 0 ? 0 : fixed;
}

//#region Phase 7.L - Public 3D Lobby

//* این تابع متادیتای روم سیستمی را فقط در صورت آبجکت معتبر بودن می پذیرد.
function normalizeRoomMetadata(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
    return { ...metadata };
}

//#endregion Phase 7.L - Public 3D Lobby

//* این تابع خروجی خام مونگو را به خروجی ثابت روم تبدیل می کند.
function mapRoomDocument(doc) {
    if (!doc) {
        return null;
    }

    const createdAt = doc.createdAt ?? null;
    const updatedAt = doc.updatedAt ?? null;
    const lastActiveAt = doc.lastActiveAt ?? null;
    const closedAt = doc.closedAt ?? null;

    return {
        roomId: doc.roomId ?? "",
        roomName: doc.roomName ?? "",
        roomNameKey: doc.roomNameKey ?? "",
        description: doc.description ?? "",
        ownerUserId: doc.ownerUserId ?? "",
        ownerUserName: doc.ownerUserName ?? "",
        visibility: doc.visibility ?? "public",
        status: doc.status ?? "open",
        maxPlayers: Number(doc.maxPlayers ?? 20),
        onlineCount: Number(doc.onlineCount ?? 0),
        createdAt,
        updatedAt,
        lastActiveAt,
        closedAt,
        createdAtUnix: createdAt ? Math.floor(new Date(createdAt).getTime() / 1000) : 0,
        updatedAtUnix: updatedAt ? Math.floor(new Date(updatedAt).getTime() / 1000) : 0,
        lastActiveAtUnix: lastActiveAt ? Math.floor(new Date(lastActiveAt).getTime() / 1000) : 0,
        closedAtUnix: closedAt ? Math.floor(new Date(closedAt).getTime() / 1000) : 0,
        metadata: doc.metadata ?? {}
    };
}

//* این تابع نتیجه آپدیت مونگو را به خروجی ثابت تبدیل می کند.
function mapUpdateResult(result) {
    if (!result) {
        return {
            acknowledged: false,
            matchedCount: 0,
            modifiedCount: 0
        };
    }

    return {
        acknowledged: result.acknowledged ?? true,
        matchedCount: result.matchedCount ?? 0,
        modifiedCount: result.modifiedCount ?? 0
    };
}

//* این کلاس فقط عملیات دیتابیس مربوط به روم را انجام می دهد.
export class RoomRepository {
    //#region Phase 7.L - Public 3D Lobby

    //* این تابع روم سیستمی ثابت را در دیتابیس ایجاد یا با مشخصات رسمی به روز می کند و هرگز نمونه تکراری نمی سازد.
    async upsertSystemRoom({
        roomId,
        roomName,
        description = "",
        ownerUserId,
        ownerUserName,
        visibility = "public",
        maxPlayers = 20,
        metadata = {}
    }) {
        const normalizedRoomId = normalizeText(roomId);
        const normalizedRoomName = normalizeText(roomName);
        const normalizedRoomNameKey = normalizeRoomNameKey(normalizedRoomName);
        const normalizedDescription = normalizeText(description);
        const normalizedOwnerUserId = normalizeText(ownerUserId);
        const normalizedOwnerUserName = normalizeText(ownerUserName);
        const normalizedVisibility = visibility === "private" ? "private" : "public";
        const normalizedMaxPlayers = normalizeMaxPlayers(maxPlayers);
        const normalizedMetadata = normalizeRoomMetadata(metadata);
        const now = new Date();

        const room = await RoomModel.findOneAndUpdate(
            { roomId: normalizedRoomId },
            {
                $set: {
                    roomName: normalizedRoomName,
                    roomNameKey: normalizedRoomNameKey,
                    description: normalizedDescription,
                    ownerUserId: normalizedOwnerUserId,
                    ownerUserName: normalizedOwnerUserName,
                    visibility: normalizedVisibility,
                    status: "empty",
                    maxPlayers: normalizedMaxPlayers,
                    onlineCount: 0,
                    updatedAt: now,
                    lastActiveAt: now,
                    closedAt: null,
                    metadata: normalizedMetadata
                },
                $setOnInsert: {
                    roomId: normalizedRoomId,
                    createdAt: now
                }
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert: true
            }
        ).lean();

        return mapRoomDocument(room);
    }

    //#endregion Phase 7.L - Public 3D Lobby

    //* ساخت روم جدید در دیتابیس.
    async createRoom({
        roomId,
        roomName,
        description = "",
        ownerUserId,
        ownerUserName,
        visibility = "public",
        maxPlayers = 20,
        metadata = {}
    }) {
        const normalizedRoomName = normalizeText(roomName);
        const normalizedRoomNameKey = normalizeRoomNameKey(normalizedRoomName);
        const normalizedDescription = normalizeText(description);
        const normalizedOwnerUserId = normalizeText(ownerUserId);
        const normalizedOwnerUserName = normalizeText(ownerUserName);
        const normalizedVisibility = visibility === "private" ? "private" : "public";
        const normalizedMaxPlayers = normalizeMaxPlayers(maxPlayers);
        const now = new Date();

        const created = await RoomModel.create({
            roomId: normalizeText(roomId),
            roomName: normalizedRoomName,
            roomNameKey: normalizedRoomNameKey,
            description: normalizedDescription,
            ownerUserId: normalizedOwnerUserId,
            ownerUserName: normalizedOwnerUserName,
            visibility: normalizedVisibility,
            status: "open",
            maxPlayers: normalizedMaxPlayers,
            onlineCount: 0,
            createdAt: now,
            updatedAt: now,
            lastActiveAt: now,
            closedAt: null,
            metadata
        });

        return mapRoomDocument(created.toObject ? created.toObject() : created);
    }

    //* پیدا کردن روم با شناسه روم.
    async findRoomById(roomId) {
        const doc = await RoomModel.findOne({
            roomId: normalizeText(roomId)
        }).lean();

        return mapRoomDocument(doc);
    }

    //* خواندن لیست روم های قابل نمایش.
    async listOpenRooms({ limit = 50, skip = 0, visibility = "public" } = {}) {
        const fixedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
        const fixedSkip = Math.max(Number(skip) || 0, 0);
        const normalizedVisibility = visibility === "private" ? "private" : "public";

        const docs = await RoomModel.find({
            visibility: normalizedVisibility,
            status: { $in: ["open", "full", "empty"] },

            //#region Phase 7.L - Public 3D Lobby

            "metadata.excludeFromRoomList": { $ne: true }

            //#endregion Phase 7.L - Public 3D Lobby
        })
            .sort({ lastActiveAt: -1, createdAt: -1 })
            .skip(fixedSkip)
            .limit(fixedLimit)
            .lean();

        return docs.map(mapRoomDocument);
    }

    //* آپدیت وضعیت روم.
    async updateRoomStatus(roomId, status) {
        const allowedStatus = ["open", "full", "empty", "closed"];

        if (!allowedStatus.includes(status)) {
            return {
                acknowledged: false,
                matchedCount: 0,
                modifiedCount: 0
            };
        }

        const update = {
            status,
            updatedAt: new Date()
        };

        if (status === "closed") {
            update.closedAt = new Date();
        }

        const result = await RoomModel.updateOne(
            { roomId: normalizeText(roomId) },
            { $set: update }
        );

        return mapUpdateResult(result);
    }

    //* آپدیت تعداد آنلاین روم.
    async updateOnlineCount(roomId, onlineCount) {
        const fixedOnlineCount = normalizeOnlineCount(onlineCount);

        const result = await RoomModel.updateOne(
            { roomId: normalizeText(roomId) },
            {
                $set: {
                    onlineCount: fixedOnlineCount,
                    updatedAt: new Date(),
                    lastActiveAt: new Date()
                }
            }
        );

        return mapUpdateResult(result);
    }

    //* آپدیت زمان فعالیت آخر روم.
    async touchRoom(roomId) {
        const result = await RoomModel.updateOne(
            { roomId: normalizeText(roomId) },
            {
                $set: {
                    updatedAt: new Date(),
                    lastActiveAt: new Date()
                }
            }
        );

        return mapUpdateResult(result);
    }

    //* بستن روم.
    async closeRoom(roomId) {
        const now = new Date();

        const result = await RoomModel.updateOne(
            { roomId: normalizeText(roomId) },
            {
                $set: {
                    status: "closed",
                    updatedAt: now,
                    lastActiveAt: now,
                    closedAt: now
                }
            }
        );

        return mapUpdateResult(result);
    }
}