import {
    VoiceRecordingState,
    VoiceRecordingStopReason
} from "./voiceRecordingConstants.js";

const VOICE_RECORDING_CONTROL_VERSION = 1;
const VOICE_RECORDING_CONSENT_BYTES = 4;
const VOICE_RECORDING_STATE_BYTES = 4;

//* این تابع داده باینری ضبط را به Buffer تبدیل می‌کند.
function normalizeVoiceRecordingBinary(input) {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) {
        return Buffer.from(
            input.buffer,
            input.byteOffset,
            input.byteLength
        );
    }
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    throw new TypeError("Voice recording payload must be binary.");
}

//* این تابع تغییر رضایت ضبط را به قرارداد چهار بایتی تبدیل می‌کند.
function encodeVoiceRecordingConsentPayload({ consented } = {}) {
    if (typeof consented !== "boolean") {
        throw new TypeError("consented must be a boolean.");
    }

    const payload = Buffer.alloc(VOICE_RECORDING_CONSENT_BYTES);
    payload.writeUInt8(VOICE_RECORDING_CONTROL_VERSION, 0);
    payload.writeUInt8(consented ? 1 : 0, 1);
    payload.writeUInt16BE(0, 2);
    return payload;
}

//* این تابع تغییر رضایت ضبط را از قرارداد چهار بایتی می‌خواند.
function decodeVoiceRecordingConsentPayload(input) {
    const payload = normalizeVoiceRecordingBinary(input);

    if (
        payload.length !== VOICE_RECORDING_CONSENT_BYTES ||
        payload.readUInt8(0) !== VOICE_RECORDING_CONTROL_VERSION ||
        payload.readUInt16BE(2) !== 0
    ) {
        throw new Error("Voice recording consent payload is invalid.");
    }

    const value = payload.readUInt8(1);
    if (value !== 0 && value !== 1) {
        throw new Error("Voice recording consent value is invalid.");
    }

    return Object.freeze({ consented: value === 1 });
}

//* این تابع وضعیت ضبط و علت اختیاری آن را برای ارسال به اعضا می‌سازد.
function encodeVoiceRecordingStatePayload({
    state,
    reason = 0
} = {}) {
    if (!Object.values(VoiceRecordingState).includes(state)) {
        throw new RangeError("Unknown Voice recording state.");
    }

    if (
        reason !== 0 &&
        !Object.values(VoiceRecordingStopReason).includes(reason)
    ) {
        throw new RangeError("Unknown Voice recording stop reason.");
    }

    const payload = Buffer.alloc(VOICE_RECORDING_STATE_BYTES);
    payload.writeUInt8(VOICE_RECORDING_CONTROL_VERSION, 0);
    payload.writeUInt8(state, 1);
    payload.writeUInt8(reason, 2);
    payload.writeUInt8(0, 3);
    return payload;
}

//* این تابع وضعیت ضبط را از قرارداد چهار بایتی می‌خواند.
function decodeVoiceRecordingStatePayload(input) {
    const payload = normalizeVoiceRecordingBinary(input);

    if (
        payload.length !== VOICE_RECORDING_STATE_BYTES ||
        payload.readUInt8(0) !== VOICE_RECORDING_CONTROL_VERSION ||
        payload.readUInt8(3) !== 0
    ) {
        throw new Error("Voice recording state payload is invalid.");
    }

    const state = payload.readUInt8(1);
    const reason = payload.readUInt8(2);

    if (!Object.values(VoiceRecordingState).includes(state)) {
        throw new RangeError("Unknown Voice recording state.");
    }

    if (
        reason !== 0 &&
        !Object.values(VoiceRecordingStopReason).includes(reason)
    ) {
        throw new RangeError("Unknown Voice recording stop reason.");
    }

    return Object.freeze({ state, reason });
}

export {
    VOICE_RECORDING_CONSENT_BYTES,
    VOICE_RECORDING_STATE_BYTES,
    decodeVoiceRecordingConsentPayload,
    decodeVoiceRecordingStatePayload,
    encodeVoiceRecordingConsentPayload,
    encodeVoiceRecordingStatePayload
};

/*
توضیح فایل:
این فایل قرارداد دودویی رضایت ضبط و وضعیت ضبط را تعریف می‌کند و هیچ شناسه هویتی را از کلاینت دریافت نمی‌کند.
*/
