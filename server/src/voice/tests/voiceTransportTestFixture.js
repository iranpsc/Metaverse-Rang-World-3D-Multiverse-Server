// مسیر فایل: src/voice/tests/voiceTransportTestFixture.js

import {
    VoiceAuthResultCode,
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    encodeVoiceAuthRequest
} from "../auth/voiceAuthPayload.js";

import {
    VoiceConnectionRegistrationService
} from "../core/voiceConnectionRegistrationService.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    decodeVoiceBinaryEnvelope,
    encodeVoiceBinaryEnvelope
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceTransportGateway
} from "../transport/voiceTransportGateway.js";

const voiceTransportTestIdentity = Object.freeze({
    userId: "database-user-66a123456789abcdef123456",
    roomId: "room_voice_transport_test",
    avatarId: "avatar_voice_transport_test",
    clientInstanceId:
        "123e4567-e89b-42d3-a456-426614174000",
    voiceConnectionId:
        "65adc593-c1b9-4677-8c79-a0b1f16393ab",
    accessToken:
        "valid.voice.transport.test.token"
});

class VoiceTransportTestPreparationService {
    //* این تابع ورودی احراز هویت آزمایشی را به ورودی واقعی سرویس ثبت اتصال تبدیل می‌کند.
    prepare(input = {}) {
        if (
            input.accessToken !==
            voiceTransportTestIdentity.accessToken
        ) {
            return Object.freeze({
                ready: false,
                retryable: false,
                code:
                    VoiceAuthResultCode.ACCESS_TOKEN_INVALID,
                userId: "",
                roomId: String(input.roomId ?? ""),
                registrationInput: null
            });
        }

        return Object.freeze({
            ready: true,
            retryable: false,
            code: VoiceAuthResultCode.AUTHENTICATED,
            userId: voiceTransportTestIdentity.userId,
            roomId: voiceTransportTestIdentity.roomId,
            registrationInput: Object.freeze({
                connectionId:
                    voiceTransportTestIdentity.voiceConnectionId,
                userId:
                    voiceTransportTestIdentity.userId,
                avatarId:
                    String(input.avatarId ?? "").trim(),
                roomId:
                    String(input.roomId ?? "").trim(),
                platform: input.platform,
                clientInstanceId:
                    String(input.clientInstanceId ?? "")
                        .trim()
                        .toLowerCase(),
                transportName:
                    String(input.transportName ?? "").trim(),
                transportConnectionKey:
                    String(
                        input.transportConnectionKey ?? ""
                    ).trim(),
                createdAtMs: input.createdAtMs
            })
        });
    }
}

//* این تابع محیط واقعی رجیستری و سرویس ثبت را با محدودیت‌های کوتاه مخصوص آزمون می‌سازد.
function createVoiceTransportTestFixture({
    authenticationTimeoutMs = 500,
    heartbeatTimeoutMs = 500,
    maxPacketBytes = 65536,
    maxBufferedBytes = 131072
} = {}) {
    const voiceConnectionRegistry =
        new VoiceConnectionRegistry();

    const connectionRegistrationService =
        new VoiceConnectionRegistrationService({
            connectionPreparationService:
                new VoiceTransportTestPreparationService(),
            voiceConnectionRegistry
        });

    const gateway = new VoiceTransportGateway({
        connectionRegistrationService,
        voiceConnectionRegistry,
        authenticationTimeoutMs,
        heartbeatTimeoutMs,
        maxPacketBytes,
        maxBufferedBytes
    });

    return Object.freeze({
        gateway,
        voiceConnectionRegistry,
        connectionRegistrationService,
        identity: voiceTransportTestIdentity
    });
}

//* این تابع یک درخواست احراز هویت کامل را داخل پاکت باینری نسخه یک قرار می‌دهد.
function createVoiceTransportAuthPacket({
    sequence = 0,
    accessToken = voiceTransportTestIdentity.accessToken
} = {}) {
    return encodeVoiceBinaryEnvelope({
        messageType: VoiceMessageType.AUTH_REQUEST,
        flags: VoiceMessageFlag.ACK_REQUIRED,
        sequence,
        payload: encodeVoiceAuthRequest({
            platform: VoiceClientPlatform.WEBGL,
            accessToken,
            roomId: voiceTransportTestIdentity.roomId,
            avatarId: voiceTransportTestIdentity.avatarId,
            clientInstanceId:
                voiceTransportTestIdentity.clientInstanceId,
            clientBuild: "voice-transport-test"
        })
    });
}

//* این تابع یک پیام سلامت بدون داده با شماره ترتیب اعلام‌شده می‌سازد.
function createVoiceTransportHeartbeatPacket(sequence) {
    return encodeVoiceBinaryEnvelope({
        messageType: VoiceMessageType.HEARTBEAT,
        flags: VoiceMessageFlag.ACK_REQUIRED,
        sequence,
        payload: Buffer.alloc(0)
    });
}

//* این تابع تا برقرارشدن شرط آزمایشی یا پایان مهلت کوتاه منتظر می‌ماند.
async function waitForVoiceTransportCondition(
    predicate,
    {
        timeoutMs = 1000,
        intervalMs = 5
    } = {}
) {
    const startedAtMs = Date.now();

    while (Date.now() - startedAtMs < timeoutMs) {
        if (predicate()) return;

        //* این انتظار کوتاه امکان تکمیل رویدادهای غیرهم‌زمان شنونده محلی را فراهم می‌کند.
        await new Promise(
            (resolve) => setTimeout(resolve, intervalMs)
        );
    }

    throw new Error(
        "Voice transport test condition timed out."
    );
}

export {
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestFixture,
    decodeVoiceBinaryEnvelope,
    voiceTransportTestIdentity,
    waitForVoiceTransportCondition
};

/*
توضیح فایل:
این فایل داده‌ها و سرویس‌های مشترک آزمون پایه راه انتقال را می‌سازد. شناسه کاربر آزمایشی عمداً شناسه یکتای شانزده‌بایتی نیست تا قرارداد رشته‌ای شناسه کاربر در تمام مسیرهای جدید بررسی شود.
*/
