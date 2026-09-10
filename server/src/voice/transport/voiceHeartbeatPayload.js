// مسیر فایل: src/voice/transport/voiceHeartbeatPayload.js

const VOICE_HEARTBEAT_ACK_BYTES = 4;
const VOICE_MAX_SEQUENCE = 0xffffffff;

//* این تابع شماره پیام ضربان دریافت‌شده را به داده چهار بایتی پاسخ تبدیل می‌کند.
function encodeVoiceHeartbeatAckPayload(sequence) {
    if (
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        sequence > VOICE_MAX_SEQUENCE
    ) {
        throw new RangeError(
            "Heartbeat acknowledged sequence must be an unsigned 32-bit integer."
        );
    }

    const payload = Buffer.allocUnsafe(
        VOICE_HEARTBEAT_ACK_BYTES
    );

    payload.writeUInt32BE(sequence, 0);

    return payload;
}

//* این تابع داده پاسخ ضربان را بررسی و شماره پیام تأییدشده را استخراج می‌کند.
function decodeVoiceHeartbeatAckPayload(input) {
    let payload = null;

    if (Buffer.isBuffer(input)) {
        payload = input;
    } else if (input instanceof Uint8Array) {
        payload = Buffer.from(
            input.buffer,
            input.byteOffset,
            input.byteLength
        );
    } else if (input instanceof ArrayBuffer) {
        payload = Buffer.from(input);
    } else {
        throw new TypeError(
            "Heartbeat acknowledgement payload must be binary."
        );
    }

    if (
        payload.length !==
        VOICE_HEARTBEAT_ACK_BYTES
    ) {
        throw new RangeError(
            `Heartbeat acknowledgement payload must contain exactly ${VOICE_HEARTBEAT_ACK_BYTES} bytes.`
        );
    }

    return payload.readUInt32BE(0);
}

export {
    VOICE_HEARTBEAT_ACK_BYTES,
    decodeVoiceHeartbeatAckPayload,
    encodeVoiceHeartbeatAckPayload
};

/*
توضیح فایل:
این فایل قرارداد چهار بایتی پاسخ ضربان را نگه می‌دارد تا هر پاسخ دقیقاً شماره همان پیام ضربان را تأیید کند.
*/
