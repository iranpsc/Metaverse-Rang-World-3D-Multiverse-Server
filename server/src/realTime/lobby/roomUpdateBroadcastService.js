// File => src/realTime/lobby/roomUpdateBroadcastService.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeEnvelope } from "../protocol/envelope.js";

function normalizeRoomUpdatePayload(room) {
    if (!room || typeof room !== "object") {
        return null;
    }

    return {
        roomId: String(room.roomId ?? ""),
        roomName: String(room.roomName ?? ""),
        roomNameKey: String(room.roomNameKey ?? ""),
        description: String(room.description ?? ""),
        ownerUserId: String(room.ownerUserId ?? ""),
        ownerUserName: String(room.ownerUserName ?? ""),
        visibility: String(room.visibility ?? "public"),
        status: String(room.status ?? "open"),
        maxPlayers: Number(room.maxPlayers ?? 20),
        onlineCount: Number(room.onlineCount ?? 0),
        createdAt: room.createdAt ?? null,
        updatedAt: room.updatedAt ?? null,
        lastActiveAt: room.lastActiveAt ?? null,
        closedAt: room.closedAt ?? null,
        createdAtUnix: Number(room.createdAtUnix ?? 0),
        updatedAtUnix: Number(room.updatedAtUnix ?? 0),
        lastActiveAtUnix: Number(room.lastActiveAtUnix ?? 0),
        closedAtUnix: Number(room.closedAtUnix ?? 0),
        metadata: room.metadata ?? {}
    };
}

function makeRoomUpdatedEnvelope(room, { source = "" } = {}) {
    const payload = normalizeRoomUpdatePayload(room);
    if (!payload?.roomId) return null;

    return makeEnvelope({
        ch: Channels.lobby,
        t: MessageTypes.lobby.roomUpdated,
        room: payload.roomId,
        payload: {
            ...payload,
            room: payload,
            source: String(source ?? "")
        }
    });
}

function broadcastRoomUpdatedToRealtimeRoom(ctx, room, { source = "", logger = null } = {}) {
    const envelope = makeRoomUpdatedEnvelope(room, { source });
    const roomId = envelope?.room ?? "";

    if (!envelope || !roomId || typeof ctx?.rooms?.broadcast !== "function") {
        logger?.warn?.("Lobby room_updated broadcast skipped", {
            roomId,
            source,
            hasRoom: Boolean(room),
            hasRoomsBroadcast: typeof ctx?.rooms?.broadcast === "function"
        });

        return {
            ok: false,
            roomId,
            sent: 0,
            source
        };
    }

    const sent = ctx.rooms.broadcast(roomId, envelope) ?? 0;

    logger?.info?.("Lobby room_updated broadcast sent", {
        roomId,
        source,
        sent,
        onlineCount: envelope.payload?.onlineCount ?? 0,
        status: envelope.payload?.status ?? ""
    });

    return {
        ok: true,
        roomId,
        sent,
        source,
        onlineCount: envelope.payload?.onlineCount ?? 0,
        status: envelope.payload?.status ?? ""
    };
}

export {
    normalizeRoomUpdatePayload,
    makeRoomUpdatedEnvelope,
    broadcastRoomUpdatedToRealtimeRoom
};
