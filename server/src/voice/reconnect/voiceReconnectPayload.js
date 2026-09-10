// مسیر فایل: src/voice/reconnect/voiceReconnectPayload.js

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    voiceBytesToUuid,
    voiceUuidToBytes
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceReconnectPayloadLimits,
    VoiceReconnectRequestLayout,
    VoiceReconnectResultCode,
    VoiceReconnectResultLayout,
    assertVoiceReconnectResultCode
} from "./voiceReconnectConstants.js";

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT64 = 0xffffffffffffffffn;

//* این تابع ورودی دودویی را به بافر قابل پردازش تبدیل می‌کند.
function normalizeVoiceReconnectBinary(value) {
    if (Buffer.isBuffer(value)) return value;

    if (value instanceof Uint8Array) {
        return Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength
        );
    }

    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }

    throw new TypeError(
        "Voice reconnect payload must be Buffer, Uint8Array or ArrayBuffer."
    );
}

//* این تابع یک عدد صحیح نامنفی را در محدوده تعیین‌شده بررسی می‌کند.
function assertVoiceReconnectUnsignedInteger(
    value,
    fieldName,
    maximumValue
) {
    if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > maximumValue
    ) {
        throw new RangeError(
            `${fieldName} is outside its unsigned integer range.`
        );
    }

    return value;
}

//* این تابع زمان ورودی را به عدد صحیح شصت‌وچهاربیتی تبدیل می‌کند.
function normalizeVoiceReconnectTimestamp(
    value,
    fieldName
) {
    if (typeof value === "bigint") {
        if (
            value < 0n ||
            value > MAX_UINT64
        ) {
            throw new RangeError(
                `${fieldName} is outside the unsigned 64-bit range.`
            );
        }

        return value;
    }

    if (
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new RangeError(
            `${fieldName} must be a non-negative safe integer or bigint.`
        );
    }

    return BigInt(value);
}

//* این تابع یک متن را به بایت‌های یوتی‌اف هشت تبدیل و اندازه آن را بررسی می‌کند.
function encodeVoiceReconnectText(
    value,
    fieldName,
    maximumBytes,
    {
        required = true
    } = {}
) {
    if (typeof value !== "string") {
        throw new TypeError(
            `${fieldName} must be a string.`
        );
    }

    const normalizedValue = value.trim();

    if (
        required &&
        normalizedValue.length === 0
    ) {
        throw new Error(
            `${fieldName} is required.`
        );
    }

    const bytes = Buffer.from(
        normalizedValue,
        "utf8"
    );

    if (bytes.length > maximumBytes) {
        throw new RangeError(
            `${fieldName} exceeds its maximum UTF-8 byte length.`
        );
    }

    return bytes;
}

//* این تابع یک متن را از بخش مشخص‌شده داده دودویی می‌خواند.
function readVoiceReconnectText(
    payload,
    offset,
    length,
    fieldName,
    maximumBytes,
    {
        required = true
    } = {}
) {
    if (length > maximumBytes) {
        throw new RangeError(
            `${fieldName} exceeds its maximum UTF-8 byte length.`
        );
    }

    const endOffset = offset + length;

    if (endOffset > payload.length) {
        throw new RangeError(
            `${fieldName} exceeds the received payload length.`
        );
    }

    const value = payload
        .subarray(offset, endOffset)
        .toString("utf8")
        .trim();

    if (
        required &&
        value.length === 0
    ) {
        throw new Error(
            `${fieldName} is required.`
        );
    }

    return {
        value,
        nextOffset: endOffset
    };
}

//* این تابع داده دودویی درخواست بازیابی اتصال صوتی را می‌سازد.
function encodeVoiceReconnectRequest({
    previousVoiceConnectionId,
    clientInstanceId,
    lastReceivedSequence = 0,
    lastPublishedSequence = 0,
    disconnectedAtMs,
    accessToken,
    roomId,
    avatarId
} = {}) {
    assertVoiceReconnectUnsignedInteger(
        lastReceivedSequence,
        "lastReceivedSequence",
        MAX_UINT32
    );

    assertVoiceReconnectUnsignedInteger(
        lastPublishedSequence,
        "lastPublishedSequence",
        MAX_UINT32
    );

    const disconnectedAt =
        normalizeVoiceReconnectTimestamp(
            disconnectedAtMs,
            "disconnectedAtMs"
        );

    const previousConnectionBytes =
        voiceUuidToBytes(
            previousVoiceConnectionId
        );

    const clientInstanceBytes =
        voiceUuidToBytes(
            clientInstanceId
        );

    const accessTokenBytes =
        encodeVoiceReconnectText(
            accessToken,
            "accessToken",
            VoiceReconnectPayloadLimits.accessTokenBytes
        );

    const roomIdBytes =
        encodeVoiceReconnectText(
            roomId,
            "roomId",
            VoiceReconnectPayloadLimits.roomIdBytes
        );

    const avatarIdBytes =
        encodeVoiceReconnectText(
            avatarId,
            "avatarId",
            VoiceReconnectPayloadLimits.avatarIdBytes
        );

    const layout = VoiceReconnectRequestLayout;

    const payload = Buffer.alloc(
        layout.fixedBytes +
        accessTokenBytes.length +
        roomIdBytes.length +
        avatarIdBytes.length
    );

    previousConnectionBytes.copy(
        payload,
        layout.offsets.previousVoiceConnectionId
    );

    clientInstanceBytes.copy(
        payload,
        layout.offsets.clientInstanceId
    );

    payload.writeUInt32BE(
        lastReceivedSequence,
        layout.offsets.lastReceivedSequence
    );

    payload.writeUInt32BE(
        lastPublishedSequence,
        layout.offsets.lastPublishedSequence
    );

    payload.writeBigUInt64BE(
        disconnectedAt,
        layout.offsets.disconnectedAtMs
    );

    payload.writeUInt16BE(
        accessTokenBytes.length,
        layout.offsets.accessTokenLength
    );

    payload.writeUInt16BE(
        roomIdBytes.length,
        layout.offsets.roomIdLength
    );

    payload.writeUInt16BE(
        avatarIdBytes.length,
        layout.offsets.avatarIdLength
    );

    payload.writeUInt16BE(
        0,
        layout.offsets.reserved
    );

    let cursor = layout.fixedBytes;

    accessTokenBytes.copy(payload, cursor);
    cursor += accessTokenBytes.length;

    roomIdBytes.copy(payload, cursor);
    cursor += roomIdBytes.length;

    avatarIdBytes.copy(payload, cursor);

    return payload;
}

//* این تابع داده دودویی درخواست بازیابی اتصال صوتی را می‌خواند.
function decodeVoiceReconnectRequest(input) {
    const payload =
        normalizeVoiceReconnectBinary(input);

    const layout = VoiceReconnectRequestLayout;

    if (payload.length < layout.fixedBytes) {
        throw new RangeError(
            `Voice reconnect request must contain at least ${layout.fixedBytes} bytes.`
        );
    }

    const previousVoiceConnectionId =
        voiceBytesToUuid(
            payload.subarray(
                layout.offsets.previousVoiceConnectionId,
                layout.offsets.previousVoiceConnectionId + 16
            )
        );

    const clientInstanceId =
        voiceBytesToUuid(
            payload.subarray(
                layout.offsets.clientInstanceId,
                layout.offsets.clientInstanceId + 16
            )
        );

    const lastReceivedSequence =
        payload.readUInt32BE(
            layout.offsets.lastReceivedSequence
        );

    const lastPublishedSequence =
        payload.readUInt32BE(
            layout.offsets.lastPublishedSequence
        );

    const disconnectedAtMs =
        payload.readBigUInt64BE(
            layout.offsets.disconnectedAtMs
        );

    const accessTokenLength =
        payload.readUInt16BE(
            layout.offsets.accessTokenLength
        );

    const roomIdLength =
        payload.readUInt16BE(
            layout.offsets.roomIdLength
        );

    const avatarIdLength =
        payload.readUInt16BE(
            layout.offsets.avatarIdLength
        );

    const reserved =
        payload.readUInt16BE(
            layout.offsets.reserved
        );

    if (reserved !== 0) {
        throw new Error(
            "Voice reconnect request reserved field must be zero."
        );
    }

    const expectedLength =
        layout.fixedBytes +
        accessTokenLength +
        roomIdLength +
        avatarIdLength;

    if (payload.length !== expectedLength) {
        throw new RangeError(
            `Voice reconnect request length mismatch. Expected ${expectedLength}, received ${payload.length}.`
        );
    }

    let cursor = layout.fixedBytes;

    const accessTokenResult =
        readVoiceReconnectText(
            payload,
            cursor,
            accessTokenLength,
            "accessToken",
            VoiceReconnectPayloadLimits.accessTokenBytes
        );

    cursor = accessTokenResult.nextOffset;

    const roomIdResult =
        readVoiceReconnectText(
            payload,
            cursor,
            roomIdLength,
            "roomId",
            VoiceReconnectPayloadLimits.roomIdBytes
        );

    cursor = roomIdResult.nextOffset;

    const avatarIdResult =
        readVoiceReconnectText(
            payload,
            cursor,
            avatarIdLength,
            "avatarId",
            VoiceReconnectPayloadLimits.avatarIdBytes
        );

    return {
        previousVoiceConnectionId,
        clientInstanceId,
        lastReceivedSequence,
        lastPublishedSequence,
        disconnectedAtMs,
        accessToken: accessTokenResult.value,
        roomId: roomIdResult.value,
        avatarId: avatarIdResult.value
    };
}

//* این تابع داده دودویی نتیجه بازیابی اتصال صوتی را می‌سازد.
function encodeVoiceReconnectResult({
    success,
    retryable = false,
    code,
    voiceConnectionId =
        VoiceBinaryProtocolConstants.emptyUuid,
    resumeFromSequence = 0,
    serverTimeMs = Date.now(),
    retainedSessionCount = 0,
    message = ""
} = {}) {
    if (typeof success !== "boolean") {
        throw new TypeError(
            "success must be a boolean."
        );
    }

    if (typeof retryable !== "boolean") {
        throw new TypeError(
            "retryable must be a boolean."
        );
    }

    assertVoiceReconnectResultCode(code);

    if (
        success &&
        code !== VoiceReconnectResultCode.RESUMED
    ) {
        throw new Error(
            "Successful Voice reconnect must use the RESUMED result code."
        );
    }

    if (
        !success &&
        code === VoiceReconnectResultCode.RESUMED
    ) {
        throw new Error(
            "Failed Voice reconnect cannot use the RESUMED result code."
        );
    }

    if (
        success &&
        voiceConnectionId ===
            VoiceBinaryProtocolConstants.emptyUuid
    ) {
        throw new Error(
            "Successful Voice reconnect requires a connection identifier."
        );
    }

    assertVoiceReconnectUnsignedInteger(
        resumeFromSequence,
        "resumeFromSequence",
        MAX_UINT32
    );

    assertVoiceReconnectUnsignedInteger(
        retainedSessionCount,
        "retainedSessionCount",
        MAX_UINT16
    );

    const serverTime =
        normalizeVoiceReconnectTimestamp(
            serverTimeMs,
            "serverTimeMs"
        );

    const voiceConnectionBytes =
        voiceUuidToBytes(voiceConnectionId);

    const messageBytes =
        encodeVoiceReconnectText(
            message,
            "message",
            VoiceReconnectPayloadLimits.resultMessageBytes,
            {
                required: false
            }
        );

    const layout = VoiceReconnectResultLayout;

    const payload = Buffer.alloc(
        layout.fixedBytes +
        messageBytes.length
    );

    payload.writeUInt8(
        success ? 1 : 0,
        layout.offsets.success
    );

    payload.writeUInt8(
        retryable ? 1 : 0,
        layout.offsets.retryable
    );

    payload.writeUInt16BE(
        code,
        layout.offsets.code
    );

    voiceConnectionBytes.copy(
        payload,
        layout.offsets.voiceConnectionId
    );

    payload.writeUInt32BE(
        resumeFromSequence,
        layout.offsets.resumeFromSequence
    );

    payload.writeBigUInt64BE(
        serverTime,
        layout.offsets.serverTimeMs
    );

    payload.writeUInt16BE(
        retainedSessionCount,
        layout.offsets.retainedSessionCount
    );

    payload.writeUInt16BE(
        messageBytes.length,
        layout.offsets.messageLength
    );

    messageBytes.copy(
        payload,
        layout.fixedBytes
    );

    return payload;
}

//* این تابع داده دودویی نتیجه بازیابی اتصال صوتی را می‌خواند.
function decodeVoiceReconnectResult(input) {
    const payload =
        normalizeVoiceReconnectBinary(input);

    const layout = VoiceReconnectResultLayout;

    if (payload.length < layout.fixedBytes) {
        throw new RangeError(
            `Voice reconnect result must contain at least ${layout.fixedBytes} bytes.`
        );
    }

    const successValue =
        payload.readUInt8(
            layout.offsets.success
        );

    const retryableValue =
        payload.readUInt8(
            layout.offsets.retryable
        );

    if (
        successValue !== 0 &&
        successValue !== 1
    ) {
        throw new Error(
            "Voice reconnect success value must be zero or one."
        );
    }

    if (
        retryableValue !== 0 &&
        retryableValue !== 1
    ) {
        throw new Error(
            "Voice reconnect retryable value must be zero or one."
        );
    }

    const success = successValue === 1;
    const retryable = retryableValue === 1;

    const code =
        payload.readUInt16BE(
            layout.offsets.code
        );

    assertVoiceReconnectResultCode(code);

    if (
        success &&
        code !== VoiceReconnectResultCode.RESUMED
    ) {
        throw new Error(
            "Successful Voice reconnect has an invalid result code."
        );
    }

    if (
        !success &&
        code === VoiceReconnectResultCode.RESUMED
    ) {
        throw new Error(
            "Failed Voice reconnect has an invalid result code."
        );
    }

    const voiceConnectionId =
        voiceBytesToUuid(
            payload.subarray(
                layout.offsets.voiceConnectionId,
                layout.offsets.voiceConnectionId + 16
            )
        );

    if (
        success &&
        voiceConnectionId ===
            VoiceBinaryProtocolConstants.emptyUuid
    ) {
        throw new Error(
            "Successful Voice reconnect result is missing the connection identifier."
        );
    }

    const resumeFromSequence =
        payload.readUInt32BE(
            layout.offsets.resumeFromSequence
        );

    const serverTimeMs =
        payload.readBigUInt64BE(
            layout.offsets.serverTimeMs
        );

    const retainedSessionCount =
        payload.readUInt16BE(
            layout.offsets.retainedSessionCount
        );

    const messageLength =
        payload.readUInt16BE(
            layout.offsets.messageLength
        );

    const expectedLength =
        layout.fixedBytes + messageLength;

    if (payload.length !== expectedLength) {
        throw new RangeError(
            `Voice reconnect result length mismatch. Expected ${expectedLength}, received ${payload.length}.`
        );
    }

    const messageResult =
        readVoiceReconnectText(
            payload,
            layout.fixedBytes,
            messageLength,
            "message",
            VoiceReconnectPayloadLimits.resultMessageBytes,
            {
                required: false
            }
        );

    return {
        success,
        retryable,
        code,
        voiceConnectionId,
        resumeFromSequence,
        serverTimeMs,
        retainedSessionCount,
        message: messageResult.value
    };
}

export {
    decodeVoiceReconnectRequest,
    decodeVoiceReconnectResult,
    encodeVoiceReconnectRequest,
    encodeVoiceReconnectResult
};

/*
توضیح فایل:
این فایل درخواست و نتیجه بازیابی اتصال صوتی را به داده دودویی تبدیل می‌کند و همان داده را پس از دریافت دوباره به اطلاعات قابل استفاده برمی‌گرداند.
*/
