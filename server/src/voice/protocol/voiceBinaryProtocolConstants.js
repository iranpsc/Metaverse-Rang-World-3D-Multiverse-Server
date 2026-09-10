// File: src/voice/protocol/voiceBinaryProtocolConstants.js

//* این ثابت‌ها اندازه و محل هر بخش از سربرگ باینری Voice را مشخص می‌کنند.
const VoiceBinaryProtocolConstants = Object.freeze({
    magicText: "MVVC",
    version: 1,
    byteOrder: "big_endian",
    fixedHeaderBytes: 60,
    emptyUuid: "00000000-0000-0000-0000-000000000000",

    offsets: Object.freeze({
        magic: 0,
        version: 4,
        messageType: 5,
        flags: 6,
        headerLength: 8,
        reserved: 10,
        payloadLength: 12,
        sequence: 16,
        timestampMs: 20,
        sessionId: 28,
        senderId: 44
    }),

    sizes: Object.freeze({
        magic: 4,
        version: 1,
        messageType: 1,
        flags: 2,
        headerLength: 2,
        reserved: 2,
        payloadLength: 4,
        sequence: 4,
        timestampMs: 8,
        sessionId: 16,
        senderId: 16
    })
});

export {
    VoiceBinaryProtocolConstants
};
