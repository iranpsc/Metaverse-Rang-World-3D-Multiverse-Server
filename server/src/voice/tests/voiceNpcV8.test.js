import assert from "node:assert/strict";
import { VoiceNpcPublisherAuthorizationService } from "../npc/voiceNpcPublisherAuthorizationService.js";
import { VoiceNpcPublisherService } from "../npc/voiceNpcPublisherService.js";
import { VoiceNpcSessionRegistry } from "../npc/voiceNpcSessionRegistry.js";
import { VoiceMessageType } from "../protocol/voiceMessageTypes.js";
import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import { registerVoiceNpcGrpcPublisher } from "../npc/registerVoiceNpcGrpcPublisher.js";

const now = Date.now();
const validClaims = Object.freeze({
    sub: "npc-service-v8",
    role: "npc_voice_publisher",
    scope: "voice:npc:publish",
    npcId: "guide-npc",
    serverId: "dedicated-v8",
    exp: Math.floor((now + 60000) / 1000)
});

const authorizationService = new VoiceNpcPublisherAuthorizationService({
    serviceTokenVerifier: {
        verifyServiceToken: async (token) => {
            if (token === "valid-npc-token") return validClaims;
            if (token === "user-token") return { ...validClaims, role: "user" };
            throw new Error("invalid token");
        }
    },
    now: () => now
});

assert.equal((await authorizationService.authorize({
    token: "valid-npc-token", npcId: "guide-npc", serverId: "dedicated-v8"
})).authorized, true);
assert.equal((await authorizationService.authorize({
    token: "user-token", npcId: "guide-npc", serverId: "dedicated-v8"
})).reason, "npc_role_missing");

const sessionRegistry = new VoiceNpcSessionRegistry();
const session = sessionRegistry.authorizeSession({
    sessionId: "880e8400-e29b-41d4-a716-446655440000",
    npcId: "guide-npc",
    npcUserId: "88888888-8888-4888-8888-888888888888",
    publisherConnectionId: "89999999-9999-4999-8999-999999999999",
    serverId: "dedicated-v8",
    roomId: "room-v8",
    listeners: [
        { userId: "11111111-1111-4111-8111-111111111111", connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { userId: "22222222-2222-4222-8222-222222222222", connectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
    ]
});

const sent = [];
const gateway = {
    getConnectionByConnectionId(connectionId) {
        return {
            async sendEnvelope(input) {
                sent.push({ connectionId, ...input });
            }
        };
    }
};

const publisher = new VoiceNpcPublisherService({
    authorizationService,
    sessionRegistry,
    gateway
});

const routed = await publisher.publishFrame({
    token: "valid-npc-token",
    sessionId: session.sessionId,
    npcId: session.npcId,
    serverId: session.serverId,
    sequence: 1,
    timestampMs: Date.now(),
    opusFrame: Buffer.from([0xf8, 0xff, 0xfe])
});

assert.equal(routed.accepted, true);
assert.equal(routed.delivered, 2);
assert.equal(sent.length, 2);
assert.equal(sent[0].messageType, VoiceMessageType.VOICE_FRAME);
assert.equal(sent[0].senderId, session.publisherConnectionId);

const duplicate = await publisher.publishFrame({
    token: "valid-npc-token",
    sessionId: session.sessionId,
    npcId: session.npcId,
    serverId: session.serverId,
    sequence: 1,
    timestampMs: Date.now(),
    opusFrame: Buffer.from([0xf8, 0xff, 0xfe])
});
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, "npc_sequence_invalid");

const lifecycleSent = [];
const lifecycleListener = {
    userId: "33333333-3333-4333-8333-333333333333",
    connectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
};
const lifecycleGateway = {
    voiceConnectionRegistry: {
        getByConnectionId(connectionId) {
            if (connectionId !== lifecycleListener.connectionId) return null;
            return {
                state: VoiceConnectionState.ACTIVE,
                userId: lifecycleListener.userId,
                roomId: "room-v8"
            };
        }
    },
    getConnectionByConnectionId(connectionId) {
        if (connectionId !== lifecycleListener.connectionId) return null;
        return {
            async sendEnvelope(input) { lifecycleSent.push(input); }
        };
    }
};
const lifecyclePublisher = new VoiceNpcPublisherService({
    authorizationService,
    sessionRegistry: new VoiceNpcSessionRegistry(),
    gateway: lifecycleGateway,
    muteRegistry: { isRouteAllowed: () => true }
});
const lifecycleSessionId = "881e8400-e29b-41d4-a716-446655440000";
const lifecycleAuthorization = await lifecyclePublisher.authorizeSession({
    token: "valid-npc-token",
    sessionId: lifecycleSessionId,
    npcId: "guide-npc",
    npcUserId: "88888888-8888-4888-8888-888888888888",
    publisherConnectionId: "89999999-9999-4999-8999-999999999999",
    serverId: "dedicated-v8",
    roomId: "room-v8",
    listeners: [lifecycleListener]
});
assert.equal(lifecycleAuthorization.authorized, true);
assert.equal(lifecycleSent[0].messageType, VoiceMessageType.SESSION_JOINED);
const lifecycleClose = await lifecyclePublisher.closeSession({
    token: "valid-npc-token",
    sessionId: lifecycleSessionId,
    npcId: "guide-npc",
    serverId: "dedicated-v8"
});
assert.equal(lifecycleClose.closed, true);
assert.equal(lifecycleSent[1].messageType, VoiceMessageType.SESSION_CLOSED);

let registeredHandlers = null;
const grpcRegistration = registerVoiceNpcGrpcPublisher({
    grpcServer: {
        addService(definition, handlers) {
            assert.ok(definition);
            registeredHandlers = handlers;
        }
    },
    publisherService: lifecyclePublisher
});
assert.equal(grpcRegistration.registered, true);
assert.equal(typeof registeredHandlers.authorizeSession, "function");
assert.equal(typeof registeredHandlers.publish, "function");
assert.equal(typeof registeredHandlers.setRecordingConsent, "function");
assert.equal(typeof registeredHandlers.closeSession, "function");

console.log("VOICE_V8_NPC_SERVICE_TOKEN_ROLE=PASS");
console.log("VOICE_V8_NPC_AUTHORIZED_SESSION=PASS");
console.log("VOICE_V8_NPC_SEQUENCE_GUARD=PASS");
console.log("VOICE_V8_NPC_ROUTING=PASS");
console.log("VOICE_V8_NPC_SESSION_LIFECYCLE=PASS");
console.log("VOICE_V8_NPC_GRPC_CONTROL_SURFACE=PASS");
console.log("VOICE_V8_ALL_TESTS=PASS");
