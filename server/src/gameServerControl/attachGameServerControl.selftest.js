// File => src/gameServerControl/attachGameServerControl.selftest.js

import {
    attachGameServerControl,
    detachGameServerControl,
    getAttachedGameServerControlStatus
} from "./attachGameServerControl.js";

const app = { locals: {} };

const attached = attachGameServerControl({
    app,
    config: {
        enabled: true,
        defaultHost: "127.0.0.1",
        defaultPort: 7777,
        ticketTtlSeconds: 60,
        heartbeatTimeoutSeconds: 15,
        maxPlayersPerInstance: 20,
        cleanupIntervalSeconds: 10,
        serviceSecret: "phase2_attach_secret_123"
    }
});

console.log("ATTACH", {
    success: attached.success,
    reason: attached.reason,
    started: attached.data.started,
    hasControl: !!attached.control,
    hasAppLocal: !!app.locals.gameServerControl
});

const serviceToken = attached.control.serviceTokenService.createToken({
    serverId: "ds_attach_001"
});

const register = await attached.control.dedicatedServerHandler.registerDedicatedServer({}, {
    serviceToken,
    serverId: "ds_attach_001",
    host: "127.0.0.1",
    port: 7777,
    roomId: "room_attach_1",
    region: "eu-central",
    zone: "de-1",
    maxPlayers: 20,
    currentPlayers: 0,
    status: "online"
});

console.log("REGISTER", {
    success: register.success,
    reason: register.reason,
    serverId: register.data.server.serverId
});

const status = getAttachedGameServerControlStatus({ app });

console.log("STATUS", {
    success: status.success,
    reason: status.reason,
    registryTotal: status.data.status.data.registry.total,
    registryOnline: status.data.status.data.registry.online
});

const detached = detachGameServerControl({ app });

console.log("DETACH", {
    success: detached.success,
    reason: detached.reason,
    stopped: detached.data.stopped,
    hasAppLocal: !!app.locals.gameServerControl
});
