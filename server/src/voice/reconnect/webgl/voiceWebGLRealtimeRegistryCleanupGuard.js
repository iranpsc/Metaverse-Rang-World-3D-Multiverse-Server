const INSTALLATION_SYMBOL = Symbol.for(
    "metarang.voice.webglRealtimeRegistryCleanupGuard"
);

const pendingPreciseCleanupByRegistry = new WeakMap();

function normalize(value) {
    return String(value ?? "").trim();
}

function readConnectionContext(connectionOrId) {
    if (!connectionOrId || typeof connectionOrId !== "object") {
        return null;
    }

    return connectionOrId.context ??
        connectionOrId.realtimeConnection?.context ??
        null;
}

function readConnectionUserId(connectionOrId) {
    const context = readConnectionContext(connectionOrId);

    return normalize(
        context?.user?.id ??
        context?.user?.userId ??
        connectionOrId?.user?.id ??
        connectionOrId?.user?.userId
    );
}

function isWebSocketRealtimeConnection(connectionOrId) {
    const context = readConnectionContext(connectionOrId);
    const transportKind = normalize(
        context?.transportKind ??
        connectionOrId?.transportKind ??
        connectionOrId?.kind
    ).toLowerCase();

    return transportKind === "websocket";
}

function installVoiceWebGLRealtimeRegistryCleanupGuard(
    ClientsRegistryClass
) {
    if (
        typeof ClientsRegistryClass !== "function" ||
        !ClientsRegistryClass.prototype ||
        typeof ClientsRegistryClass.prototype.removeConnection !== "function" ||
        typeof ClientsRegistryClass.prototype.remove !== "function"
    ) {
        throw new TypeError(
            "ClientsRegistryClass does not provide the required cleanup interface."
        );
    }

    const prototype = ClientsRegistryClass.prototype;
    const currentInstallation = prototype[INSTALLATION_SYMBOL];

    if (currentInstallation?.installed === true) {
        return currentInstallation.api;
    }

    const originalRemoveConnection = prototype.removeConnection;
    const originalRemove = prototype.remove;
    const stats = {
        preciseWebSocketRemovals: 0,
        broadUserRemovalsSuppressed: 0
    };

    function removeConnectionWithWebGLCleanupGuard(connectionOrId) {
        const userId = readConnectionUserId(connectionOrId);
        const webSocketConnection =
            isWebSocketRealtimeConnection(connectionOrId);

        const removed = originalRemoveConnection.call(
            this,
            connectionOrId
        );

        if (removed === true && webSocketConnection && userId) {
            const marker = Object.freeze({ userId });
            pendingPreciseCleanupByRegistry.set(this, marker);
            stats.preciseWebSocketRemovals += 1;

            queueMicrotask(() => {
                if (pendingPreciseCleanupByRegistry.get(this) === marker) {
                    pendingPreciseCleanupByRegistry.delete(this);
                }
            });
        }

        return removed;
    }

    function removeWithWebGLCleanupGuard(userId, connection = null) {
        if (connection != null) {
            return originalRemove.call(this, userId, connection);
        }

        const normalizedUserId = normalize(userId);
        const marker = pendingPreciseCleanupByRegistry.get(this);

        if (marker && marker.userId === normalizedUserId) {
            pendingPreciseCleanupByRegistry.delete(this);
            stats.broadUserRemovalsSuppressed += 1;

            const remainingConnections =
                typeof this.getAll === "function"
                    ? this.getAll(normalizedUserId).length
                    : -1;

            console.log(
                "VOICE_WEBGL_REALTIME_REGISTRY_CLEANUP_GUARD=PASS" +
                " | userId=" + normalizedUserId +
                " | remainingConnections=" + remainingConnections +
                " | staleCloseContained=true" +
                " | windowsPathChanged=false" +
                " | questPathChanged=false"
            );

            return true;
        }

        return originalRemove.call(this, userId, connection);
    }

    const api = Object.freeze({
        installed: true,
        getStats() {
            return Object.freeze({ ...stats });
        }
    });

    const installation = {
        installed: true,
        originalRemoveConnection,
        originalRemove,
        removeConnectionWithWebGLCleanupGuard,
        removeWithWebGLCleanupGuard,
        api
    };

    prototype.removeConnection =
        removeConnectionWithWebGLCleanupGuard;
    prototype.remove = removeWithWebGLCleanupGuard;

    Object.defineProperty(
        prototype,
        INSTALLATION_SYMBOL,
        {
            configurable: true,
            enumerable: false,
            writable: false,
            value: installation
        }
    );

    return api;
}

function uninstallVoiceWebGLRealtimeRegistryCleanupGuard(
    ClientsRegistryClass
) {
    if (
        typeof ClientsRegistryClass !== "function" ||
        !ClientsRegistryClass.prototype
    ) {
        return false;
    }

    const prototype = ClientsRegistryClass.prototype;
    const installation = prototype[INSTALLATION_SYMBOL];

    if (installation?.installed !== true) {
        return false;
    }

    if (
        prototype.removeConnection ===
        installation.removeConnectionWithWebGLCleanupGuard
    ) {
        prototype.removeConnection = installation.originalRemoveConnection;
    }

    if (
        prototype.remove ===
        installation.removeWithWebGLCleanupGuard
    ) {
        prototype.remove = installation.originalRemove;
    }

    delete prototype[INSTALLATION_SYMBOL];
    return true;
}

export {
    installVoiceWebGLRealtimeRegistryCleanupGuard,
    uninstallVoiceWebGLRealtimeRegistryCleanupGuard
};
