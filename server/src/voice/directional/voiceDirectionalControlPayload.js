import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    voiceBytesToUuid
} from "../protocol/voiceBinaryEnvelope.js";

const VOICE_DIRECTIONAL_CONTROL_VERSION = 1;
const VOICE_DIRECTIONAL_CONTROL_BYTES = 20;
const VOICE_SENDER_TO_RECEIVER_KIND = 4;

function isVoiceDirectionalControlPayload(input) {
    if (Buffer.isBuffer(input)) {
        return input.length === VOICE_DIRECTIONAL_CONTROL_BYTES &&
            input.readUInt8(1) === VOICE_SENDER_TO_RECEIVER_KIND;
    }

    if (input instanceof Uint8Array) {
        return input.byteLength === VOICE_DIRECTIONAL_CONTROL_BYTES &&
            input[1] === VOICE_SENDER_TO_RECEIVER_KIND;
    }

    if (input instanceof ArrayBuffer) {
        const view = new Uint8Array(input);
        return view.byteLength === VOICE_DIRECTIONAL_CONTROL_BYTES &&
            view[1] === VOICE_SENDER_TO_RECEIVER_KIND;
    }

    return false;
}

function decodeVoiceDirectionalControlPayload(input) {
    const payload = normalizeBinary(input);

    if (payload.length !== VOICE_DIRECTIONAL_CONTROL_BYTES) {
        throw new RangeError(
            `Voice directional control payload must contain ${VOICE_DIRECTIONAL_CONTROL_BYTES} bytes.`
        );
    }

    if (payload.readUInt8(0) !== VOICE_DIRECTIONAL_CONTROL_VERSION) {
        throw new Error("Unsupported Voice directional control version.");
    }

    if (payload.readUInt8(1) !== VOICE_SENDER_TO_RECEIVER_KIND) {
        throw new RangeError("Unknown Voice directional control kind.");
    }

    const blockedValue = payload.readUInt8(2);
    if (blockedValue !== 0 && blockedValue !== 1) {
        throw new RangeError("Voice directional blocked value must be zero or one.");
    }

    if (payload.readUInt8(3) !== 0) {
        throw new Error("Voice directional control reserved byte must be zero.");
    }

    const targetConnectionId = voiceBytesToUuid(payload.subarray(4, 20));
    if (targetConnectionId === VoiceBinaryProtocolConstants.emptyUuid) {
        throw new Error("Voice directional control requires a target connection id.");
    }

    return Object.freeze({
        blocked: blockedValue === 1,
        targetConnectionId
    });
}

function encodeVoiceDirectionalControlPayload({
    blocked,
    targetConnectionId
} = {}) {
    if (typeof blocked !== "boolean") {
        throw new TypeError("blocked must be a boolean.");
    }

    const normalizedConnectionId = normalizeConnectionId(targetConnectionId);
    if (!normalizedConnectionId || normalizedConnectionId === VoiceBinaryProtocolConstants.emptyUuid) {
        throw new Error("Voice directional control requires a target connection id.");
    }

    const compactUuid = normalizedConnectionId.replaceAll("-", "");
    if (!/^[0-9a-f]{32}$/.test(compactUuid)) {
        throw new TypeError("targetConnectionId must be a UUID.");
    }

    const payload = Buffer.alloc(VOICE_DIRECTIONAL_CONTROL_BYTES);
    payload.writeUInt8(VOICE_DIRECTIONAL_CONTROL_VERSION, 0);
    payload.writeUInt8(VOICE_SENDER_TO_RECEIVER_KIND, 1);
    payload.writeUInt8(blocked ? 1 : 0, 2);
    payload.writeUInt8(0, 3);
    Buffer.from(compactUuid, "hex").copy(payload, 4);
    return payload;
}

function normalizeBinary(input) {
    if (Buffer.isBuffer(input)) return input;

    if (input instanceof Uint8Array) {
        return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    }

    if (input instanceof ArrayBuffer) {
        return Buffer.from(input);
    }

    throw new TypeError("Voice directional control payload must be binary.");
}

function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

export {
    VOICE_SENDER_TO_RECEIVER_KIND,
    decodeVoiceDirectionalControlPayload,
    encodeVoiceDirectionalControlPayload,
    isVoiceDirectionalControlPayload
};
