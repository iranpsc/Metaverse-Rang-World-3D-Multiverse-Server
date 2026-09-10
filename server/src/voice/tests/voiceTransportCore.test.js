// مسیر فایل: src/voice/tests/voiceTransportCore.test.js

import assert from "node:assert/strict";

import {
    decodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    decodeVoiceBinaryEnvelope,
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
    decodeVoiceHeartbeatAckPayload
} from "../transport/voiceHeartbeatPayload.js";

import {
    VoiceTransportCloseCode,
    VoiceTransportConnectionState,
    VoiceTransportName
} from "../transport/voiceTransportConstants.js";

import {
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatAckPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestRuntime,
    waitForVoiceTransportCondition
} from "./voiceTransportTestSupport.js";

//* این تابع مسیر احراز هویت معتبر، شناسه کاربر غیر یوآی‌دی و پردازش ترتیبی دو ضربان هم‌زمان را بررسی می‌کند.
async function testValidAuthenticationAndSequentialProcessing() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 500,
                heartbeatIntervalMs: 2_000,
                heartbeatTimeoutMs: 5_000,
                sendTimeoutMs: 500
            }
        });

    const sentPackets = [];
    let transportCloseCount = 0;

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .WEBSOCKET_BINARY_TEST,
            transportConnectionKey:
                "core-valid-connection",
            sendBinary:
                (packet) => {
                    sentPackets.push(
                        Buffer.from(packet)
                    );
                },
            closeTransport:
                () => {
                    transportCloseCount += 1;
                }
        });

    await connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    assert.equal(
        sentPackets.length,
        1
    );

    const authEnvelope =
        decodeVoiceBinaryEnvelope(
            sentPackets[0]
        );

    assert.equal(
        authEnvelope.messageType,
        VoiceMessageType.AUTH_RESULT
    );

    const authResult =
        decodeVoiceAuthResult(
            authEnvelope.payload
        );

    assert.equal(authResult.success, true);
    assert.equal(
        authResult.userId,
        runtime.userId
    );
    assert.equal(
        authResult.voiceConnectionId,
        runtime.connectionId
    );
    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().active,
        1
    );

    const firstHeartbeat =
        createVoiceTransportHeartbeatPacket({
            sequence: 2,
            senderId:
                runtime.connectionId
        });

    const secondHeartbeat =
        createVoiceTransportHeartbeatPacket({
            sequence: 3,
            senderId:
                runtime.connectionId
        });

    await Promise.all([
        connection.receiveBinary(
            firstHeartbeat
        ),
        connection.receiveBinary(
            secondHeartbeat
        )
    ]);

    assert.equal(
        sentPackets.length,
        3
    );

    const firstAckEnvelope =
        decodeVoiceBinaryEnvelope(
            sentPackets[1]
        );

    const secondAckEnvelope =
        decodeVoiceBinaryEnvelope(
            sentPackets[2]
        );

    assert.equal(
        firstAckEnvelope.messageType,
        VoiceMessageType.HEARTBEAT_ACK
    );
    assert.equal(
        secondAckEnvelope.messageType,
        VoiceMessageType.HEARTBEAT_ACK
    );
    assert.equal(
        decodeVoiceHeartbeatAckPayload(
            firstAckEnvelope.payload
        ),
        2
    );
    assert.equal(
        decodeVoiceHeartbeatAckPayload(
            secondAckEnvelope.payload
        ),
        3
    );

    await connection.runHeartbeatTick();

    assert.equal(
        sentPackets.length,
        4
    );

    const serverHeartbeatEnvelope =
        decodeVoiceBinaryEnvelope(
            sentPackets[3]
        );

    assert.equal(
        serverHeartbeatEnvelope.messageType,
        VoiceMessageType.HEARTBEAT
    );
    assert.equal(
        serverHeartbeatEnvelope.flags,
        VoiceMessageFlag.ACK_REQUIRED
    );

    await connection.receiveBinary(
        createVoiceTransportHeartbeatAckPacket({
            sequence: 4,
            senderId:
                runtime.connectionId,
            acknowledgedSequence:
                serverHeartbeatEnvelope.sequence
        })
    );

    assert.equal(
        connection.getSnapshot()
            .pendingHeartbeatSequence,
        null
    );

    await connection.notifyTransportClosed();

    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
    assert.equal(
        connection.getSnapshot().state,
        VoiceTransportConnectionState.CLOSED
    );
    assert.equal(transportCloseCount, 0);
}

//* این تابع الزام قرارگرفتن درخواست احراز هویت در اولین پیام و ارسال نتیجه شکست را بررسی می‌کند.
async function testAuthenticationMustBeFirst() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 500,
                heartbeatIntervalMs: 2_000,
                heartbeatTimeoutMs: 5_000
            }
        });

    const sentPackets = [];

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .WEBSOCKET_BINARY_TEST,
            transportConnectionKey:
                "core-auth-first",
            sendBinary:
                (packet) => {
                    sentPackets.push(
                        Buffer.from(packet)
                    );
                },
            closeTransport: () => undefined
        });

    const invalidFirstPacket =
        createVoiceTransportHeartbeatPacket({
            sequence: 1,
            senderId:
                VoiceBinaryProtocolConstants
                    .emptyUuid
        });

    await assert.rejects(
        connection.receiveBinary(
            invalidFirstPacket
        ),
        /AUTH_REQUEST must be the first/
    );

    assert.equal(sentPackets.length, 1);

    const resultEnvelope =
        decodeVoiceBinaryEnvelope(
            sentPackets[0]
        );

    const authResult =
        decodeVoiceAuthResult(
            resultEnvelope.payload
        );

    assert.equal(authResult.success, false);
    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
}

//* این تابع پایان مهلت احراز هویت را بدون دریافت هیچ پیام و بدون ثبت اتصال بررسی می‌کند.
async function testAuthenticationTimeout() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 25,
                heartbeatIntervalMs: 100,
                heartbeatTimeoutMs: 200
            }
        });

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .WEBSOCKET_BINARY_TEST,
            transportConnectionKey:
                "core-auth-timeout",
            sendBinary: () => undefined,
            closeTransport: () => undefined
        });

    await waitForVoiceTransportCondition(
        () =>
            connection.getSnapshot().state ===
            VoiceTransportConnectionState.CLOSED,
        {
            timeoutMs: 500,
            failureMessage:
                "Authentication timeout did not close the Voice transport connection."
        }
    );

    assert.equal(
        connection.getSnapshot()
            .lastCloseCode,
        VoiceTransportCloseCode
            .AUTH_TIMEOUT
    );
    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
}

//* این تابع پاک‌سازی رجیستری را زمانی بررسی می‌کند که ارسال نتیجه موفق احراز هویت به علت فشار بافر شکست می‌خورد.
async function testAuthResultSendFailureCleanup() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                maxBufferedBytes: 32,
                authTimeoutMs: 500,
                heartbeatIntervalMs: 2_000,
                heartbeatTimeoutMs: 5_000
            }
        });

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .WEBSOCKET_BINARY_TEST,
            transportConnectionKey:
                "core-auth-send-failure",
            sendBinary: () => undefined,
            closeTransport: () => undefined,
            getBufferedAmount: () => 33
        });

    await assert.rejects(
        connection.receiveBinary(
            createVoiceTransportAuthPacket()
        ),
        /backpressure limit/
    );

    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
    assert.equal(
        connection.getSnapshot()
            .lastCloseCode,
        VoiceTransportCloseCode
            .BACKPRESSURE
    );
}

//* این تابع ردشدن بسته بزرگ‌تر از سقف تعیین‌شده و بسته‌شدن اتصال را بررسی می‌کند.
async function testMaximumPacketLimit() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                maxPacketBytes: 128,
                authTimeoutMs: 500,
                heartbeatIntervalMs: 2_000,
                heartbeatTimeoutMs: 5_000
            }
        });

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .WEBSOCKET_BINARY_TEST,
            transportConnectionKey:
                "core-packet-limit",
            sendBinary: () => undefined,
            closeTransport: () => undefined
        });

    await assert.rejects(
        connection.receiveBinary(
            Buffer.alloc(129)
        ),
        /size limit/
    );

    assert.equal(
        connection.getSnapshot()
            .lastCloseCode,
        VoiceTransportCloseCode
            .PACKET_TOO_LARGE
    );
}

//* این تابع ردشدن شماره ترتیب پرش‌دار و پاک‌سازی اتصال ثبت‌شده را بررسی می‌کند.
async function testInvalidSequenceCleanup() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 500,
                heartbeatIntervalMs: 2_000,
                heartbeatTimeoutMs: 5_000
            }
        });

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .WEBSOCKET_BINARY_TEST,
            transportConnectionKey:
                "core-invalid-sequence",
            sendBinary: () => undefined,
            closeTransport: () => undefined
        });

    await connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await assert.rejects(
        connection.receiveBinary(
            createVoiceTransportHeartbeatPacket({
                sequence: 3,
                senderId:
                    runtime.connectionId
            })
        ),
        /Expected 2, received 3/
    );

    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
}

//* این تابع غیرفعال‌بودن فریم صوتی در پایه انتقال و پاک‌سازی اتصال پس از تلاش نامعتبر را بررسی می‌کند.
async function testVoiceFrameRemainsDisabled() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 500,
                heartbeatIntervalMs: 2_000,
                heartbeatTimeoutMs: 5_000
            }
        });

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .GRPC_BIDIRECTIONAL_TEST,
            transportConnectionKey:
                "core-voice-frame-disabled",
            sendBinary: () => undefined,
            closeTransport: () => undefined
        });

    await connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    const voiceFramePacket =
        encodeVoiceBinaryEnvelope({
            messageType:
                VoiceMessageType.VOICE_FRAME,
            sequence: 2,
            senderId:
                runtime.connectionId,
            payload:
                Buffer.from([0x01])
        });

    await assert.rejects(
        connection.receiveBinary(
            voiceFramePacket
        ),
        /VOICE_FRAME is not enabled/
    );

    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
}

//* این تابع ارسال ضربان سرور و پاک‌سازی اتصال پس از نرسیدن پاسخ آن در مهلت مجاز را بررسی می‌کند.
async function testHeartbeatTimeoutCleanup() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 500,
                heartbeatIntervalMs: 20,
                heartbeatTimeoutMs: 60,
                sendTimeoutMs: 100
            }
        });

    const sentPackets = [];

    const connection =
        runtime.gateway.acceptConnection({
            transportName:
                VoiceTransportName
                    .GRPC_BIDIRECTIONAL_TEST,
            transportConnectionKey:
                "core-heartbeat-timeout",
            sendBinary:
                (packet) => {
                    sentPackets.push(
                        Buffer.from(packet)
                    );
                },
            closeTransport: () => undefined
        });

    await connection.receiveBinary(
        createVoiceTransportAuthPacket()
    );

    await waitForVoiceTransportCondition(
        () =>
            sentPackets.some(
                (packet) =>
                    decodeVoiceBinaryEnvelope(
                        packet
                    ).messageType ===
                    VoiceMessageType.HEARTBEAT
            ),
        {
            timeoutMs: 500,
            failureMessage:
                "Server heartbeat was not emitted."
        }
    );

    await waitForVoiceTransportCondition(
        () =>
            connection.getSnapshot().state ===
            VoiceTransportConnectionState.CLOSED,
        {
            timeoutMs: 700,
            failureMessage:
                "Heartbeat timeout did not close the connection."
        }
    );

    assert.equal(
        connection.getSnapshot()
            .lastCloseCode,
        VoiceTransportCloseCode
            .HEARTBEAT_TIMEOUT
    );
    assert.equal(
        runtime.voiceConnectionRegistry
            .getStats().total,
        0
    );
}

await testValidAuthenticationAndSequentialProcessing();
await testAuthenticationMustBeFirst();
await testAuthenticationTimeout();
await testAuthResultSendFailureCleanup();
await testMaximumPacketLimit();
await testInvalidSequenceCleanup();
await testVoiceFrameRemainsDisabled();
await testHeartbeatTimeoutCleanup();

console.log(
    "VOICE_TRANSPORT_CORE_TEST=OK"
);

/*
توضیح فایل:
این فایل الزام پیام نخست، شناسه کاربر رشته‌ای، صف ترتیبی، شماره ترتیب، پاسخ ضربان، مهلت احراز هویت، مهلت ضربان، سقف بسته، فشار بافر و پاک‌سازی رجیستری را در هسته مشترک انتقال بررسی می‌کند.
*/
