// مسیر فایل: src/voice/protocol/voiceProtocolV1Manifest.js

import {
    VoiceBinaryProtocolConstants
} from "./voiceBinaryProtocolConstants.js";

import {
    VoiceMessageFlag
} from "./voiceMessageFlags.js";

import {
    VoiceMessageType
} from "./voiceMessageTypes.js";

import {
    VoiceAuthRequestLayout,
    VoiceAuthResultLayout
} from "../auth/voiceAuthConstants.js";

import {
    VoiceSessionDescriptorLayout,
    VoiceSessionSnapshotLayout
} from "../session/voiceSessionConstants.js";

import {
    VoiceSessionMembershipPolicy
} from "../session/voiceSessionPolicy.js";

import {
    VoiceReconnectRequestLayout,
    VoiceReconnectResultLayout
} from "../reconnect/voiceReconnectConstants.js";

import {
    VoiceReconnectPolicy
} from "../reconnect/voiceReconnectPolicy.js";

//* این ثابت خلاصه کامل قرارداد نسخه یک ارتباط صوتی را نگه می‌دارد.
const VoiceProtocolV1Manifest = Object.freeze({
    version: VoiceBinaryProtocolConstants.version,

    envelope: Object.freeze({
        magicText:
            VoiceBinaryProtocolConstants.magicText,

        byteOrder:
            VoiceBinaryProtocolConstants.byteOrder,

        fixedHeaderBytes:
            VoiceBinaryProtocolConstants.fixedHeaderBytes
    }),

    messageTypes: Object.freeze({
        ...VoiceMessageType
    }),

    messageFlags: Object.freeze({
        ...VoiceMessageFlag
    }),

    authentication: Object.freeze({
        requestFixedBytes:
            VoiceAuthRequestLayout.fixedBytes,

        resultFixedBytes:
            VoiceAuthResultLayout.fixedBytes
    }),

    session: Object.freeze({
        descriptorFixedBytes:
            VoiceSessionDescriptorLayout.fixedBytes,

        snapshotFixedBytes:
            VoiceSessionSnapshotLayout.fixedBytes,

        enterDistanceMeters:
            VoiceSessionMembershipPolicy
                .enterDistanceMeters,

        exitDistanceMeters:
            VoiceSessionMembershipPolicy
                .exitDistanceMeters,

        nonTransitiveAudibility:
            VoiceSessionMembershipPolicy
                .nonTransitiveAudibility,

        sessionIdAuthority:
            VoiceSessionMembershipPolicy
                .sessionIdAuthority
    }),

    reconnect: Object.freeze({
        requestFixedBytes:
            VoiceReconnectRequestLayout.fixedBytes,

        resultFixedBytes:
            VoiceReconnectResultLayout.fixedBytes,

        firstRetryDelayMs:
            VoiceReconnectPolicy.firstRetryDelayMs,

        clientDeadlineMs:
            VoiceReconnectPolicy.clientDeadlineMs,

        serverRetentionMs:
            VoiceReconnectPolicy.serverRetentionMs
    })
});

export {
    VoiceProtocolV1Manifest
};

/*
توضیح فایل:
این فایل خلاصه نهایی قرارداد نسخه یک ارتباط صوتی را از ثابت‌های اصلی پروژه جمع‌آوری می‌کند تا اندازه بسته‌ها، شماره پیام‌ها، فاصله‌ها و مهلت‌های بازیابی از یک مرجع خوانده شوند.
*/
