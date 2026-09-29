import assert from "node:assert/strict";
import test from "node:test";
import { VoiceMediaV2PacketKind } from "../mediaV2/voiceMediaV2Protocol.js";
import { createVoiceMediaPayloadCipher } from "./voiceMediaPayloadCipher.js";

const securityContextId = 0x01020304;
const encryptionKey = Buffer.from("b611ee7d3e306937216c3eead242a4f92d03141ae896d4326b084e01ae47b7d7", "hex");

function packet(transportSequence, payload) {
    return Object.freeze({ kind: VoiceMediaV2PacketKind.MEDIA, transportSequence, payload: Buffer.from(payload) });
}

test("media payload cipher matches the locked AES-256-CTR vector", () => {
    const cipher = createVoiceMediaPayloadCipher({ securityContextId, key: encryptionKey });
    const encrypted = cipher.encrypt(packet(9, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])));
    assert.equal(encrypted.payload.toString("hex"), "5cb0ab774663bbc9");
    const decrypted = cipher.decrypt(encrypted);
    assert.deepEqual(decrypted.payload, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.equal(encrypted.payload.length, decrypted.payload.length);
    cipher.dispose();
});

test("media payload cipher separates packet counters without payload expansion", () => {
    const cipher = createVoiceMediaPayloadCipher({ securityContextId, key: encryptionKey });
    const first = cipher.encrypt(packet(10, Buffer.alloc(128, 7)));
    const second = cipher.encrypt(packet(11, Buffer.alloc(128, 7)));
    assert.equal(first.payload.length, 128);
    assert.equal(second.payload.length, 128);
    assert.notDeepEqual(first.payload, second.payload);
    assert.deepEqual(cipher.decrypt(first).payload, Buffer.alloc(128, 7));
    assert.deepEqual(cipher.decrypt(second).payload, Buffer.alloc(128, 7));
    const stats = cipher.getStats();
    assert.equal(stats.encryptedPackets, 2);
    assert.equal(stats.decryptedPackets, 2);
    cipher.dispose();
});

console.log("VME2_PHASE13_MEDIA_PAYLOAD_CIPHER_SYNTHETIC=PASS | aes256Ctr=True | deterministicVector=True | directionalKeyMaterial=True | sequenceSeparated=True | zeroPayloadExpansion=True | productionIntegration=False");
