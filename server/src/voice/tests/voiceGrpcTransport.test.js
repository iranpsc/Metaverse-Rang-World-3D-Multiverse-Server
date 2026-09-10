// مسیر فایل: src/voice/tests/voiceGrpcTransport.test.js

import assert from "node:assert/strict";

import grpc from "@grpc/grpc-js";

import {
    decodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    decodeVoiceBinaryEnvelope
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    decodeVoiceHeartbeatAckPayload
} from "../transport/voiceHeartbeatPayload.js";

import {
    VoiceGrpcTestAdapter,
    loadVoiceGrpcTransportDefinition
} from "../transport/grpc/voiceGrpcTestAdapter.js";

import {
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestRuntime,
    waitForVoiceTransportCondition
} from "./voiceTransportTestSupport.js";

//* این تابع یک پیام باینری را از جریان جی‌آرپی دریافت و در پایان مهلت یا خطا آزمون را متوقف می‌کند.
function waitForVoiceGrpcPacket(
    call,
    timeoutMs = 2_000
) {
    return new Promise(
        (resolve, reject) => {
            let timeoutHandle = null;

            const cleanup = () => {
                call.off("data", handleData);
                call.off("error", handleError);
                call.off("end", handleEnd);

                if (timeoutHandle) {
                    clearTimeout(
                        timeoutHandle
                    );
                }
            };

            const handleData = (message) => {
                cleanup();

                if (
                    !message?.packet ||
                    !Buffer.isBuffer(
                        message.packet
                    )
                ) {
                    reject(
                        new Error(
                            "Voice gRPC test received an invalid packet."
                        )
                    );
                    return;
                }

                resolve(message.packet);
            };

            const handleError = (error) => {
                cleanup();
                reject(error);
            };

            const handleEnd = () => {
                cleanup();
                reject(
                    new Error(
                        "Voice gRPC stream ended before the expected packet arrived."
                    )
                );
            };

            call.once("data", handleData);
            call.once("error", handleError);
            call.once("end", handleEnd);

            timeoutHandle = setTimeout(
                () => {
                    cleanup();
                    reject(
                        new Error(
                            "Voice gRPC packet timeout."
                        )
                    );
                },
                timeoutMs
            );
        }
    );
}

//* این تابع ارسال یک پیام در جریان جی‌آرپی را تا دریافت نتیجه نوشتن یا خطا انتظار می‌کشد.
function writeVoiceGrpcPacket(
    call,
    packet
) {
    return new Promise(
        (resolve, reject) => {
            call.write(
                { packet },
                (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve();
                }
            );
        }
    );
}

//* این تابع مسیر کامل احراز هویت، ضربان و پاک‌سازی را روی شنونده موقت جی‌آرپی دوطرفه بررسی می‌کند.
async function testVoiceGrpcTemporaryListener() {
    const runtime =
        createVoiceTransportTestRuntime({
            policy: {
                authTimeoutMs: 1_000,
                heartbeatIntervalMs: 5_000,
                heartbeatTimeoutMs: 10_000,
                sendTimeoutMs: 1_000
            }
        });

    const adapter =
        new VoiceGrpcTestAdapter({
            gateway: runtime.gateway
        });

    let client = null;
    let call = null;

    try {
        const address =
            await adapter.start({
                host: "127.0.0.1",
                port: 0
            });

        assert.equal(
            address.host,
            "127.0.0.1"
        );
        assert.equal(
            address.port > 0,
            true
        );

        const servicePackage =
            loadVoiceGrpcTransportDefinition();

        client =
            new servicePackage
                .VoiceTransport(
                    address.address,
                    grpc.credentials
                        .createInsecure(),
                    {
                        "grpc.max_receive_message_length":
                            runtime.gateway
                                .policy
                                .maxPacketBytes,
                        "grpc.max_send_message_length":
                            runtime.gateway
                                .policy
                                .maxPacketBytes
                    }
                );

        const connectMethod =
            typeof client.Connect ===
                "function"
                ? "Connect"
                : "connect";

        assert.equal(
            typeof client[connectMethod],
            "function"
        );

        call = client[connectMethod]();

        call.on(
            "error",
            () => undefined
        );

        const authResponsePromise =
            waitForVoiceGrpcPacket(call);

        await writeVoiceGrpcPacket(
            call,
            createVoiceTransportAuthPacket()
        );

        const authEnvelope =
            decodeVoiceBinaryEnvelope(
                await authResponsePromise
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

        const heartbeatResponsePromise =
            waitForVoiceGrpcPacket(call);

        await writeVoiceGrpcPacket(
            call,
            createVoiceTransportHeartbeatPacket({
                sequence: 2,
                senderId:
                    runtime.connectionId
            })
        );

        const heartbeatAckEnvelope =
            decodeVoiceBinaryEnvelope(
                await heartbeatResponsePromise
            );

        assert.equal(
            heartbeatAckEnvelope.messageType,
            VoiceMessageType.HEARTBEAT_ACK
        );
        assert.equal(
            decodeVoiceHeartbeatAckPayload(
                heartbeatAckEnvelope.payload
            ),
            2
        );

        call.end();

        await waitForVoiceTransportCondition(
            () =>
                runtime.voiceConnectionRegistry
                    .getStats().total === 0 &&
                runtime.gateway
                    .getStats()
                    .transportConnections === 0,
            {
                timeoutMs: 2_000,
                failureMessage:
                    "Voice gRPC end did not clean the registries."
            }
        );
    } finally {
        if (call) {
            call.cancel();
        }

        if (client) {
            client.close();
        }

        await adapter.stop();
    }
}

await testVoiceGrpcTemporaryListener();

console.log(
    "VOICE_GRPC_TEMPORARY_LISTENER_TEST=OK"
);

/*
توضیح فایل:
این فایل آداپتور آزمایشی جی‌آرپی دوطرفه را فقط روی نشانی محلی و پورت خودکار اجرا می‌کند و احراز هویت باینری، شناسه کاربر رشته‌ای، پاسخ ضربان و پاک‌سازی پس از پایان جریان را بررسی می‌کند.
*/
