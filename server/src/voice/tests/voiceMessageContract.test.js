// File: src/voice/tests/voiceMessageContract.test.js

import assert from "node:assert/strict";

import {
    VoiceMessageType,
    getVoiceMessageTypeName,
    isKnownVoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceMessageFlag,
    assertVoiceMessageFlagsValue,
    hasVoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageDirection,
    VoicePayloadKind,
    getVoiceMessageRule,
    validateVoiceMessageContract
} from "../protocol/voiceMessageRules.js";

const messageTypeValues = Object.values(VoiceMessageType);

assert.equal(
    new Set(messageTypeValues).size,
    messageTypeValues.length
);

assert.equal(isKnownVoiceMessageType(VoiceMessageType.AUTH_REQUEST), true);
assert.equal(isKnownVoiceMessageType(VoiceMessageType.VOICE_FRAME), true);
assert.equal(isKnownVoiceMessageType(7), false);

assert.equal(
    getVoiceMessageTypeName(VoiceMessageType.VOICE_FRAME),
    "VOICE_FRAME"
);

assert.equal(
    getVoiceMessageTypeName(VoiceMessageType.RECORDING_CONSENT_CHANGED),
    "RECORDING_CONSENT_CHANGED"
);

const voiceFrameRule = getVoiceMessageRule(
    VoiceMessageType.VOICE_FRAME
);

assert.equal(
    voiceFrameRule.direction,
    VoiceMessageDirection.BIDIRECTIONAL
);

assert.equal(
    voiceFrameRule.payloadKind,
    VoicePayloadKind.OPUS_FRAME
);

const consentRule = getVoiceMessageRule(
    VoiceMessageType.RECORDING_CONSENT_CHANGED
);

assert.equal(
    consentRule.direction,
    VoiceMessageDirection.CLIENT_TO_SERVER
);

assert.equal(
    consentRule.payloadKind,
    VoicePayloadKind.CONTROL_BINARY
);

validateVoiceMessageContract({
    messageType: VoiceMessageType.VOICE_FRAME,
    flags: VoiceMessageFlag.DTX
});

validateVoiceMessageContract({
    messageType: VoiceMessageType.VOICE_FRAME,
    flags: VoiceMessageFlag.DISCONTINUITY
});

validateVoiceMessageContract({
    messageType: VoiceMessageType.PUBLISH_STOP,
    flags: VoiceMessageFlag.END_OF_STREAM
});

validateVoiceMessageContract({
    messageType: VoiceMessageType.PUBLISH_START,
    flags: VoiceMessageFlag.ACK_REQUIRED
});

assert.equal(
    hasVoiceMessageFlag(
        VoiceMessageFlag.DTX | VoiceMessageFlag.DISCONTINUITY,
        VoiceMessageFlag.DTX
    ),
    true
);

assert.equal(
    hasVoiceMessageFlag(
        VoiceMessageFlag.DTX,
        VoiceMessageFlag.END_OF_STREAM
    ),
    false
);

assert.throws(
    () => validateVoiceMessageContract({
        messageType: VoiceMessageType.AUTH_REQUEST,
        flags: VoiceMessageFlag.DTX
    }),
    /are not allowed/
);

assert.throws(
    () => validateVoiceMessageContract({
        messageType: VoiceMessageType.VOICE_FRAME,
        flags: VoiceMessageFlag.END_OF_STREAM
    }),
    /are not allowed/
);

assert.throws(
    () => validateVoiceMessageContract({
        messageType: 7,
        flags: VoiceMessageFlag.NONE
    }),
    /Unknown Voice message type/
);

assert.throws(
    () => assertVoiceMessageFlagsValue(0x0010),
    /unknown bits/
);

console.log("VOICE_V1_3_MESSAGE_CONTRACT_TEST=OK");
