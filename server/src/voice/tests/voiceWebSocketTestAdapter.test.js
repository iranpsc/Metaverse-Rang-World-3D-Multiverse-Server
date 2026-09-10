// مسیر فایل: src/voice/tests/voiceWebSocketTestAdapter.test.js

import assert from "node:assert/strict";

import {
    once
} from "node:events";

import WebSocket from "ws";

import {
    decodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceWebSocketTestListener
} from "../transport/websocket/voiceWebSocketTestAdapter.js";

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

const listener = new VoiceWebSocketTestListener({
    gateway: fixture.gateway
});

let client = null;

try {
    const address = await listener.start();

    assert.equal(address.host, "127.0.0.1");
    assert.equal(address.port > 0, true);

    client = new WebSocket(
        address.url,
        {
            perMessageDeflate: false
        }
    );

    await once(client, "open");

    const authMessageTask = once(
        client,
        "message"
    );

    client.send(
        createVoiceTransportAuthPacket()
    );

    const [
        authPacket,
        authIsBinary
    ] = await authMessageTask;

    assert.equal(authIsBinary, true);

    const authEnvelope = decodeVoiceBinaryEnvelope(
        authPacket
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
        client,
        "message"
    );

    client.send(
        createVoiceTransportHeartbeatPacket(1)
    );

    const [
        heartbeatPacket,
        heartbeatIsBinary
    ] = await heartbeatMessageTask;

    assert.equal(heartbeatIsBinary, true);

    const heartbeatEnvelope =
        decodeVoiceBinaryEnvelope(
            heartbeatPacket
        );

    assert.equal(
        heartbeatEnvelope.messageType,
        VoiceMessageType.HEARTBEAT_ACK
    );

    const closeTask = once(
        client,
        "close"
    );

    client.close(1000, "test_complete");
    await closeTask;

    await waitForVoiceTransportCondition(
        () =>
            fixture.voiceConnectionRegistry
                .getStats()
                .total === 0
    );
} finally {
    if (
        client &&
        client.readyState !== WebSocket.CLOSED
    ) {
        client.terminate();
    }

    await listener.close();
}

console.log(
    "VOICE_V2_7_WEBSOCKET_TEST_ADAPTER=OK"
);

/*
توضیح فایل:
این فایل شنونده وب‌سوکت باینری را فقط روی پورت موقت محلی اجرا می‌کند و مسیر کامل احراز هویت با شناسه کاربر رشته‌ای، پیام سلامت و پاک‌سازی پس از قطع را بررسی می‌کند.
*/
