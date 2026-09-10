// File: src/voice/tests/voiceBinaryEnvelope.test.js

import assert from "node:assert/strict";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    decodeVoiceBinaryEnvelope,
    encodeVoiceBinaryEnvelope,
    voiceBytesToUuid,
    voiceUuidToBytes
} from "../protocol/voiceBinaryEnvelope.js";

const sessionId = "123e4567-e89b-12d3-a456-426614174000";
const senderId = "70c686cf-d8ca-4c15-9f85-5f503a14f21a";
const timestampMs = 1785300000123n;
const payload = Buffer.from([0x01, 0x02, 0x7f, 0x80, 0xfe, 0xff]);

const encoded = encodeVoiceBinaryEnvelope({
    messageType: 7,
    flags: 5,
    sequence: 12345,
    timestampMs,
    sessionId,
    senderId,
    payload
});

assert.equal(
    encoded.length,
    VoiceBinaryProtocolConstants.fixedHeaderBytes + payload.length
);

assert.equal(
    encoded.subarray(0, 4).toString("ascii"),
    VoiceBinaryProtocolConstants.magicText
);

const decoded = decodeVoiceBinaryEnvelope(encoded);

assert.equal(decoded.version, 1);
assert.equal(decoded.messageType, 7);
assert.equal(decoded.flags, 5);
assert.equal(decoded.headerLength, 60);
assert.equal(decoded.payloadLength, payload.length);
assert.equal(decoded.sequence, 12345);
assert.equal(decoded.timestampMs, timestampMs);
assert.equal(decoded.sessionId, sessionId);
assert.equal(decoded.senderId, senderId);
assert.deepEqual(decoded.payload, payload);

assert.equal(
    voiceBytesToUuid(voiceUuidToBytes(sessionId)),
    sessionId
);

assert.equal(
    voiceBytesToUuid(voiceUuidToBytes(senderId)),
    senderId
);

const invalidMagic = Buffer.from(encoded);
invalidMagic.write("FAIL", 0, "ascii");

assert.throws(
    () => decodeVoiceBinaryEnvelope(invalidMagic),
    /Invalid Voice envelope magic/
);

const invalidVersion = Buffer.from(encoded);
invalidVersion.writeUInt8(2, VoiceBinaryProtocolConstants.offsets.version);

assert.throws(
    () => decodeVoiceBinaryEnvelope(invalidVersion),
    /Unsupported Voice protocol version/
);

const invalidPayloadLength = Buffer.from(encoded);
invalidPayloadLength.writeUInt32BE(
    payload.length + 10,
    VoiceBinaryProtocolConstants.offsets.payloadLength
);

assert.throws(
    () => decodeVoiceBinaryEnvelope(invalidPayloadLength),
    /Voice envelope length mismatch/
);

assert.throws(
    () => decodeVoiceBinaryEnvelope(encoded.subarray(0, 20)),
    /at least 60 bytes/
);

assert.throws(
    () => encodeVoiceBinaryEnvelope({
        messageType: 1,
        sessionId: "invalid-session-id",
        senderId,
        payload
    }),
    /Invalid UUID/
);

assert.throws(
    () => encodeVoiceBinaryEnvelope({
        messageType: 256,
        sessionId,
        senderId,
        payload
    }),
    /messageType/
);

console.log("VOICE_V1_2_BINARY_ENVELOPE_TEST=OK");
