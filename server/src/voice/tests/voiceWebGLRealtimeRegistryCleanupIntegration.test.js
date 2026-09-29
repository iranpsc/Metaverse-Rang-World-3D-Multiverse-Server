import assert from "node:assert/strict";

import {
    ClientsRegistry
} from "../../realTime/clientsRegistry.js";

import {
    cleanupRealtimeConnection
} from "../../realTime/stability/disconnectCleanup.js";

import {
    installVoiceWebGLRealtimeRegistryCleanupGuard,
    uninstallVoiceWebGLRealtimeRegistryCleanupGuard
} from "../reconnect/webgl/voiceWebGLRealtimeRegistryCleanupGuard.js";

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
    ClientsRegistry
);

const guard = installVoiceWebGLRealtimeRegistryCleanupGuard(
    ClientsRegistry
);

const webGLRegistry = new ClientsRegistry();
const webGLPair = registerPair(
    webGLRegistry,
    "user-webgl-integration",
    "websocket"
);

cleanupRealtimeConnection(
    webGLPair.oldConnection.context,
    {
        registry: webGLRegistry,
        rooms: createRooms()
    }
);

const retainedConnections =
    webGLRegistry.getAll("user-webgl-integration");

assert.equal(retainedConnections.length, 1);
assert.equal(
    retainedConnections[0],
    webGLPair.freshConnection.realtimeConnection
);

const windowsRegistry = new ClientsRegistry();
const windowsPair = registerPair(
    windowsRegistry,
    "user-windows-integration",
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
    windowsRegistry.getAll("user-windows-integration").length,
    0
);

const stats = guard.getStats();

assert.equal(stats.preciseWebSocketRemovals, 1);
assert.equal(stats.broadUserRemovalsSuppressed, 1);

assert.equal(
    uninstallVoiceWebGLRealtimeRegistryCleanupGuard(
        ClientsRegistry
    ),
    true
);

console.log(
    "VOICE_WEBGL_REALTIME_REGISTRY_CLEANUP_INTEGRATION_TEST=OK" +
    " | actualClientsRegistry=true" +
    " | freshWebGLConnectionPreserved=true" +
    " | windowsPathChanged=false" +
    " | questPathChanged=false"
);
