// مسیر فایل: src/voice/tests/voiceRealtimeMembershipAdapter.test.js

import assert from "node:assert/strict";

import {
    ClientsRegistry
} from "../../realTime/clientsRegistry.js";

import {
    RoomManager
} from "../../realTime/roomManager.js";

import {
    RealtimeContextState
} from "../../realTime/core/realtimeContext.js";

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

import {
    VoiceRealtimeMembershipAdapter
} from "../adapters/voiceRealtimeMembershipAdapter.js";

const userId =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const secondUserId =
    "80c686cf-d8ca-4c15-9f85-5f503a14f21a";

const roomId =
    "room_voice_membership_test";

const otherRoomId =
    "room_voice_other_test";

const registry =
    new ClientsRegistry();

const rooms =
    new RoomManager();

const adapter =
    new VoiceRealtimeMembershipAdapter({
        registry,
        rooms
    });

const firstConnection = {
    id: "rt_test_first",
    readyState: 1,
    context: {
        connectionId: "rt_test_first",
        state:
            RealtimeContextState.authenticated,
        transportKind: "websocket",
        roomId: "",
        user: {
            id: userId,
            userId
        }
    }
};

const secondConnection = {
    id: "rt_test_second",
    readyState: 1,
    context: {
        connectionId: "rt_test_second",
        state:
            RealtimeContextState.authenticated,
        transportKind: "grpc",
        roomId: "",
        user: {
            id: userId,
            userId
        }
    }
};

registry.addConnection(
    firstConnection,
    userId
);

registry.addConnection(
    secondConnection,
    userId
);

rooms.join(
    otherRoomId,
    firstConnection
);

rooms.join(
    roomId,
    secondConnection
);

const validResult =
    adapter.verify({
        userId,
        roomId
    });

assert.equal(
    validResult.success,
    true
);

assert.equal(
    validResult.retryable,
    false
);

assert.equal(
    validResult.code,
    VoiceAuthResultCode.AUTHENTICATED
);

assert.equal(
    validResult.userId,
    userId
);

assert.equal(
    validResult.roomId,
    roomId
);

assert.equal(
    validResult.realtimeConnectionId,
    "rt_test_second"
);

assert.equal(
    validResult.transportKind,
    "grpc"
);

assert.equal(
    validResult.realtimeConnection,
    secondConnection
);

assert.equal(
    Object.isFrozen(validResult),
    true
);

const missingRoomResult =
    adapter.verify({
        userId,
        roomId: "room_not_joined"
    });

assert.equal(
    missingRoomResult.success,
    false
);

assert.equal(
    missingRoomResult.retryable,
    true
);

assert.equal(
    missingRoomResult.code,
    VoiceAuthResultCode.ROOM_NOT_JOINED
);

const emptyRegistry =
    new ClientsRegistry();

const emptyRooms =
    new RoomManager();

const emptyAdapter =
    new VoiceRealtimeMembershipAdapter({
        registry: emptyRegistry,
        rooms: emptyRooms
    });

const missingRealtimeResult =
    emptyAdapter.verify({
        userId,
        roomId
    });

assert.equal(
    missingRealtimeResult.success,
    false
);

assert.equal(
    missingRealtimeResult.retryable,
    true
);

assert.equal(
    missingRealtimeResult.code,
    VoiceAuthResultCode
        .REALTIME_NOT_READY
);

const unauthenticatedRegistry =
    new ClientsRegistry();

const unauthenticatedRooms =
    new RoomManager();

const unauthenticatedConnection = {
    id: "rt_test_unauthenticated",
    readyState: 1,
    context: {
        connectionId:
            "rt_test_unauthenticated",
        state:
            RealtimeContextState.connected,
        transportKind: "websocket",
        roomId: "",
        user: {
            id: userId,
            userId
        }
    }
};

unauthenticatedRegistry.addConnection(
    unauthenticatedConnection,
    userId
);

unauthenticatedRooms.join(
    roomId,
    unauthenticatedConnection
);

const unauthenticatedAdapter =
    new VoiceRealtimeMembershipAdapter({
        registry:
            unauthenticatedRegistry,
        rooms:
            unauthenticatedRooms
    });

const unauthenticatedResult =
    unauthenticatedAdapter.verify({
        userId,
        roomId
    });

assert.equal(
    unauthenticatedResult.success,
    false
);

assert.equal(
    unauthenticatedResult.code,
    VoiceAuthResultCode
        .REALTIME_NOT_READY
);

const closedRegistry =
    new ClientsRegistry();

const closedRooms =
    new RoomManager();

const closedConnection = {
    id: "rt_test_closed",
    readyState: 3,
    context: {
        connectionId: "rt_test_closed",
        state:
            RealtimeContextState.authenticated,
        transportKind: "websocket",
        roomId,
        user: {
            id: userId,
            userId
        }
    }
};

closedRegistry.addConnection(
    closedConnection,
    userId
);

closedRooms.join(
    roomId,
    closedConnection
);

const closedAdapter =
    new VoiceRealtimeMembershipAdapter({
        registry: closedRegistry,
        rooms: closedRooms
    });

const closedResult =
    closedAdapter.verify({
        userId,
        roomId
    });

assert.equal(
    closedResult.success,
    false
);

assert.equal(
    closedResult.code,
    VoiceAuthResultCode
        .REALTIME_NOT_READY
);

assert.equal(
    closedRegistry.getAll(userId).length,
    0
);

const differentUserRegistry =
    new ClientsRegistry();

const differentUserRooms =
    new RoomManager();

const requestedUserConnection = {
    id: "rt_test_requested_user",
    readyState: 1,
    context: {
        connectionId:
            "rt_test_requested_user",
        state:
            RealtimeContextState.authenticated,
        transportKind: "websocket",
        roomId: otherRoomId,
        user: {
            id: userId,
            userId
        }
    }
};

const differentUserConnection = {
    id: "rt_test_different_user",
    readyState: 1,
    context: {
        connectionId:
            "rt_test_different_user",
        state:
            RealtimeContextState.authenticated,
        transportKind: "grpc",
        roomId,
        user: {
            id: secondUserId,
            userId: secondUserId
        }
    }
};

differentUserRegistry.addConnection(
    requestedUserConnection,
    userId
);

differentUserRegistry.addConnection(
    differentUserConnection,
    secondUserId
);

differentUserRooms.join(
    otherRoomId,
    requestedUserConnection
);

differentUserRooms.join(
    roomId,
    differentUserConnection
);

const differentUserAdapter =
    new VoiceRealtimeMembershipAdapter({
        registry:
            differentUserRegistry,
        rooms:
            differentUserRooms
    });

const differentUserResult =
    differentUserAdapter.verify({
        userId,
        roomId
    });

assert.equal(
    differentUserResult.success,
    false
);

assert.equal(
    differentUserResult.code,
    VoiceAuthResultCode.ROOM_NOT_JOINED
);

const invalidPayloadResult =
    adapter.verify({
        userId: "",
        roomId
    });

assert.equal(
    invalidPayloadResult.success,
    false
);

assert.equal(
    invalidPayloadResult.retryable,
    false
);

assert.equal(
    invalidPayloadResult.code,
    VoiceAuthResultCode.INVALID_PAYLOAD
);

let invalidRegistryError = null;

try {
    new VoiceRealtimeMembershipAdapter({
        registry: {},
        rooms
    });
} catch (error) {
    invalidRegistryError = error;
}

assert.match(
    invalidRegistryError?.message ?? "",
    /registry must provide getAll/
);

let invalidRoomsError = null;

try {
    new VoiceRealtimeMembershipAdapter({
        registry,
        rooms: {}
    });
} catch (error) {
    invalidRoomsError = error;
}

assert.match(
    invalidRoomsError?.message ?? "",
    /rooms must provide hasConnection/
);

console.log(
    "VOICE_V2_3_1_REALTIME_MEMBERSHIP_ADAPTER_TEST=OK"
);

/*
توضیح فایل:
این فایل اتصال فعال، اتصال احرازنشده، اتصال بسته‌شده، چند اتصال برای یک کاربر، عضویت در روم اشتباه و حضور کاربر دیگر در روم درخواستی را بررسی می‌کند.
*/
