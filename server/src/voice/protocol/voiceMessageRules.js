// File: src/voice/protocol/voiceMessageRules.js

import {
    VoiceMessageType,
    assertKnownVoiceMessageType
} from "./voiceMessageTypes.js";

import {
    VoiceMessageFlag,
    assertVoiceMessageFlagsValue
} from "./voiceMessageFlags.js";

//* این ثابت جهت مجاز هر پیام را مشخص می‌کند.
const VoiceMessageDirection = Object.freeze({
    CLIENT_TO_SERVER: "client_to_server",
    SERVER_TO_CLIENT: "server_to_client",
    BIDIRECTIONAL: "bidirectional"
});

//* این ثابت نوع Payload هر پیام را مشخص می‌کند.
const VoicePayloadKind = Object.freeze({
    EMPTY: "empty",
    CONTROL_BINARY: "control_binary",
    OPUS_FRAME: "opus_frame"
});

//* این تابع یک قانون پیام قفل‌شده می‌سازد.
function createRule(direction, payloadKind, allowedFlags = VoiceMessageFlag.NONE) {
    return Object.freeze({
        direction,
        payloadKind,
        allowedFlags
    });
}

//* این ثابت قانون هر نوع پیام Voice را نگه می‌دارد.
const VoiceMessageRules = Object.freeze({
    [VoiceMessageType.AUTH_REQUEST]: createRule(
        VoiceMessageDirection.CLIENT_TO_SERVER,
        VoicePayloadKind.CONTROL_BINARY,
        VoiceMessageFlag.ACK_REQUIRED
    ),

    [VoiceMessageType.AUTH_RESULT]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.HEARTBEAT]: createRule(
        VoiceMessageDirection.BIDIRECTIONAL,
        VoicePayloadKind.EMPTY,
        VoiceMessageFlag.ACK_REQUIRED
    ),

    [VoiceMessageType.HEARTBEAT_ACK]: createRule(
        VoiceMessageDirection.BIDIRECTIONAL,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.DISCONNECT]: createRule(
        VoiceMessageDirection.BIDIRECTIONAL,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.ACK]: createRule(
        VoiceMessageDirection.BIDIRECTIONAL,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.SESSION_SNAPSHOT]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.SESSION_JOINED]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.SESSION_LEFT]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.SESSION_CLOSED]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.PUBLISH_START]: createRule(
        VoiceMessageDirection.CLIENT_TO_SERVER,
        VoicePayloadKind.CONTROL_BINARY,
        VoiceMessageFlag.ACK_REQUIRED
    ),

    [VoiceMessageType.VOICE_FRAME]: createRule(
        VoiceMessageDirection.BIDIRECTIONAL,
        VoicePayloadKind.OPUS_FRAME,
        VoiceMessageFlag.DTX | VoiceMessageFlag.DISCONTINUITY
    ),

    [VoiceMessageType.PUBLISH_STOP]: createRule(
        VoiceMessageDirection.BIDIRECTIONAL,
        VoicePayloadKind.CONTROL_BINARY,
        VoiceMessageFlag.ACK_REQUIRED | VoiceMessageFlag.END_OF_STREAM
    ),

    [VoiceMessageType.LISTENER_MUTE_CHANGED]: createRule(
        VoiceMessageDirection.CLIENT_TO_SERVER,
        VoicePayloadKind.CONTROL_BINARY,
        VoiceMessageFlag.ACK_REQUIRED
    ),

    [VoiceMessageType.RECORDING_CONSENT_CHANGED]: createRule(
        VoiceMessageDirection.CLIENT_TO_SERVER,
        VoicePayloadKind.CONTROL_BINARY,
        VoiceMessageFlag.ACK_REQUIRED
    ),

    [VoiceMessageType.RECORDING_STATE_CHANGED]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.RECONNECT_REQUEST]: createRule(
        VoiceMessageDirection.CLIENT_TO_SERVER,
        VoicePayloadKind.CONTROL_BINARY,
        VoiceMessageFlag.ACK_REQUIRED
    ),

    [VoiceMessageType.RECONNECT_RESULT]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    ),

    [VoiceMessageType.ERROR]: createRule(
        VoiceMessageDirection.SERVER_TO_CLIENT,
        VoicePayloadKind.CONTROL_BINARY
    )
});

//* این تابع قانون یک نوع پیام را برمی‌گرداند.
function getVoiceMessageRule(messageType) {
    assertKnownVoiceMessageType(messageType);

    const rule = VoiceMessageRules[messageType];

    if (!rule) {
        throw new Error(`Voice message rule is missing for type ${messageType}.`);
    }

    return rule;
}

//* این تابع نوع پیام و Flags آن را با قرارداد Voice تطبیق می‌دهد.
function validateVoiceMessageContract({
    messageType,
    flags = VoiceMessageFlag.NONE
} = {}) {
    const rule = getVoiceMessageRule(messageType);

    assertVoiceMessageFlagsValue(flags);

    if ((flags & rule.allowedFlags) !== flags) {
        throw new Error(
            `Voice message flags ${flags} are not allowed for message type ${messageType}.`
        );
    }

    return rule;
}

export {
    VoiceMessageDirection,
    VoiceMessageRules,
    VoicePayloadKind,
    getVoiceMessageRule,
    validateVoiceMessageContract
};
