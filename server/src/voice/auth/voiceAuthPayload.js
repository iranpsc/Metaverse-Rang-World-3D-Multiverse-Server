// File: src/voice/auth/voiceAuthPayload.js

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    voiceBytesToUuid,
    voiceUuidToBytes
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceAuthPayloadLimits,
    VoiceAuthRequestLayout,
    VoiceAuthResultCode,
    VoiceAuthResultLayout,
    assertVoiceAuthResultCode,
    assertVoiceClientPlatform
} from "./voiceAuthConstants.js";

//* این تابع ورودی باینری را به Buffer تبدیل می‌کند.
function normalizeBinaryPayload(value) {
    if (Buffer.isBuffer(value)) return value;

    if (value instanceof Uint8Array) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }

    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }

    throw new TypeError("Voice authentication payload must be Buffer, Uint8Array or ArrayBuffer.");
}

//* این تابع یک مقدار متنی را به UTF-8 تبدیل و اندازه آن را بررسی می‌کند.
function encodeUtf8Field(
    value,
    fieldName,
    maxBytes,
    {
        required = true
    } = {}
) {
    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a string.`);
    }

    const normalizedValue = value.trim();

    if (required && normalizedValue.length === 0) {
        throw new Error(`${fieldName} is required.`);
    }

    const bytes = Buffer.from(normalizedValue, "utf8");

    if (bytes.length > maxBytes) {
        throw new RangeError(`${fieldName} exceeds its maximum UTF-8 byte length.`);
    }

    return bytes;
}

//* این تابع یک فیلد متنی را از Payload می‌خواند.
function readUtf8Field(
    payload,
    offset,
    length,
    fieldName,
    maxBytes,
    {
        required = true
    } = {}
) {
    if (length > maxBytes) {
        throw new RangeError(`${fieldName} exceeds its maximum UTF-8 byte length.`);
    }

    const endOffset = offset + length;

    if (endOffset > payload.length) {
        throw new RangeError(`${fieldName} exceeds the received authentication payload.`);
    }

    const value = payload.subarray(offset, endOffset).toString("utf8").trim();

    if (required && value.length === 0) {
        throw new Error(`${fieldName} is required.`);
    }

    return {
        value,
        nextOffset: endOffset
    };
}

//* این تابع Payload باینری درخواست احراز هویت Voice را می‌سازد.
function encodeVoiceAuthRequest({
    platform,
    accessToken,
    roomId,
    avatarId,
    clientInstanceId,
    clientBuild = ""
} = {}) {
    assertVoiceClientPlatform(platform);

    const accessTokenBytes = encodeUtf8Field(
        accessToken,
        "accessToken",
        VoiceAuthPayloadLimits.accessTokenBytes
    );

    const roomIdBytes = encodeUtf8Field(
        roomId,
        "roomId",
        VoiceAuthPayloadLimits.roomIdBytes
    );

    const avatarIdBytes = encodeUtf8Field(
        avatarId,
        "avatarId",
        VoiceAuthPayloadLimits.avatarIdBytes
    );

    const clientBuildBytes = encodeUtf8Field(
        clientBuild,
        "clientBuild",
        VoiceAuthPayloadLimits.clientBuildBytes,
        {
            required: false
        }
    );

    const clientInstanceIdBytes = voiceUuidToBytes(clientInstanceId);
    const layout = VoiceAuthRequestLayout;

    const payload = Buffer.alloc(
        layout.fixedBytes +
        accessTokenBytes.length +
        roomIdBytes.length +
        avatarIdBytes.length +
        clientBuildBytes.length
    );

    payload.writeUInt8(platform, layout.offsets.platform);
    payload.writeUInt8(0, layout.offsets.reserved);
    payload.writeUInt16BE(accessTokenBytes.length, layout.offsets.accessTokenLength);
    payload.writeUInt16BE(roomIdBytes.length, layout.offsets.roomIdLength);
    payload.writeUInt16BE(avatarIdBytes.length, layout.offsets.avatarIdLength);
    payload.writeUInt16BE(clientBuildBytes.length, layout.offsets.clientBuildLength);

    clientInstanceIdBytes.copy(
        payload,
        layout.offsets.clientInstanceId
    );

    let cursor = layout.fixedBytes;

    accessTokenBytes.copy(payload, cursor);
    cursor += accessTokenBytes.length;

    roomIdBytes.copy(payload, cursor);
    cursor += roomIdBytes.length;

    avatarIdBytes.copy(payload, cursor);
    cursor += avatarIdBytes.length;

    clientBuildBytes.copy(payload, cursor);

    return payload;
}

//* این تابع Payload درخواست احراز هویت Voice را می‌خواند.
function decodeVoiceAuthRequest(input) {
    const payload = normalizeBinaryPayload(input);
    const layout = VoiceAuthRequestLayout;

    if (payload.length < layout.fixedBytes) {
        throw new RangeError(
            `Voice authentication request must contain at least ${layout.fixedBytes} bytes.`
        );
    }

    const platform = payload.readUInt8(layout.offsets.platform);
    const reserved = payload.readUInt8(layout.offsets.reserved);

    assertVoiceClientPlatform(platform);

    if (reserved !== 0) {
        throw new Error("Voice authentication request reserved byte must be zero.");
    }

    const accessTokenLength = payload.readUInt16BE(
        layout.offsets.accessTokenLength
    );

    const roomIdLength = payload.readUInt16BE(
        layout.offsets.roomIdLength
    );

    const avatarIdLength = payload.readUInt16BE(
        layout.offsets.avatarIdLength
    );

    const clientBuildLength = payload.readUInt16BE(
        layout.offsets.clientBuildLength
    );

    const expectedLength =
        layout.fixedBytes +
        accessTokenLength +
        roomIdLength +
        avatarIdLength +
        clientBuildLength;

    if (payload.length !== expectedLength) {
        throw new RangeError(
            `Voice authentication request length mismatch. Expected ${expectedLength}, received ${payload.length}.`
        );
    }

    const clientInstanceId = voiceBytesToUuid(
        payload.subarray(
            layout.offsets.clientInstanceId,
            layout.offsets.clientInstanceId + 16
        )
    );

    let cursor = layout.fixedBytes;

    const accessTokenResult = readUtf8Field(
        payload,
        cursor,
        accessTokenLength,
        "accessToken",
        VoiceAuthPayloadLimits.accessTokenBytes
    );

    cursor = accessTokenResult.nextOffset;

    const roomIdResult = readUtf8Field(
        payload,
        cursor,
        roomIdLength,
        "roomId",
        VoiceAuthPayloadLimits.roomIdBytes
    );

    cursor = roomIdResult.nextOffset;

    const avatarIdResult = readUtf8Field(
        payload,
        cursor,
        avatarIdLength,
        "avatarId",
        VoiceAuthPayloadLimits.avatarIdBytes
    );

    cursor = avatarIdResult.nextOffset;

    const clientBuildResult = readUtf8Field(
        payload,
        cursor,
        clientBuildLength,
        "clientBuild",
        VoiceAuthPayloadLimits.clientBuildBytes,
        {
            required: false
        }
    );

    return {
        platform,
        accessToken: accessTokenResult.value,
        roomId: roomIdResult.value,
        avatarId: avatarIdResult.value,
        clientInstanceId,
        clientBuild: clientBuildResult.value
    };
}

//* این تابع داده باینری نتیجه احراز هویت صوت را می‌سازد.
function encodeVoiceAuthResult({
    success,
    retryable = false,
    code,
    voiceConnectionId = VoiceBinaryProtocolConstants.emptyUuid,
    userId = "",
    message = ""
} = {}) {
    if (typeof success !== "boolean") {
        throw new TypeError("success must be a boolean.");
    }

    if (typeof retryable !== "boolean") {
        throw new TypeError("retryable must be a boolean.");
    }

    assertVoiceAuthResultCode(code);

    if (success && code !== VoiceAuthResultCode.AUTHENTICATED) {
        throw new Error("Successful Voice authentication must use the AUTHENTICATED result code.");
    }

    if (!success && code === VoiceAuthResultCode.AUTHENTICATED) {
        throw new Error("Failed Voice authentication cannot use the AUTHENTICATED result code.");
    }

    if (
        success &&
        voiceConnectionId === VoiceBinaryProtocolConstants.emptyUuid
    ) {
        throw new Error("Successful Voice authentication requires a connection identifier.");
    }

    const voiceConnectionIdBytes = voiceUuidToBytes(voiceConnectionId);

    const userIdBytes = encodeUtf8Field(
        userId,
        "userId",
        VoiceAuthPayloadLimits.resultUserIdBytes,
        {
            required: success
        }
    );

    const messageBytes = encodeUtf8Field(
        message,
        "message",
        VoiceAuthPayloadLimits.resultMessageBytes,
        {
            required: false
        }
    );

    const layout = VoiceAuthResultLayout;

    const payload = Buffer.alloc(
        layout.fixedBytes +
        userIdBytes.length +
        messageBytes.length
    );

    payload.writeUInt8(success ? 1 : 0, layout.offsets.success);
    payload.writeUInt8(retryable ? 1 : 0, layout.offsets.retryable);
    payload.writeUInt16BE(code, layout.offsets.code);

    voiceConnectionIdBytes.copy(
        payload,
        layout.offsets.voiceConnectionId
    );

    payload.writeUInt16BE(
        userIdBytes.length,
        layout.offsets.userIdLength
    );

    payload.writeUInt16BE(
        messageBytes.length,
        layout.offsets.messageLength
    );

    let cursor = layout.fixedBytes;

    userIdBytes.copy(payload, cursor);
    cursor += userIdBytes.length;
    messageBytes.copy(payload, cursor);

    return payload;
}

//* این تابع داده نتیجه احراز هویت صوت را از ورودی باینری می‌خواند.
function decodeVoiceAuthResult(input) {
    const payload = normalizeBinaryPayload(input);
    const layout = VoiceAuthResultLayout;

    if (payload.length < layout.fixedBytes) {
        throw new RangeError(
            `Voice authentication result must contain at least ${layout.fixedBytes} bytes.`
        );
    }

    const successValue = payload.readUInt8(layout.offsets.success);
    const retryableValue = payload.readUInt8(layout.offsets.retryable);

    if (successValue !== 0 && successValue !== 1) {
        throw new Error("Voice authentication success value must be zero or one.");
    }

    if (retryableValue !== 0 && retryableValue !== 1) {
        throw new Error("Voice authentication retryable value must be zero or one.");
    }

    const success = successValue === 1;
    const retryable = retryableValue === 1;
    const code = payload.readUInt16BE(layout.offsets.code);

    assertVoiceAuthResultCode(code);

    if (success && code !== VoiceAuthResultCode.AUTHENTICATED) {
        throw new Error("Successful Voice authentication has an invalid result code.");
    }

    if (!success && code === VoiceAuthResultCode.AUTHENTICATED) {
        throw new Error("Failed Voice authentication has an invalid result code.");
    }

    const voiceConnectionId = voiceBytesToUuid(
        payload.subarray(
            layout.offsets.voiceConnectionId,
            layout.offsets.voiceConnectionId + 16
        )
    );

    const userIdLength = payload.readUInt16BE(
        layout.offsets.userIdLength
    );

    const messageLength = payload.readUInt16BE(
        layout.offsets.messageLength
    );

    const expectedLength =
        layout.fixedBytes +
        userIdLength +
        messageLength;

    if (payload.length !== expectedLength) {
        throw new RangeError(
            `Voice authentication result length mismatch. Expected ${expectedLength}, received ${payload.length}.`
        );
    }

    let cursor = layout.fixedBytes;

    const userIdResult = readUtf8Field(
        payload,
        cursor,
        userIdLength,
        "userId",
        VoiceAuthPayloadLimits.resultUserIdBytes,
        {
            required: success
        }
    );

    cursor = userIdResult.nextOffset;

    const messageResult = readUtf8Field(
        payload,
        cursor,
        messageLength,
        "message",
        VoiceAuthPayloadLimits.resultMessageBytes,
        {
            required: false
        }
    );

    if (
        success &&
        voiceConnectionId === VoiceBinaryProtocolConstants.emptyUuid
    ) {
        throw new Error(
            "Successful Voice authentication result is missing the connection identifier."
        );
    }

    return {
        success,
        retryable,
        code,
        voiceConnectionId,
        userId: userIdResult.value,
        message: messageResult.value
    };
}

export {
    decodeVoiceAuthRequest,
    decodeVoiceAuthResult,
    encodeVoiceAuthRequest,
    encodeVoiceAuthResult
};
