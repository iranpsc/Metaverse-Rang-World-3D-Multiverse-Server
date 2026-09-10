// File: src/voice/protocol/voiceMessageFlags.js

//* این ثابت بیت‌های قابل استفاده در فیلد Flags را مشخص می‌کند.
const VoiceMessageFlag = Object.freeze({
    NONE: 0x0000,
    ACK_REQUIRED: 0x0001,
    DTX: 0x0002,
    END_OF_STREAM: 0x0004,
    DISCONTINUITY: 0x0008
});

const VOICE_MESSAGE_KNOWN_FLAG_MASK =
    VoiceMessageFlag.ACK_REQUIRED |
    VoiceMessageFlag.DTX |
    VoiceMessageFlag.END_OF_STREAM |
    VoiceMessageFlag.DISCONTINUITY;

//* این تابع مقدار Flags را از نظر محدوده و بیت‌های شناخته‌شده بررسی می‌کند.
function assertVoiceMessageFlagsValue(flags) {
    if (!Number.isSafeInteger(flags) || flags < 0 || flags > 0xffff) {
        throw new RangeError("Voice message flags must be an unsigned 16-bit integer.");
    }

    if ((flags & VOICE_MESSAGE_KNOWN_FLAG_MASK) !== flags) {
        throw new RangeError(`Voice message flags contain unknown bits: ${flags}.`);
    }

    return flags;
}

//* این تابع بررسی می‌کند یک Flag مشخص داخل مقدار Flags فعال است.
function hasVoiceMessageFlag(flags, flag) {
    assertVoiceMessageFlagsValue(flags);
    return (flags & flag) === flag;
}

export {
    VOICE_MESSAGE_KNOWN_FLAG_MASK,
    VoiceMessageFlag,
    assertVoiceMessageFlagsValue,
    hasVoiceMessageFlag
};
