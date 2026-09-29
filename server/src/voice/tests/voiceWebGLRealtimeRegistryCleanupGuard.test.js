import assert from "node:assert/strict";

import {
    cleanupRealtimeConnection
} from "../../realTime/stability/disconnectCleanup.js";

import {
    installVoiceWebGLRealtimeRegistryCleanupGuard,
    uninstallVoiceWebGLRealtimeRegistryCleanupGuard
} from "../reconnect/webgl/voiceWebGLRealtimeRegistryCleanupGuard.js";

class TestClientsRegistry {
    constructor() {
        this.byConnectionId = new Map();
        this.byUserId = new Map();
    }

    addConnection(connection, userId = "") {
        const normalizedUserId = String(userId ?? "").trim();
        const connectionId = String(connection?.id ?? "").trim();

        this.byConnectionId.set(connectionId, {
            connection,
            userId: normalizedUserId
        });

        if (!this.byUserId.has(normalizedUserId)) {
            this.byUserId.set(normalizedUserId, new Set());
        }

        this.byUserId.get(normalizedUserId).add(connectionId);
        return connection;
    }

    removeConnection(connectionOrId) {
        const connectionId = typeof connectionOrId === "string"
            ? connectionOrId
            : String(connectionOrId?.id ?? "").trim();

        const record = this.byConnectionId.get(connectionId);
        if (!record) return false;

        this.byConnectionId.delete(connectionId);

        const userConnections = this.byUserId.get(record.userId);
        userConnections?.delete(connectionId);

        if (userConnections?.size === 0) {
            this.byUserId.delete(record.userId);
        }

        return true;
    }

    remove(userId, connection = null) {
        if (connection) return this.removeConnection(connection);

        const normalizedUserId = String(userId ?? "").trim();
        const connectionIds = this.byUserId.get(normalizedUserId);
        if (!connectionIds) return false;

        for (const connectionId of [...connectionIds]) {
            this.removeConnection(connectionId);
        }

        this.byUserId.delete(normalizedUserId);
        return true;
    }

    getAll(userId) {
        const normalizedUserId = String(userId ?? "").trim();
        const connectionIds = this.byUserId.get(normalizedUserId);
        if (!connectionIds) return [];

        return [...connectionIds]
            .map((connectionId) =>
                this.byConnectionId.get(connectionId)?.connection ?? null)
            .filter(Boolean);
    }
}

function createRealtimeConnection({
    connectionId,
    userId,
    transportKind
}) {
    const rawConnection = {
        isOpen() {
            return true;
        }
    };

    const context = {
        connectionId,
        state: "authenticated",
        transportKind,
        connection: rawConnection,
        user: {
            id: userId,
            userId
        },
        roomId: "room-webgl-reconnect",
        meta: Object.create(null)
    };

    const realtimeConnection = {
        id: connectionId,
        context,
        isOpen() {
            return true;
        }
    };

    context.realtimeConnection = realtimeConnection;

    return {
        context,
        realtimeConnection
    };
}

function createRooms() {
    return {
        leaveAll() {
            return 1;
        }
    };
}

function registerPair(registry, userId, transportKind) {
    const oldConnection = createRealtimeConnection({
        connectionId: "rt_conn_old_" + transportKind,
        userId,
        transportKind
    });

    const freshConnection = createRealtimeConnection({
        connectionId: "rt_conn_fresh_" + transportKind,
        userId,
        transportKind
    });

    registry.addConnection(
        oldConnection.realtimeConnection,
        userId
    );

    registry.addConnection(
        freshConnection.realtimeConnection,
        userId
    );

    return {
        oldConnection,
        freshConnection
    };
}

uninstallVoiceWebGLRealtimeRegistryCleanupGuard(
    TestClientsRegistry
);

const baselineRegistry = new TestClientsRegistry();
const baselinePair = registerPair(
    baselineRegistry,
    "user-baseline",
    "websocket"
);

cleanupRealtimeConnection(
    baselinePair.oldConnection.context,
    {
        registry: baselineRegistry,
        rooms: createRooms()
    }
);

assert.equal(
    baselineRegistry.getAll("user-baseline").length,
    0,
    "The unguarded cleanup must reproduce removal of the fresh connection."
);

const firstInstall =
    installVoiceWebGLRealtimeRegistryCleanupGuard(
        TestClientsRegistry
    );
const secondInstall =
    installVoiceWebGLRealtimeRegistryCleanupGuard(
        TestClientsRegistry
    );

assert.equal(firstInstall, secondInstall);

const webGLRegistry = new TestClientsRegistry();
const webGLPair = registerPair(
    webGLRegistry,
    "user-webgl",
    "websocket"
);

cleanupRealtimeConnection(
    webGLPair.oldConnection.context,
    {
        registry: webGLRegistry,
        rooms: createRooms()
    }
);

const retainedWebGLConnections =
    webGLRegistry.getAll("user-webgl");

assert.equal(retainedWebGLConnections.length, 1);
assert.equal(
    retainedWebGLConnections[0],
    webGLPair.freshConnection.realtimeConnection
);

const singleWebGLRegistry = new TestClientsRegistry();
const singleWebGLConnection = createRealtimeConnection({
    connectionId: "rt_conn_single_websocket",
    userId: "user-single-webgl",
    transportKind: "websocket"
});

singleWebGLRegistry.addConnection(
    singleWebGLConnection.realtimeConnection,
    "user-single-webgl"
);

cleanupRealtimeConnection(
    singleWebGLConnection.context,
    {
        registry: singleWebGLRegistry,
        rooms: createRooms()
    }
);

assert.equal(
    singleWebGLRegistry.getAll("user-single-webgl").length,
    0
);

const windowsRegistry = new TestClientsRegistry();
const windowsPair = registerPair(
    windowsRegistry,
    "user-windows",
    "grpcStreaming"
);

cleanupRealtimeConnection(
    windowsPair.oldConnection.context,
    {
        registry: windowsRegistry,
        rooms: createRooms()
    }
);

assert.equal(
    windowsRegistry.getAll("user-windows").length,
    0,
    "The existing gRPC cleanup behavior must remain unchanged."
);

const directRemovalRegistry = new TestClientsRegistry();
registerPair(
    directRemovalRegistry,
    "user-direct-remove",
    "websocket"
);

assert.equal(
    directRemovalRegistry.remove("user-direct-remove"),
    true
);
assert.equal(
    directRemovalRegistry.getAll("user-direct-remove").length,
    0
);

const stats = firstInstall.getStats();

assert.equal(stats.preciseWebSocketRemovals, 2);
assert.equal(stats.broadUserRemovalsSuppressed, 2);

assert.equal(
    uninstallVoiceWebGLRealtimeRegistryCleanupGuard(
        TestClientsRegistry
    ),
    true
);

console.log(
    "VOICE_WEBGL_REALTIME_REGISTRY_CLEANUP_GUARD_TEST=OK" +
    " | baselineRaceReproduced=true" +
    " | freshWebGLConnectionPreserved=true" +
    " | singleWebGLCleanupComplete=true" +
    " | directUserRemovalPreserved=true" +
    " | windowsPathChanged=false" +
    " | questPathChanged=false"
);
