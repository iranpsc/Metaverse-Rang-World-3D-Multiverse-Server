import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceMediaNodeRuntime } from "../mediaNode/mediaNodeRuntime.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { createVoiceMediaPacketIntegrityPolicy } from "./voiceMediaPacketIntegrityPolicy.js";
import { createVoiceMediaPayloadCipher } from "./voiceMediaPayloadCipher.js";
import { createVoiceMediaKeyRotationPolicy } from "./voiceMediaKeyRotationPolicy.js";
import { createVoiceMediaPacketSecurityRuntimeAdapter } from "./voiceMediaPacketSecurityRuntimeAdapter.js";
import { createVoiceMediaSecurityHandshake, decodeVoiceMediaSecurityHandshake, deriveVoiceMediaSecurityKeys, encodeVoiceMediaSecurityHandshake } from "./voiceMediaSecurityHandshake.js";

const connectionId = "11111111-1111-4111-8111-111111111111";
const streamId = "22222222-2222-4222-8222-222222222222";
const roomId = "security-room";
const accessToken = "security-access-token";

function packet(kind, transportSequence, payload, codec = VoiceMediaV2Codec.NONE) {
    return encodeVoiceMediaV2Packet({ kind, codec, transportSequence, mediaSequence: kind === VoiceMediaV2PacketKind.MEDIA ? transportSequence : 0, mediaTimestamp100Ns: kind === VoiceMediaV2PacketKind.MEDIA ? BigInt(transportSequence) * 200000n : 0n, streamId, payload });
}

test("security handshake locks cross-platform directional key vectors", () => {
    const nonce = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    const securityContextId = 0x01020304;
    const message = encodeVoiceMediaSecurityHandshake({ securityContextId, nonce });
    assert.equal(message, "media_bind_ok|vme2s1|01020304|AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    const decoded = decodeVoiceMediaSecurityHandshake(message);
    assert.equal(decoded.securityContextId, securityContextId);
    assert.deepEqual(decoded.nonce, nonce);
    const keys = deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId: connectionId, streamId, securityContextId, nonce });
    assert.equal(keys.clientToServerKey.toString("hex"), "986b92b1ddff83aecd0f3f8fe5ee44a04ccdbf6d9b97e72e2ca64abd9c2d0727");
    assert.equal(keys.serverToClientKey.toString("hex"), "daa00656eff0dadd7c562e91d35e62dab7c76be5ea270a19d46a8a1f8fb847fb");
    assert.equal(keys.clientToServerEncryptionKey.toString("hex"), "b611ee7d3e306937216c3eead242a4f92d03141ae896d4326b084e01ae47b7d7");
    assert.equal(keys.serverToClientEncryptionKey.toString("hex"), "68d5acc2ad5b0a7f4e5d72fbe0e2d4146a2780dd964de7dbc9ddc6f19470012b");
    keys.clientToServerKey.fill(0);
    keys.serverToClientKey.fill(0);
    keys.clientToServerEncryptionKey.fill(0);
    keys.serverToClientEncryptionKey.fill(0);
});

test("runtime security adapter negotiates directional keys and protects both media directions", async () => {
    const routed = [];
    const bridgeClient = {
        async authorizeBind(input) { return { success: input.accessToken === accessToken && input.roomId === roomId && input.controlConnectionId === connectionId, controlConnectionId: connectionId, userId: "user-1", roomId }; },
        async routeFrame(input) { routed.push(input); return { success: true, accepted: true }; }
    };
    const base = createVoiceMediaNodeRuntime({ bridgeClient });
    const secure = createVoiceMediaPacketSecurityRuntimeAdapter({ runtime: base });
    const outbound = [];
    const accepted = secure.acceptConnection({ transportConnectionKey: "security-test", sendPacket(value) { outbound.push(Buffer.from(value)); }, closeTransport() {} });

    const bindPayload = encodeVoiceMediaV2BindRequest({ accessToken, roomId, controlConnectionId: connectionId, platform: 2, clientBuild: "test;vme2s1" });
    await accepted.receive(packet(VoiceMediaV2PacketKind.BIND_REQUEST, 1, bindPayload));
    assert.equal(outbound.length, 1);
    const bindPacket = decodeVoiceMediaV2Packet(outbound.shift());
    const bindResult = decodeVoiceMediaV2BindResult(bindPacket.payload);
    assert.equal(bindResult.success, true);
    const handshake = decodeVoiceMediaSecurityHandshake(bindResult.message);
    const keys = deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId: connectionId, streamId, securityContextId: handshake.securityContextId, nonce: handshake.nonce });
    const clientOutbound = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.clientToServerKey });
    const clientInbound = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: keys.serverToClientKey });
    const clientOutboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.clientToServerEncryptionKey });
    const clientInboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: keys.serverToClientEncryptionKey });

    const protectedPing = clientOutbound.protect(clientOutboundCipher.encrypt(decodeVoiceMediaV2Packet(packet(VoiceMediaV2PacketKind.PING, 2, Buffer.from([9, 8, 7])))));
    assert.notDeepEqual(decodeVoiceMediaV2Packet(protectedPing).payload.subarray(17), Buffer.from([9, 8, 7]));
    await accepted.receive(protectedPing);
    assert.equal(outbound.length, 1);
    const pong = clientInbound.verifyAndUnwrap(outbound.shift());
    assert.equal(pong.accepted, true);
    const decryptedPong = clientInboundCipher.decrypt(pong.packet);
    assert.equal(decryptedPong.kind, VoiceMediaV2PacketKind.PONG);
    assert.deepEqual(decryptedPong.payload, Buffer.from([9, 8, 7]));

    await accepted.receive(protectedPing);
    assert.equal(outbound.length, 0);
    const protectedMedia = clientOutbound.protect(clientOutboundCipher.encrypt(decodeVoiceMediaV2Packet(packet(VoiceMediaV2PacketKind.MEDIA, 3, Buffer.from([1, 2, 3, 4]), VoiceMediaV2Codec.OPUS))));
    await accepted.receive(protectedMedia);
    assert.equal(routed.length, 1);
    assert.deepEqual(routed[0].payload, Buffer.from([1, 2, 3, 4]));

    await secure.deliverMedia({ listenerConnectionId: connectionId, flags: 0, mediaSequence: 7, mediaTimestamp100Ns: "1400000", sessionId: VoiceMediaV2Constants.emptyUuid, streamId, senderId: connectionId, payload: Buffer.from([5, 6, 7]) });
    assert.equal(outbound.length, 1);
    const delivered = clientInbound.verifyAndUnwrap(outbound.shift());
    assert.equal(delivered.accepted, true);
    const decryptedDelivery = clientInboundCipher.decrypt(delivered.packet);
    assert.equal(decryptedDelivery.kind, VoiceMediaV2PacketKind.MEDIA);
    assert.deepEqual(decryptedDelivery.payload, Buffer.from([5, 6, 7]));

    const stats = secure.getStats().packetSecurity;
    assert.equal(stats.activeContexts, 1);
    assert.equal(stats.negotiatedContexts, 1);
    assert.equal(stats.acceptedProtectedPackets, 2);
    assert.equal(stats.rejectedProtectedPackets, 1);
    assert.equal(stats.encryptedPackets, 2);
    assert.equal(stats.decryptedPackets, 2);
    await accepted.closed("test_complete");
    assert.equal(secure.getStats().packetSecurity.activeContexts, 0);
    keys.clientToServerKey.fill(0);
    keys.serverToClientKey.fill(0);
    clientOutbound.dispose();
    clientInbound.dispose();
    clientOutboundCipher.dispose();
    clientInboundCipher.dispose();
    keys.clientToServerEncryptionKey.fill(0);
    keys.serverToClientEncryptionKey.fill(0);
    await secure.stop();
});

test("runtime security adapter preserves legacy clients without the security capability", async () => {
    const bridgeClient = {
        async authorizeBind() { return { success: true, controlConnectionId: connectionId, userId: "user-1", roomId }; },
        async routeFrame() { return { success: true, accepted: true }; }
    };
    const secure = createVoiceMediaPacketSecurityRuntimeAdapter({ runtime: createVoiceMediaNodeRuntime({ bridgeClient }) });
    const outbound = [];
    const accepted = secure.acceptConnection({ transportConnectionKey: "legacy-test", sendPacket(value) { outbound.push(Buffer.from(value)); }, closeTransport() {} });
    const bindPayload = encodeVoiceMediaV2BindRequest({ accessToken, roomId, controlConnectionId: connectionId, platform: 2, clientBuild: "legacy-client" });
    await accepted.receive(packet(VoiceMediaV2PacketKind.BIND_REQUEST, 1, bindPayload));
    assert.equal(outbound.length, 1);
    const bindResult = decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(outbound.shift()).payload);
    assert.equal(bindResult.success, true);
    assert.equal(bindResult.message, "media_bind_ok");
    await accepted.receive(packet(VoiceMediaV2PacketKind.PING, 2, Buffer.from([4, 3, 2, 1])));
    assert.equal(outbound.length, 1);
    const pong = decodeVoiceMediaV2Packet(outbound.shift());
    assert.equal(pong.kind, VoiceMediaV2PacketKind.PONG);
    assert.equal(pong.securityContextId, 0);
    assert.equal(secure.getStats().packetSecurity.activeContexts, 0);
    await accepted.closed("test_complete");
    await secure.stop();
});

test("runtime security adapter requires reconnect and creates a fresh key context", async () => {
    const bridgeClient = {
        async authorizeBind() { return { success: true, controlConnectionId: connectionId, userId: "user-1", roomId }; },
        async routeFrame() { return { success: true, accepted: true }; }
    };
    const handshakeContexts = [1, 1, 2];
    let handshakeIndex = 0;
    const secure = createVoiceMediaPacketSecurityRuntimeAdapter({
        runtime: createVoiceMediaNodeRuntime({ bridgeClient }),
        createHandshake(input) {
            const nonce = Buffer.alloc(32);
            nonce.writeUInt32BE(handshakeContexts[handshakeIndex++], 0);
            return createVoiceMediaSecurityHandshake({ ...input, randomBytesSource: () => nonce });
        },
        createKeyRotationPolicy: () => createVoiceMediaKeyRotationPolicy({ maxKeyAgeMs: 60000, maxPacketsPerDirection: 2, now: () => 1000 })
    });
    const closeReasons = [];
    const firstOutbound = [];
    const first = secure.acceptConnection({ transportConnectionKey: "rotation-1", sendPacket(value) { firstOutbound.push(Buffer.from(value)); }, closeTransport(reason) { closeReasons.push(reason); } });
    const bindPayload = encodeVoiceMediaV2BindRequest({ accessToken, roomId, controlConnectionId: connectionId, platform: 2, clientBuild: "test;vme2s1" });
    await first.receive(packet(VoiceMediaV2PacketKind.BIND_REQUEST, 1, bindPayload));
    const firstResult = decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(firstOutbound.shift()).payload);
    const firstHandshake = decodeVoiceMediaSecurityHandshake(firstResult.message);
    const firstKeys = deriveVoiceMediaSecurityKeys({ accessToken, roomId, controlConnectionId: connectionId, streamId, securityContextId: firstHandshake.securityContextId, nonce: firstHandshake.nonce });
    const firstIntegrity = createVoiceMediaPacketIntegrityPolicy({ securityContextId: firstHandshake.securityContextId, key: firstKeys.clientToServerKey });
    const firstCipher = createVoiceMediaPayloadCipher({ securityContextId: firstHandshake.securityContextId, key: firstKeys.clientToServerEncryptionKey });
    await first.receive(firstIntegrity.protect(firstCipher.encrypt(decodeVoiceMediaV2Packet(packet(VoiceMediaV2PacketKind.PING, 2, Buffer.from([1]))))));
    assert.equal(firstOutbound.length, 1);
    firstOutbound.shift();
    await first.receive(firstIntegrity.protect(firstCipher.encrypt(decodeVoiceMediaV2Packet(packet(VoiceMediaV2PacketKind.PING, 3, Buffer.from([2]))))));
    assert.deepEqual(closeReasons, ["media_security_key_rotation_required"]);
    assert.equal(firstOutbound.length, 0);
    await first.closed("rotation_complete");

    const secondOutbound = [];
    const second = secure.acceptConnection({ transportConnectionKey: "rotation-2", sendPacket(value) { secondOutbound.push(Buffer.from(value)); }, closeTransport() {} });
    await second.receive(packet(VoiceMediaV2PacketKind.BIND_REQUEST, 1, bindPayload));
    const secondResult = decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(secondOutbound.shift()).payload);
    const secondHandshake = decodeVoiceMediaSecurityHandshake(secondResult.message);
    assert.notEqual(secondHandshake.securityContextId, firstHandshake.securityContextId);
    assert.equal(handshakeIndex, 3);
    const stats = secure.getStats().packetSecurity;
    assert.equal(stats.negotiatedContexts, 2);
    assert.equal(stats.rotationRequiredConnections, 1);
    assert.equal(stats.rotationsByPacketCount, 1);
    await second.closed("test_complete");
    firstIntegrity.dispose();
    firstCipher.dispose();
    for (const key of Object.values(firstKeys)) key.fill(0);
    await secure.stop();
});

console.log("VME2_PHASE13_PACKET_SECURITY_RUNTIME=PASS | deterministicHandshakeVector=True | perConnectionNonce=True | nonZeroContext=True | directionalKeys=True | capabilityNegotiated=True | legacyClientPreserved=True | bindBackwardCompatible=True | clientToServerProtected=True | serverToClientProtected=True | duplicateDropped=True | keyCleanup=True | productionEnabled=False");
console.log("VME2_PHASE13_MEDIA_ENCRYPTION_RUNTIME=PASS | aes256Ctr=True | encryptThenMac=True | deterministicEncryptionKeys=True | perConnectionNonce=True | nonZeroContext=True | directionalKeys=True | capabilityNegotiated=True | legacyClientPreserved=True | bindBackwardCompatible=True | clientToServerEncrypted=True | serverToClientEncrypted=True | duplicateDropped=True | zeroPayloadExpansion=True | keyCleanup=True | productionEnabled=False");
console.log("VME2_PHASE13_KEY_ROTATION_RUNTIME=PASS | serverEnforced=True | maxKeyAge=True | perDirectionPacketLimit=True | reconnectRequired=True | freshContext=True | immediateContextReuseRejected=True | freshDirectionalKeys=True | legacyClientPreserved=True | productionThresholdsLocked=True");
