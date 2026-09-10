// مسیر فایل: src/voice/tests/voiceMs5SessionEligibility.test.js

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";

import {
    createGameSessionRegistry
} from "../../gameServerControl/sessions/gameSessionRegistry.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    createVoiceDedicatedSessionEligibilityHttpHandler
} from "../dedicated/createVoiceDedicatedSessionEligibilityHttpHandler.js";

import {
    VoiceDedicatedSessionEligibilityService
} from "../dedicated/voiceDedicatedSessionEligibilityService.js";

import {
    VoiceMuteRegistry
} from "../mute/voiceMuteRegistry.js";

import {
    VoiceRoutingApplication
} from "../routing/voiceRoutingApplication.js";

import {
    VoiceListenerMuteKind
} from "../routing/voiceRoutingControlPayload.js";

const SERVER_ID = "server_ms5";
const ROOM_ID = "room_ms5";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEDICATED_CONNECTION_ID = "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

function createActiveConnection(registry) {
    const connection = registry.registerAuthenticatedConnection({
        connectionId: CONNECTION_ID,
        userId: USER_ID,
        avatarId: USER_ID,
        roomId: ROOM_ID,
        platform: 1,
        clientInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        transportName: "websocket",
        transportConnectionKey: "transport-ms5",
        createdAtMs: 1786660000000
    });

    connection.activate(1786660000100);
    return connection;
}

function createRoutingApplication(
    connectionRegistry,
    muteRegistry
) {
    return new VoiceRoutingApplication({
        voiceConnectionRegistry: connectionRegistry,
        voiceSessionRegistry: {
            listActiveByConnectionId() {
                return [];
            }
        },
        muteRegistry,
        packetFlowGuard: {
            inspect() {
                return { allowed: true };
            }
        },
        reconnectCoordinator: {
            async handleTransportClosed() {
                return null;
            },
            async handleConnectionAuthenticated() {
                return null;
            }
        },
        now: () => 1786660000200
    });
}

function createDedicatedHandler() {
    return {
        verifyDedicatedServerToken(_ctx, request, expected) {
            if (
                request?.serviceToken !== "valid_service_token" ||
                expected?.serverId !== SERVER_ID
            ) {
                return {
                    success: false,
                    reason: "service_token_invalid",
                    message: "Invalid service token.",
                    data: {},
                    ts: 1786660000300
                };
            }

            return {
                success: true,
                reason: "service_token_valid",
                message: "Valid service token.",
                data: {},
                ts: 1786660000300
            };
        }
    };
}

test("MS5 Mic/Speaker condition stays independent from transport state", () => {
    const connectionRegistry = new VoiceConnectionRegistry();
    createActiveConnection(connectionRegistry);

    const muteRegistry = new VoiceMuteRegistry();
    const routing = createRoutingApplication(
        connectionRegistry,
        muteRegistry
    );

    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).initialized,
        false,
        "Fresh Voice connection must wait for explicit local-control synchronization."
    );

    routing.synchronizeSessionEligibilityFromLocalControls(
        CONNECTION_ID,
        "initial"
    );
    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).eligible,
        true,
        "Mic OFF + Speaker ON must remain eligible."
    );
    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).initialized,
        true,
        "Explicit local-control synchronization must initialize eligibility."
    );

    muteRegistry.applyChange({
        listenerConnectionId: CONNECTION_ID,
        kind: VoiceListenerMuteKind.SPEAKER_OFF,
        muted: true
    });
    routing.synchronizeSessionEligibilityFromLocalControls(
        CONNECTION_ID,
        "speaker_off"
    );
    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).eligible,
        false,
        "Mic OFF + Speaker OFF must leave Voice Session eligibility."
    );

    routing.publisherSettingsByConnectionId.set(
        CONNECTION_ID,
        { bitrateKbps: 32 }
    );
    routing.synchronizeSessionEligibilityFromLocalControls(
        CONNECTION_ID,
        "publish_start"
    );
    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).eligible,
        true,
        "Mic ON + Speaker OFF must remain eligible."
    );

    routing.publisherSettingsByConnectionId.delete(CONNECTION_ID);
    routing.synchronizeSessionEligibilityFromLocalControls(
        CONNECTION_ID,
        "publish_stop"
    );
    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).eligible,
        false,
        "Returning to both OFF must become ineligible again."
    );

    muteRegistry.applyChange({
        listenerConnectionId: CONNECTION_ID,
        kind: VoiceListenerMuteKind.SPEAKER_OFF,
        muted: false
    });
    routing.synchronizeSessionEligibilityFromLocalControls(
        CONNECTION_ID,
        "speaker_on"
    );
    assert.equal(
        connectionRegistry.getSessionEligibility(CONNECTION_ID).eligible,
        true,
        "Turning either control back ON must restore eligibility."
    );
});

test("MS5 Dedicated snapshot returns the exact player eligibility for the same server", () => {
    const connectionRegistry = new VoiceConnectionRegistry();
    createActiveConnection(connectionRegistry);
    connectionRegistry.setSessionEligibility(
        CONNECTION_ID,
        false,
        1786660000400
    );

    const gameSessionRegistry = createGameSessionRegistry();
    const gameSession = gameSessionRegistry.createSession({
        sessionId: "game_session_ms5",
        roomId: ROOM_ID,
        serverId: SERVER_ID,
        status: "active",
        maxPlayers: 20
    });

    const addPlayerResult = gameSessionRegistry.addPlayer(
        gameSession.sessionId,
        {
            userId: USER_ID,
            connectionId: DEDICATED_CONNECTION_ID,
            playerId: USER_ID,
            userName: "MS5 User",
            isReady: true
        }
    );

    assert.equal(addPlayerResult?.success, true);

    const service = new VoiceDedicatedSessionEligibilityService({
        dedicatedServerHandler: createDedicatedHandler(),
        gameServerRegistry: {
            hasServer(serverId) {
                return serverId === SERVER_ID;
            }
        },
        gameSessionRegistry,
        voiceConnectionRegistry: connectionRegistry,
        now: () => 1786660000500
    });

    const result = service.getSnapshot(
        {},
        {
            serviceToken: "valid_service_token",
            serverId: SERVER_ID
        }
    );

    assert.equal(result.success, true);
    assert.equal(result.data.serverId, SERVER_ID);
    assert.equal(result.data.participants.length, 1);
    assert.equal(result.data.participants[0].userId, USER_ID);
    assert.equal(result.data.participants[0].eligible, false);
    assert.equal(
        result.data.participants[0].changedAtMs,
        1786660000400
    );
});


test("MS5 Dedicated snapshot excludes a fresh connection until local controls are synchronized", () => {
    const connectionRegistry = new VoiceConnectionRegistry();
    createActiveConnection(connectionRegistry);

    const gameSessionRegistry = createGameSessionRegistry();
    const gameSession = gameSessionRegistry.createSession({
        sessionId: "game_session_ms5_uninitialized",
        roomId: ROOM_ID,
        serverId: SERVER_ID,
        status: "active",
        maxPlayers: 20
    });

    const addPlayerResult = gameSessionRegistry.addPlayer(
        gameSession.sessionId,
        {
            userId: USER_ID,
            connectionId: DEDICATED_CONNECTION_ID,
            playerId: USER_ID,
            userName: "MS5 User",
            isReady: true
        }
    );
    assert.equal(addPlayerResult?.success, true);

    const service = new VoiceDedicatedSessionEligibilityService({
        dedicatedServerHandler: createDedicatedHandler(),
        gameServerRegistry: {
            hasServer(serverId) {
                return serverId === SERVER_ID;
            }
        },
        gameSessionRegistry,
        voiceConnectionRegistry: connectionRegistry,
        now: () => 1786660000525
    });

    const result = service.getSnapshot(
        {},
        {
            serviceToken: "valid_service_token",
            serverId: SERVER_ID
        }
    );

    assert.equal(result.success, true);
    assert.equal(result.data.participants.length, 0);
});


test("MS5 Dedicated eligibility HTTP route returns the authenticated snapshot", async () => {
    const connectionRegistry = new VoiceConnectionRegistry();
    createActiveConnection(connectionRegistry);

    connectionRegistry.setSessionEligibility(
        CONNECTION_ID,
        true,
        1786660000550
    );

    const gameSessionRegistry = createGameSessionRegistry();
    const gameSession = gameSessionRegistry.createSession({
        sessionId: "game_session_ms5_http",
        roomId: ROOM_ID,
        serverId: SERVER_ID,
        status: "active",
        maxPlayers: 20
    });

    const addPlayerResult = gameSessionRegistry.addPlayer(
        gameSession.sessionId,
        {
            userId: USER_ID,
            connectionId: DEDICATED_CONNECTION_ID,
            playerId: USER_ID,
            userName: "MS5 User",
            isReady: true
        }
    );
    assert.equal(addPlayerResult?.success, true);

    const service = new VoiceDedicatedSessionEligibilityService({
        dedicatedServerHandler: createDedicatedHandler(),
        gameServerRegistry: {
            hasServer(serverId) {
                return serverId === SERVER_ID;
            }
        },
        gameSessionRegistry,
        voiceConnectionRegistry: connectionRegistry,
        now: () => 1786660000600
    });

    const handler = createVoiceDedicatedSessionEligibilityHttpHandler({
        getService: () => service
    });

    const requestBody = JSON.stringify({
        serviceToken: "valid_service_token",
        serverId: SERVER_ID
    });
    const req = Readable.from([Buffer.from(requestBody)]);
    req.url = "/game-server-control/dedicated/voice-session-eligibility";
    req.method = "POST";
    req.headers = { host: "127.0.0.1" };

    let statusCode = 0;
    let responseBody = "";
    const res = {
        destroyed: false,
        writableEnded: false,
        writeHead(code) {
            statusCode = code;
        },
        end(body) {
            responseBody = String(body ?? "");
            this.writableEnded = true;
        }
    };

    const handled = await handler(req, res);
    const parsed = JSON.parse(responseBody);

    assert.equal(handled, true);
    assert.equal(statusCode, 200);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.serverId, SERVER_ID);
    assert.equal(parsed.data.participants.length, 1);
});

console.log("VOICE_G4_RD_MS5_SIMPLE_SESSION_ELIGIBILITY=PASS");
console.log("VOICE_G4_RD_MS5_DEDICATED_ELIGIBILITY_SNAPSHOT=PASS");
