// File => src/realTime/protocol/messageTypes.js

const MessageTypes = Object.freeze({
    system: Object.freeze({
        auth: "auth",
        authOk: "auth_ok",
        authFailed: "auth_failed",
        ping: "ping",
        pong: "pong",
        ack: "ack",
        error: "error"
    }),

    presence: Object.freeze({
        playerState: "player_state",
        playerJoined: "player_joined",
        playerLeft: "player_left",
        roomMembersRequest: "room_members_request",
        roomMembersSnapshot: "room_members_snapshot"
    }),

    game: Object.freeze({
        joinRoom: "join_room",
        leaveRoom: "leave_room",
        playerAction: "player_action",
        worldEvent: "world_event"
    }),

    lobby: Object.freeze({
        createRoom: "create_room",
        listRooms: "list_rooms",
        roomCreated: "room_created",
        roomUpdated: "room_updated",
        roomClosed: "room_closed"
    }),

    world: Object.freeze({
        objectSpawn: "object_spawn",
        objectUpdate: "object_update",
        objectDespawn: "object_despawn"
    }),

    chat: Object.freeze({
        message: "message",
        typing: "typing",
        read: "read"
    }),

    voice: Object.freeze({
        mute: "mute",
        unmute: "unmute"
    }),

    npc: Object.freeze({
        dialogue: "dialogue",
        action: "action"
    })
});

function isValidMessageType(channel, type) {
    if (!channel || !type) return false;
    const group = MessageTypes[channel];
    if (!group) return false;
    return Object.values(group).includes(type);
}

export { MessageTypes, isValidMessageType };
