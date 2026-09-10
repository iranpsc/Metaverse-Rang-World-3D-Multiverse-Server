// مسیر فایل: src/voice/tests/voiceGrpcTestAdapter.test.js

import assert from "node:assert/strict";

import {
    once
} from "node:events";

import {
    decodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceGrpcTestListener,
    createVoiceGrpcTestClient
} from "../transport/grpc/voiceGrpcTestAdapter.js";

import {
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestFixture,
    decodeVoiceBinaryEnvelope,
    waitForVoiceTransportCondition
} from "./voiceTransportTestFixture.js";

const fixture = createVoiceTransportTestFixture({
    authenticationTimeoutMs: 1000,
    heartbeatTimeoutMs: 1000
});

const listener = new VoiceGrpcTestListener({
    gateway: fixture.gateway
});

let client = null;
let stream = null;

try {
    const address = await listener.start();

    assert.equal(address.host, "127.0.0.1");
    assert.equal(address.port > 0, true);

    client = createVoiceGrpcTestClient(
        address.target
    );

    stream = client.connect();

    //* این تابع خطای مورد انتظار هنگام پایان جریان آزمایشی را از تبدیل‌شدن به خطای بدون شنونده جلوگیری می‌کند.
    const handleStreamError = () => undefined;

    stream.on("error", handleStreamError);

    const authMessageTask = once(
        stream,
        "data"
    );

    stream.write({
        packet: createVoiceTransportAuthPacket()
    });

    const [authMessage] = await authMessageTask;

    const authEnvelope = decodeVoiceBinaryEnvelope(
        authMessage.packet
    );

    assert.equal(
        authEnvelope.messageType,
        VoiceMessageType.AUTH_RESULT
    );

    const authResult = decodeVoiceAuthResult(
        authEnvelope.payload
    );

    assert.equal(authResult.success, true);
    assert.equal(authResult.userId, fixture.identity.userId);

    const heartbeatMessageTask = once(
        stream,
        "data"
    );

    stream.write({
        packet:
            createVoiceTransportHeartbeatPacket(1)
    });

    const [heartbeatMessage] =
        await heartbeatMessageTask;

    const heartbeatEnvelope =
        decodeVoiceBinaryEnvelope(
            heartbeatMessage.packet
        );

    assert.equal(
        heartbeatEnvelope.messageType,
        VoiceMessageType.HEARTBEAT_ACK
    );

    const endTask = once(stream, "end");

    stream.end();
    await endTask;

    await waitForVoiceTransportCondition(
        () =>
            fixture.voiceConnectionRegistry
                .getStats()
                .total === 0
    );
} finally {
    if (stream && !stream.destroyed) {
        stream.cancel();
    }

    if (client) {
        client.close();
    }

    await listener.close();
}

console.log(
    "VOICE_V2_7_GRPC_TEST_ADAPTER=OK"
);

/*
توضیح فایل:
این فایل شنونده جریان دوطرفه جی‌آرپی‌سی را فقط روی پورت موقت محلی اجرا می‌کند و مسیر کامل احراز هویت با شناسه کاربر رشته‌ای، پیام سلامت و پاک‌سازی پس از پایان جریان را بررسی می‌کند.
*/
