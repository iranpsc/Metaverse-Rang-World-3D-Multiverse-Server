// مسیر فایل: src/voice/core/voiceConnectionConstants.js

//* این ثابت وضعیت‌های قابل استفاده برای اتصال صوتی را مشخص می‌کند.
const VoiceConnectionState = Object.freeze({
    AUTHENTICATED: 1,
    ACTIVE: 2,
    SUSPENDED: 3,
    CLOSING: 4,
    CLOSED: 5
});

//* این ثابت نام هر وضعیت اتصال صوتی را نگه می‌دارد.
const VoiceConnectionStateNameByValue = Object.freeze({
    1: "AUTHENTICATED",
    2: "ACTIVE",
    3: "SUSPENDED",
    4: "CLOSING",
    5: "CLOSED"
});

//* این ثابت علت‌های بسته‌شدن اتصال صوتی را مشخص می‌کند.
const VoiceConnectionCloseReason = Object.freeze({
    NONE: 0,
    CLIENT_DISCONNECTED: 1,
    TRANSPORT_CLOSED: 2,
    ROOM_LEFT: 3,
    AVATAR_DESPAWNED: 4,
    DEDICATED_DISCONNECTED: 5,
    ACCESS_REVOKED: 6,
    RECONNECT_EXPIRED: 7,
    SERVER_SHUTDOWN: 8
});

//* این ثابت نام هر علت بسته‌شدن اتصال صوتی را نگه می‌دارد.
const VoiceConnectionCloseReasonNameByValue = Object.freeze({
    0: "NONE",
    1: "CLIENT_DISCONNECTED",
    2: "TRANSPORT_CLOSED",
    3: "ROOM_LEFT",
    4: "AVATAR_DESPAWNED",
    5: "DEDICATED_DISCONNECTED",
    6: "ACCESS_REVOKED",
    7: "RECONNECT_EXPIRED",
    8: "SERVER_SHUTDOWN"
});

//* این ثابت بیشترین اندازه مجاز فیلدهای متنی اتصال صوتی را مشخص می‌کند.
const VoiceConnectionFieldLimits = Object.freeze({
    roomIdBytes: 512,
    avatarIdBytes: 512,
    transportNameBytes: 128,
    transportConnectionKeyBytes: 512
});

export {
    VoiceConnectionCloseReason,
    VoiceConnectionCloseReasonNameByValue,
    VoiceConnectionFieldLimits,
    VoiceConnectionState,
    VoiceConnectionStateNameByValue
};

/*
توضیح فایل:
این فایل وضعیت‌های اتصال صوتی، علت‌های بسته‌شدن اتصال و اندازه مجاز فیلدهای متنی را در یک محل ثابت نگه می‌دارد.
*/
