// مسیر فایل: src/voice/tests/voiceConnectionExternalUserId.test.js

import assert from "node:assert/strict";

import {
    VoiceClientPlatform
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionRecord
} from "../core/voiceConnectionRecord.js";

const mongoUserId =
    "66a123456789abcdef123456";

const emailUserId =
    "voice-user@example.test";

const mongoRecord =
    new VoiceConnectionRecord({
        userId:
            mongoUserId,
        avatarId:
            mongoUserId,
        roomId:
            "room_voice_external_user",
        platform:
            VoiceClientPlatform.WEBGL,
        clientInstanceId:
            "123e4567-e89b-12d3-a456-426614174000",
        transportName:
            "websocket",
        transportConnectionKey:
            "voice_external_mongo_connection"
    });

assert.equal(
    mongoRecord.userId,
    mongoUserId
);

assert.match(
    mongoRecord.connectionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
);

const emailRecord =
    new VoiceConnectionRecord({
        userId:
            emailUserId,
        avatarId:
            emailUserId,
        roomId:
            "room_voice_external_user",
        platform:
            VoiceClientPlatform.WINDOWS,
        clientInstanceId:
            "223e4567-e89b-12d3-a456-426614174000",
        transportName:
            "grpc",
        transportConnectionKey:
            "voice_external_email_connection"
    });

assert.equal(
    emailRecord.userId,
    emailUserId
);

assert.notEqual(
    emailRecord.connectionId,
    emailRecord.userId
);

assert.throws(
    () =>
        new VoiceConnectionRecord({
            userId: "",
            avatarId:
                "avatar_voice_empty_user",
            roomId:
                "room_voice_external_user",
            platform:
                VoiceClientPlatform.WEBGL,
            clientInstanceId:
                "323e4567-e89b-12d3-a456-426614174000",
            transportName:
                "websocket",
            transportConnectionKey:
                "voice_empty_user_connection"
        }),
    /userId must be a non-empty string/
);

assert.throws(
    () =>
        new VoiceConnectionRecord({
            userId:
                "a".repeat(513),
            avatarId:
                "avatar_voice_long_user",
            roomId:
                "room_voice_external_user",
            platform:
                VoiceClientPlatform.WEBGL,
            clientInstanceId:
                "423e4567-e89b-12d3-a456-426614174000",
            transportName:
                "websocket",
            transportConnectionKey:
                "voice_long_user_connection"
        }),
    /userId exceeds 512 UTF-8 bytes/
);

assert.throws(
    () =>
        new VoiceConnectionRecord({
            userId:
                mongoUserId,
            avatarId:
                mongoUserId,
            roomId:
                "room_voice_external_user",
            platform:
                VoiceClientPlatform.WEBGL,
            clientInstanceId:
                "invalid-client-instance",
            transportName:
                "websocket",
            transportConnectionKey:
                "voice_invalid_client_connection"
        }),
    /clientInstanceId must be a valid UUID/
);

console.log(
    "VOICE_V2_4_4_EXTERNAL_USER_ID_TEST=OK"
);

/*
توضیح فایل:
این فایل بررسی می‌کند که شناسه واقعی کاربر به‌صورت متن پذیرفته شود و شناسه داخلی اتصال صوتی همچنان توسط سرور و به‌صورت یکتا ساخته شود.
*/
