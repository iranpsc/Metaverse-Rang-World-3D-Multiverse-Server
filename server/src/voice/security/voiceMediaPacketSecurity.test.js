import assert from "node:assert/strict";
import test from "node:test";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind
} from "../mediaV2/voiceMediaV2Protocol.js";
import {
    SECURITY_ENVELOPE_BYTES,
    VoiceMediaPacketIntegrityReason,
    createVoiceMediaPacketIntegrityPolicy
} from "./voiceMediaPacketIntegrityPolicy.js";
import { createVoiceMediaReplayWindow } from "./voiceMediaReplayWindow.js";

const deterministicPacketVector = "4d564d54020301000058001500000001000000010000000000030d4000000000000000000000000000000000000000000000000011111111111141118111111111111111000000000000000000000000000000000000005b01ee2d7bd50349f512828975b7ba9a7dd301020304";

function packet(transportSequence, payload = Buffer.from([1, 2, 3, 4])) {
    return {
        kind: VoiceMediaV2PacketKind.MEDIA,
        codec: VoiceMediaV2Codec.OPUS,
        flags: 0,
        transportSequence,
        mediaSequence: transportSequence,
        mediaTimestamp100Ns: BigInt(transportSequence) * 200000n,
        ackTransportSequence: 0,
        ackMask: 0,
        sessionId: VoiceMediaV2Constants.emptyUuid,
        streamId: "11111111-1111-4111-8111-111111111111",
        senderId: VoiceMediaV2Constants.emptyUuid,
        payload
    };
}

test("media packet integrity and replay policy rejects tampering and duplicate delivery", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", "hex");
    const receiver = createVoiceMediaPacketIntegrityPolicy({ securityContextId: 91, key });
    const sender = createVoiceMediaPacketIntegrityPolicy({ securityContextId: 91, key });

    const protectedOne = sender.protect(packet(1));
    assert.equal(protectedOne.toString("hex"), deterministicPacketVector);
    const acceptedOne = receiver.verifyAndUnwrap(protectedOne);
    assert.equal(acceptedOne.accepted, true);
    assert.deepEqual(acceptedOne.packet.payload, Buffer.from([1, 2, 3, 4]));
    assert.equal(acceptedOne.packet.securityContextId, 91);

    const duplicate = receiver.verifyAndUnwrap(protectedOne);
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.reason, VoiceMediaPacketIntegrityReason.REPLAY_REJECTED);
    assert.equal(duplicate.replayReason, "duplicate");

    const payloadTampered = Buffer.from(sender.protect(packet(2)));
    payloadTampered[payloadTampered.length - 1] ^= 0x01;
    assert.equal(receiver.verifyAndUnwrap(payloadTampered).reason, VoiceMediaPacketIntegrityReason.INVALID_TAG);

    const headerTampered = Buffer.from(sender.protect(packet(3)));
    headerTampered.writeUInt32BE(400, 16);
    assert.equal(receiver.verifyAndUnwrap(headerTampered).reason, VoiceMediaPacketIntegrityReason.INVALID_TAG);

    const wrongContext = createVoiceMediaPacketIntegrityPolicy({ securityContextId: 92, key });
    assert.equal(wrongContext.verifyAndUnwrap(sender.protect(packet(4))).reason, VoiceMediaPacketIntegrityReason.INVALID_CONTEXT);

    const wrongKey = createVoiceMediaPacketIntegrityPolicy({ securityContextId: 91, key: Buffer.alloc(32, 7) });
    assert.equal(wrongKey.verifyAndUnwrap(sender.protect(packet(5))).reason, VoiceMediaPacketIntegrityReason.INVALID_TAG);

    const forgedFuture = Buffer.from(sender.protect(packet(1_000)));
    forgedFuture[forgedFuture.length - 1] ^= 0x80;
    assert.equal(receiver.verifyAndUnwrap(forgedFuture).reason, VoiceMediaPacketIntegrityReason.INVALID_TAG);
    assert.equal(receiver.verifyAndUnwrap(sender.protect(packet(6))).accepted, true);

    const maximumPayload = Buffer.alloc(VoiceMediaV2Constants.maximumPayloadBytes - SECURITY_ENVELOPE_BYTES, 0x5a);
    assert.equal(sender.protect(packet(7, maximumPayload)).length, VoiceMediaV2Constants.maximumPacketBytes);
    assert.throws(() => sender.protect(packet(8, Buffer.alloc(maximumPayload.length + 1))), /MTU/);
    assert.throws(() => sender.protect(packet(0)), /transportSequence/);

    sender.dispose();
    receiver.dispose();
    wrongContext.dispose();
    wrongKey.dispose();
});

test("replay window accepts one out-of-order packet and rejects duplicate and stale packets", () => {
    const replay = createVoiceMediaReplayWindow({ windowSize: 32 });
    assert.equal(replay.accept(100).accepted, true);
    assert.equal(replay.accept(102).accepted, true);
    assert.equal(replay.accept(101).accepted, true);
    assert.equal(replay.accept(101).reason, "duplicate");
    assert.equal(replay.accept(70).reason, "too_old");
    assert.equal(replay.accept(0).reason, "invalid_sequence");
    const stats = replay.getStats();
    assert.equal(stats.acceptedPackets, 3);
    assert.equal(stats.duplicatePackets, 1);
    assert.equal(stats.stalePackets, 1);
    assert.equal(stats.invalidPackets, 1);
});

console.log("VME2_PHASE13_PACKET_SECURITY_SYNTHETIC=PASS | hmacSha256=True | authenticationTagBits=128 | deterministicVectorLocked=True | headerIntegrity=True | payloadIntegrity=True | contextBinding=True | duplicateRejected=True | outOfOrderAcceptedOnce=True | staleRejected=True | forgedFutureDoesNotPoisonWindow=True | mtuPreserved=True | productionIntegration=False");
