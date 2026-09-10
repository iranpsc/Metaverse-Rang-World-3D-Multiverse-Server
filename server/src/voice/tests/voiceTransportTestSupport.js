// مسیر فایل: src/voice/tests/voiceTransportTestSupport.js

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
    encodeVoiceBinaryEnvelope
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    encodeVoiceHeartbeatAckPayload
} from "../transport/voiceHeartbeatPayload.js";

import {
    VoiceTransportGateway
} from "../transport/voiceTransportGateway.js";

const VOICE_TRANSPORT_TEST_USER_ID =
    "voice.user+transport@example.test";

const VOICE_TRANSPORT_TEST_ROOM_ID =
    "room_voice_transport_foundation";

const VOICE_TRANSPORT_TEST_AVATAR_ID =
    VOICE_TRANSPORT_TEST_USER_ID;

const VOICE_TRANSPORT_TEST_ACCESS_TOKEN =
    "voice.transport.valid.access.token";

const VOICE_TRANSPORT_TEST_CLIENT_INSTANCE_ID =
    "123e4567-e89b-42d3-a456-426614174000";

const VOICE_TRANSPORT_TEST_CONNECTION_ID =
    "65adc593-c1b9-4677-8c79-a0b1f16393ab";

class VoiceTransportTestPreparationService {
    //* این سازنده شناسه کاربر و اتصال معتبر آزمون را نگه می‌دارد.
    constructor({
        userId =
            VOICE_TRANSPORT_TEST_USER_ID,
        connectionId =
            VOICE_TRANSPORT_TEST_CONNECTION_ID
    } = {}) {
        this.userId = userId;
        this.connectionId =
            connectionId;
    }

    //* این تابع نتیجه آماده‌سازی معتبر یا نامعتبر را برای سرویس واقعی ثبت اتصال می‌سازد.
    prepare(input = {}) {
        if (
            input.accessToken !==
            VOICE_TRANSPORT_TEST_ACCESS_TOKEN
        ) {
            return Object.freeze({
                ready: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .ACCESS_TOKEN_INVALID,
                userId: "",
                roomId:
                    String(
                        input.roomId ?? ""
                    ).trim(),
                registrationInput: null
            });
        }

        return Object.freeze({
            ready: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            userId: this.userId,
            roomId:
                String(input.roomId),
            registrationInput:
                Object.freeze({
                    connectionId:
                        this.connectionId,
                    userId:
                        this.userId,
                    avatarId:
                        String(
                            input.avatarId
                        ),
                    roomId:
                        String(input.roomId),
                    platform:
                        input.platform,
                    clientInstanceId:
                        String(
                            input.clientInstanceId
                        ),
                    transportName:
                        String(
                            input.transportName
                        ),
                    transportConnectionKey:
                        String(
                            input.transportConnectionKey
                        ),
                    createdAtMs:
                        input.createdAtMs
                })
        });
    }
}

//* این تابع رجیستری، سرویس واقعی ثبت اتصال و درگاه مشترک انتقال را برای هر آزمون مستقل می‌سازد.
function createVoiceTransportTestRuntime({
    policy = {},
    userId =
        VOICE_TRANSPORT_TEST_USER_ID,
    connectionId =
        VOICE_TRANSPORT_TEST_CONNECTION_ID
} = {}) {
    const voiceConnectionRegistry =
        new VoiceConnectionRegistry();

    const connectionRegistrationService =
        new VoiceConnectionRegistrationService({
            connectionPreparationService:
                new VoiceTransportTestPreparationService({
                    userId,
                    connectionId
                }),
            voiceConnectionRegistry
        });

    const gateway =
        new VoiceTransportGateway({
            connectionRegistrationService,
            voiceConnectionRegistry,
            policy
        });

    return Object.freeze({
        gateway,
        connectionRegistrationService,
        voiceConnectionRegistry,
        userId,
        connectionId
    });
}

//* این تابع بسته باینری درخواست احراز هویت آزمون را با شماره ترتیب تعیین‌شده می‌سازد.
function createVoiceTransportAuthPacket({
    sequence = 1,
    accessToken =
        VOICE_TRANSPORT_TEST_ACCESS_TOKEN,
    roomId =
        VOICE_TRANSPORT_TEST_ROOM_ID,
    avatarId =
        VOICE_TRANSPORT_TEST_AVATAR_ID,
    platform =
        VoiceClientPlatform.WEBGL,
    clientInstanceId =
        VOICE_TRANSPORT_TEST_CLIENT_INSTANCE_ID
} = {}) {
    return encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.AUTH_REQUEST,
        flags:
            VoiceMessageFlag.ACK_REQUIRED,
        sequence,
        sessionId:
            VoiceBinaryProtocolConstants
                .emptyUuid,
        senderId:
            VoiceBinaryProtocolConstants
                .emptyUuid,
        payload:
            encodeVoiceAuthRequest({
                platform,
                accessToken,
                roomId,
                avatarId,
                clientInstanceId,
                clientBuild:
                    "voice-transport-test"
            })
    });
}

//* این تابع بسته باینری ضربان کلاینت را برای اتصال احراز‌شده می‌سازد.
function createVoiceTransportHeartbeatPacket({
    sequence,
    senderId
} = {}) {
    return encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType.HEARTBEAT,
        flags:
            VoiceMessageFlag.ACK_REQUIRED,
        sequence,
        sessionId:
            VoiceBinaryProtocolConstants
                .emptyUuid,
        senderId,
        payload: Buffer.alloc(0)
    });
}

//* این تابع بسته باینری پاسخ ضربان کلاینت را برای شماره ضربان سرور می‌سازد.
function createVoiceTransportHeartbeatAckPacket({
    sequence,
    senderId,
    acknowledgedSequence
} = {}) {
    return encodeVoiceBinaryEnvelope({
        messageType:
            VoiceMessageType
                .HEARTBEAT_ACK,
        sequence,
        sessionId:
            VoiceBinaryProtocolConstants
                .emptyUuid,
        senderId,
        payload:
            encodeVoiceHeartbeatAckPayload(
                acknowledgedSequence
            )
    });
}

//* این تابع برای مدت کوتاه تعیین‌شده اجرای آزمون را متوقف می‌کند.
function waitForVoiceTransportDelay(
    delayMs
) {
    return new Promise(
        (resolve) => {
            setTimeout(resolve, delayMs);
        }
    );
}

//* این تابع تا برقرارشدن شرط آزمون یا پایان مهلت به‌صورت دوره‌ای بررسی می‌کند.
async function waitForVoiceTransportCondition(
    predicate,
    {
        timeoutMs = 2_000,
        intervalMs = 5,
        failureMessage =
            "Voice transport test condition timed out."
    } = {}
) {
    const startedAtMs = Date.now();

    while (
        Date.now() - startedAtMs <
        timeoutMs
    ) {
        if (await predicate()) return;

        await waitForVoiceTransportDelay(
            intervalMs
        );
    }

    throw new Error(failureMessage);
}

export {
    VOICE_TRANSPORT_TEST_ACCESS_TOKEN,
    VOICE_TRANSPORT_TEST_AVATAR_ID,
    VOICE_TRANSPORT_TEST_CLIENT_INSTANCE_ID,
    VOICE_TRANSPORT_TEST_CONNECTION_ID,
    VOICE_TRANSPORT_TEST_ROOM_ID,
    VOICE_TRANSPORT_TEST_USER_ID,
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatAckPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestRuntime,
    waitForVoiceTransportCondition,
    waitForVoiceTransportDelay
};

/*
توضیح فایل:
این فایل داده‌ها و سازنده‌های مشترک آزمون پایه انتقال را نگه می‌دارد. سرویس ثبت اتصال در آزمون واقعی است و فقط مرحله آماده‌سازی بیرونی با داده قطعی آزمایشی جایگزین می‌شود.
*/
