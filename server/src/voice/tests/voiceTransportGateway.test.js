// مسیر فایل: src/voice/tests/voiceTransportGateway.test.js

import assert from "node:assert/strict";

import {
    decodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    VoiceConnectionCloseReason
} from "../core/voiceConnectionConstants.js";

import {
    encodeVoiceBinaryEnvelope
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceTransportCloseReason,
    VoiceTransportConnectionState,
    VoiceTransportName
} from "../transport/voiceTransportConstants.js";

import {
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestFixture,
    decodeVoiceBinaryEnvelope,
    waitForVoiceTransportCondition
} from "./voiceTransportTestFixture.js";

//* این تابع یک راه انتقال حافظه‌ای قابل کنترل برای آزمون هسته مشترک می‌سازد.
function openMemoryTransport(
    fixture,
    {
        transportConnectionKey,
        sendFailure = null,
        bufferedBytes = 0
    }
) {
    const sentPackets = [];
    const closeReasons = [];

    const connection = fixture.gateway.openConnection({
        transportName: VoiceTransportName.WEBSOCKET,
        transportConnectionKey,

        //* این تابع بسته خروجی را نگه می‌دارد یا خطای تزریق‌شده را برمی‌گرداند.
        sendBinary: async (packet) => {
            if (sendFailure) throw sendFailure;
            sentPackets.push(Buffer.from(packet));
        },

        //* این تابع علت توقف درخواستی هسته را برای بررسی آزمون ثبت می‌کند.
        closeTransport: async (transportReason) => {
            closeReasons.push(transportReason);
        },

        //* این تابع مقدار فشار خروجی تزریق‌شده آزمون را برمی‌گرداند.
        getBufferedBytes: () => bufferedBytes
    });

    return {
        connection,
        sentPackets,
        closeReasons
    };
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-ordering-test"
        }
    );

    const authenticationTask =
        memory.connection.receiveBinary(
            createVoiceTransportAuthPacket({
                sequence: 0
            })
        );

    const heartbeatTask =
        memory.connection.receiveBinary(
            createVoiceTransportHeartbeatPacket(1)
        );

    await Promise.all([
        authenticationTask,
        heartbeatTask
    ]);

    assert.equal(memory.sentPackets.length, 2);

    const authEnvelope = decodeVoiceBinaryEnvelope(
        memory.sentPackets[0]
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

    assert.equal(
        authResult.voiceConnectionId,
        fixture.identity.voiceConnectionId
    );

    const heartbeatAckEnvelope =
        decodeVoiceBinaryEnvelope(
            memory.sentPackets[1]
        );

    assert.equal(
        heartbeatAckEnvelope.messageType,
        VoiceMessageType.HEARTBEAT_ACK
    );

    assert.equal(
        heartbeatAckEnvelope.payloadLength,
        0
    );

    assert.equal(
        fixture.voiceConnectionRegistry
            .getByConnectionId(
                fixture.identity.voiceConnectionId
            )
            ?.lastReceivedSequence,
        1
    );

    assert.equal(
        memory.connection.snapshot().state,
        VoiceTransportConnectionState.ACTIVE
    );

    await memory.connection.notifyTransportClosed();

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-heartbeat-ack-test"
        }
    );

    await memory.connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await memory.connection.receiveBinary(
        encodeVoiceBinaryEnvelope({
            messageType:
                VoiceMessageType.HEARTBEAT_ACK,
            sequence: 1,
            payload: Buffer.alloc(0)
        })
    );

    assert.equal(memory.sentPackets.length, 1);

    assert.equal(
        memory.connection.snapshot().state,
        VoiceTransportConnectionState.ACTIVE
    );

    await memory.connection.notifyTransportClosed();
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-voice-frame-disabled-test"
        }
    );

    await memory.connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await assert.rejects(
        memory.connection.receiveBinary(
            encodeVoiceBinaryEnvelope({
                messageType:
                    VoiceMessageType.VOICE_FRAME,
                sequence: 1,
                payload: Buffer.from([0x01])
            })
        ),
        /not enabled in the transport foundation/
    );

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-first-message-test"
        }
    );

    await assert.rejects(
        memory.connection.receiveBinary(
            createVoiceTransportHeartbeatPacket(0)
        ),
        /AUTH_REQUEST must be the first/
    );

    assert.deepEqual(
        memory.closeReasons,
        [
            VoiceTransportCloseReason.PROTOCOL_ERROR
        ]
    );
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-sequence-test"
        }
    );

    await memory.connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await memory.connection.receiveBinary(
        createVoiceTransportHeartbeatPacket(1)
    );

    await assert.rejects(
        memory.connection.receiveBinary(
            createVoiceTransportHeartbeatPacket(1)
        ),
        /sequence must increase strictly/
    );

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );
}

{
    const fixture = createVoiceTransportTestFixture({
        authenticationTimeoutMs: 25
    });

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-auth-timeout-test"
        }
    );

    await waitForVoiceTransportCondition(
        () =>
            memory.connection.snapshot().state ===
            VoiceTransportConnectionState.CLOSED
    );

    assert.deepEqual(
        memory.closeReasons,
        [
            VoiceTransportCloseReason.AUTHENTICATION_TIMEOUT
        ]
    );
}

{
    const fixture = createVoiceTransportTestFixture({
        heartbeatTimeoutMs: 25
    });

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-heartbeat-timeout-test"
        }
    );

    await memory.connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await waitForVoiceTransportCondition(
        () =>
            memory.connection.snapshot().state ===
            VoiceTransportConnectionState.CLOSED
    );

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );

    assert.deepEqual(
        memory.closeReasons,
        [
            VoiceTransportCloseReason.HEARTBEAT_TIMEOUT
        ]
    );
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-auth-send-failure-test",
            sendFailure:
                new Error("injected send failure")
        }
    );

    await assert.rejects(
        memory.connection.receiveBinary(
            createVoiceTransportAuthPacket()
        ),
        /injected send failure/
    );

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );
}

{
    const fixture = createVoiceTransportTestFixture({
        maxPacketBytes: 256,
        maxBufferedBytes: 512
    });

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-packet-limit-test"
        }
    );

    await assert.rejects(
        memory.connection.receiveBinary(
            Buffer.alloc(257)
        ),
        /packet exceeds the configured limit/
    );
}

{
    const fixture = createVoiceTransportTestFixture({
        maxBufferedBytes: 65536
    });

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-backpressure-test",
            bufferedBytes: 65536
        }
    );

    await assert.rejects(
        memory.connection.receiveBinary(
            createVoiceTransportAuthPacket()
        ),
        /buffered byte limit exceeded/
    );

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );

    assert.deepEqual(
        memory.closeReasons,
        [
            VoiceTransportCloseReason.BACKPRESSURE_LIMIT
        ]
    );
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-auth-failure-test"
        }
    );

    await memory.connection.receiveBinary(
        createVoiceTransportAuthPacket({
            accessToken: "invalid-token"
        })
    );

    const resultEnvelope = decodeVoiceBinaryEnvelope(
        memory.sentPackets[0]
    );

    const result = decodeVoiceAuthResult(
        resultEnvelope.payload
    );

    assert.equal(result.success, false);
    assert.equal(result.userId, "");

    assert.deepEqual(
        memory.closeReasons,
        [
            VoiceTransportCloseReason.AUTHENTICATION_FAILED
        ]
    );
}

{
    const fixture = createVoiceTransportTestFixture();

    const memory = openMemoryTransport(
        fixture,
        {
            transportConnectionKey:
                "gateway-explicit-close-test"
        }
    );

    await memory.connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await memory.connection.close({
        registryReason:
            VoiceConnectionCloseReason.CLIENT_DISCONNECTED,
        transportReason:
            VoiceTransportCloseReason.CLIENT_DISCONNECTED
    });

    assert.equal(
        fixture.voiceConnectionRegistry.getStats().total,
        0
    );
}

console.log(
    "VOICE_V2_7_TRANSPORT_GATEWAY_TEST=OK"
);

/*
توضیح فایل:
این فایل الزام نخستین پیام احراز هویت، شناسه کاربر رشته‌ای، پردازش ترتیبی، شماره ترتیب، پیام سلامت، هر دو مهلت، محدودیت بسته، فشار خروجی و پاک‌سازی همه مسیرهای قطع و شکست ارسال نتیجه احراز هویت را بررسی می‌کند.
*/
