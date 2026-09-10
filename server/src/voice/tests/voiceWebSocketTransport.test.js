// مسیر فایل: src/voice/tests/voiceWebSocketTransport.test.js

import assert from "node:assert/strict";

import WebSocket from "ws";

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
    VoiceWebSocketTestAdapter
} from "../transport/websocket/voiceWebSocketTestAdapter.js";

import {
    createVoiceTransportAuthPacket,
    createVoiceTransportHeartbeatPacket,
    createVoiceTransportTestRuntime,
    waitForVoiceTransportCondition
} from "./voiceTransportTestSupport.js";

//* این تابع تا بازشدن وب‌سوکت آزمایشی یا وقوع خطا و پایان مهلت انتظار می‌کند.
function waitForVoiceWebSocketOpen(
    socket,
    timeoutMs = 2_000
) {
    return new Promise(
        (resolve, reject) => {
            let timeoutHandle = null;

            const cleanup = () => {
                socket.off("open", handleOpen);
                socket.off("error", handleError);

                if (timeoutHandle) {
                    clearTimeout(
                        timeoutHandle
                    );
                }
            };

            const handleOpen = () => {
                cleanup();
                resolve();
            };

            const handleError = (error) => {
                cleanup();
                reject(error);
            };

            socket.once("open", handleOpen);
            socket.once("error", handleError);

            timeoutHandle = setTimeout(
                () => {
                    cleanup();
                    reject(
                        new Error(
                            "Voice WebSocket open timeout."
                        )
                    );
                },
                timeoutMs
            );
        }
    );
}

//* این تابع یک پیام باینری وب‌سوکت را دریافت و در صورت متن، خطا یا پایان مهلت آزمون را متوقف می‌کند.
function waitForVoiceWebSocketPacket(
    socket,
    timeoutMs = 2_000
) {
    return new Promise(
        (resolve, reject) => {
            let timeoutHandle = null;

            const cleanup = () => {
                socket.off(
                    "message",
                    handleMessage
                );
                socket.off("error", handleError);
                socket.off("close", handleClose);

                if (timeoutHandle) {
                    clearTimeout(
                        timeoutHandle
                    );
                }
            };

            const handleMessage =
                (data, isBinary) => {
                    cleanup();

                    if (!isBinary) {
                        reject(
                            new Error(
                                "Voice WebSocket test received a text message."
                            )
                        );
                        return;
                    }

                    resolve(
                        Buffer.isBuffer(data)
                            ? data
                            : Buffer.from(data)
                    );
                };

            const handleError = (error) => {
                cleanup();
                reject(error);
            };

            const handleClose = () => {
                cleanup();
                reject(
                    new Error(
                        "Voice WebSocket closed before the expected packet arrived."
                    )
                );
            };

            socket.once(
                "message",
                handleMessage
            );
            socket.once("error", handleError);
            socket.once("close", handleClose);

            timeoutHandle = setTimeout(
                () => {
                    cleanup();
                    reject(
                        new Error(
                            "Voice WebSocket packet timeout."
                        )
                    );
                },
                timeoutMs
            );
        }
    );
}

//* این تابع ارسال یک بسته باینری وب‌سوکت را تا دریافت نتیجه ارسال یا خطا انتظار می‌کشد.
function sendVoiceWebSocketPacket(
    socket,
    packet
) {
    return new Promise(
        (resolve, reject) => {
            socket.send(
                packet,
                {
                    binary: true,
                    compress: false
                },
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

//* این تابع مسیر کامل احراز هویت، ضربان و پاک‌سازی را روی شنونده موقت وب‌سوکت باینری بررسی می‌کند.
async function testVoiceWebSocketTemporaryListener() {
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
        new VoiceWebSocketTestAdapter({
            gateway: runtime.gateway
        });

    let socket = null;

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
            Number.isInteger(
                address.port
            ),
            true
        );
        assert.equal(
            address.port > 0,
            true
        );

        socket = new WebSocket(
            address.url,
            {
                perMessageDeflate: false,
                maxPayload:
                    runtime.gateway.policy
                        .maxPacketBytes
            }
        );

        await waitForVoiceWebSocketOpen(
            socket
        );

        const authResponsePromise =
            waitForVoiceWebSocketPacket(
                socket
            );

        await sendVoiceWebSocketPacket(
            socket,
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
            waitForVoiceWebSocketPacket(
                socket
            );

        await sendVoiceWebSocketPacket(
            socket,
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

        socket.close();

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
                    "Voice WebSocket close did not clean the registries."
            }
        );
    } finally {
        if (
            socket &&
            socket.readyState !==
                WebSocket.CLOSED
        ) {
            socket.terminate();
        }

        await adapter.stop();
    }
}

await testVoiceWebSocketTemporaryListener();

console.log(
    "VOICE_WEBSOCKET_TEMPORARY_LISTENER_TEST=OK"
);

/*
توضیح فایل:
این فایل آداپتور آزمایشی وب‌سوکت را فقط روی نشانی محلی و پورت خودکار اجرا می‌کند و احراز هویت باینری، شناسه کاربر رشته‌ای، پاسخ ضربان و پاک‌سازی پس از قطع را بررسی می‌کند.
*/
