// مسیر فایل: src/voice/transport/websocket/voiceWebSocketTestAdapter.js

import {
    randomUUID
} from "node:crypto";

import WebSocket, {
    WebSocketServer
} from "ws";

import {
    VoiceTransportCloseCode,
    VoiceTransportName
} from "../voiceTransportConstants.js";

//* این تابع علت بستن وب‌سوکت را به اندازه مجاز داده پایانی محدود می‌کند.
function normalizeWebSocketCloseReason(
    value
) {
    const source =
        Buffer.from(
            String(value ?? ""),
            "utf8"
        );

    if (source.length <= 123) {
        return source.toString(
            "utf8"
        );
    }

    let endOffset = 123;

    while (
        endOffset > 0 &&
        (
            source[endOffset] &
            0xc0
        ) === 0x80
    ) {
        endOffset -= 1;
    }

    return source
        .subarray(
            0,
            endOffset
        )
        .toString(
            "utf8"
        );
}

class VoiceWebSocketTestAdapter {
    //* این سازنده درگاه مشترک انتقال را برای شنونده موقت وب‌سوکت دریافت می‌کند.
    constructor({ gateway } = {}) {
        if (
            !gateway ||
            typeof gateway
                .acceptConnection !==
                "function" ||
            typeof gateway.closeAll !==
                "function" ||
            !gateway.policy
        ) {
            throw new TypeError(
                "gateway does not provide the required Voice transport interface."
            );
        }

        this.gateway = gateway;
        this.server = null;
        this.host = "";
        this.port = 0;
    }

    //* این تابع شنونده وب‌سوکت را فقط روی نشانی محلی و پورت موقت یا تعیین‌شده آزمون باز می‌کند.
    async start({
        host = "127.0.0.1",
        port = 0
    } = {}) {
        if (this.server) {
            throw new Error(
                "Voice WebSocket test adapter is already started."
            );
        }

        if (
            typeof host !== "string" ||
            !host.trim()
        ) {
            throw new TypeError(
                "host must be a non-empty string."
            );
        }

        if (
            !Number.isInteger(port) ||
            port < 0 ||
            port > 65535
        ) {
            throw new RangeError(
                "port must be an integer between zero and 65535."
            );
        }

        const normalizedHost =
            host.trim();

        const server =
            new WebSocketServer({
                host: normalizedHost,
                port,

                maxPayload:
                    this.gateway
                        .policy
                        .maxPacketBytes,

                perMessageDeflate:
                    false,

                clientTracking:
                    true
            });

        this.server = server;

        server.on(
            "connection",
            (socket) => {
                this.attachSocket(
                    socket
                );
            }
        );

        try {
            await new Promise(
                (
                    resolve,
                    reject
                ) => {
                    const handleListening =
                        () => {
                            server.off(
                                "error",
                                handleError
                            );

                            resolve();
                        };

                    const handleError =
                        (error) => {
                            server.off(
                                "listening",
                                handleListening
                            );

                            reject(error);
                        };

                    server.once(
                        "listening",
                        handleListening
                    );

                    server.once(
                        "error",
                        handleError
                    );
                }
            );
        } catch (error) {
            this.server = null;
            throw error;
        }

        const address =
            server.address();

        if (
            !address ||
            typeof address ===
                "string"
        ) {
            await this.stop();

            throw new Error(
                "Voice WebSocket test adapter did not receive a TCP address."
            );
        }

        this.host =
            normalizedHost;

        this.port =
            address.port;

        return Object.freeze({
            host: this.host,
            port: this.port,

            url:
                `ws://${this.host}:${this.port}`
        });
    }

    //* این تابع یک اتصال وب‌سوکت را به هسته مشترک باینری متصل و رویدادهای آن را پاک‌سازی می‌کند.
    attachSocket(socket) {
        const transportConnectionKey =
            `voice-ws-test-${randomUUID()}`;

        const connection =
            this.gateway
                .acceptConnection({
                    transportName:
                        VoiceTransportName
                            .WEBSOCKET_BINARY_TEST,

                    transportConnectionKey,

                    getBufferedAmount:
                        () =>
                            socket.bufferedAmount,

                    sendBinary:
                        (packet) =>
                            new Promise(
                                (
                                    resolve,
                                    reject
                                ) => {
                                    if (
                                        socket.readyState !==
                                        WebSocket.OPEN
                                    ) {
                                        reject(
                                            new Error(
                                                "Voice WebSocket is not open."
                                            )
                                        );

                                        return;
                                    }

                                    socket.send(
                                        packet,
                                        {
                                            binary:
                                                true,

                                            compress:
                                                false
                                        },
                                        (error) => {
                                            if (
                                                error
                                            ) {
                                                reject(
                                                    error
                                                );

                                                return;
                                            }

                                            resolve();
                                        }
                                    );
                                }
                            ),

                    closeTransport:
                        (
                            code,
                            reason
                        ) => {
                            if (
                                socket.readyState ===
                                    WebSocket.OPEN ||
                                socket.readyState ===
                                    WebSocket.CONNECTING
                            ) {
                                socket.close(
                                    code,
                                    normalizeWebSocketCloseReason(
                                        reason
                                    )
                                );
                            }
                        }
                });

        socket.on(
            "message",
            (
                data,
                isBinary
            ) => {
                if (!isBinary) {
                    void connection.close({
                        closeCode:
                            VoiceTransportCloseCode
                                .PROTOCOL_ERROR,

                        closeMessage:
                            "Voice WebSocket accepts only binary messages."
                    });

                    return;
                }

                let packet = null;

                if (
                    Buffer.isBuffer(
                        data
                    )
                ) {
                    packet = data;
                } else if (
                    Array.isArray(
                        data
                    )
                ) {
                    packet =
                        Buffer.concat(
                            data
                        );
                } else if (
                    data instanceof
                    ArrayBuffer
                ) {
                    packet =
                        Buffer.from(
                            data
                        );
                } else {
                    packet =
                        Buffer.from(
                            data
                        );
                }

                void connection
                    .receiveBinary(
                        packet
                    )
                    .catch(
                        () => undefined
                    );
            }
        );

        socket.once(
            "close",
            () => {
                void connection
                    .notifyTransportClosed(
                        "Voice WebSocket closed."
                    );
            }
        );

        socket.once(
            "error",
            (error) => {
                void connection
                    .notifyTransportClosed(
                        error?.message ??
                        "Voice WebSocket failed."
                    );
            }
        );
    }

    //* این تابع تمام اتصال‌ها و شنونده موقت وب‌سوکت را می‌بندد و آزادشدن پورت را انتظار می‌کشد.
    async stop() {
        const server =
            this.server;

        if (!server) return;

        this.server = null;

        await this.gateway.closeAll(
            "Voice WebSocket test adapter stopped."
        );

        for (
            const socket of
            server.clients
        ) {
            if (
                socket.readyState ===
                    WebSocket.OPEN ||
                socket.readyState ===
                    WebSocket.CONNECTING
            ) {
                socket.terminate();
            }
        }

        await new Promise(
            (
                resolve,
                reject
            ) => {
                server.close(
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

        this.host = "";
        this.port = 0;
    }

    //* این تابع نام قدیمی عملیات بستن شنونده وب‌سوکت را به عملیات فعلی متصل می‌کند.
    async close() {
        await this.stop();
    }
}

//* این نام سازگار، سازنده قدیمی شنونده وب‌سوکت را بدون حذف نام جدید نگه می‌دارد.
const VoiceWebSocketTestListener =
    VoiceWebSocketTestAdapter;

export {
    VoiceWebSocketTestAdapter,
    VoiceWebSocketTestListener
};

/*
توضیح فایل:
این فایل آداپتور آزمایشی وب‌سوکت باینری را فقط روی نشانی محلی و پورت موقت اجرا می‌کند. نام جدید و نام قبلی شنونده هم‌زمان حفظ شده‌اند و هیچ اتصال به وب‌سوکت اصلی ریل‌تایم، فایل ورودی سرور، انجین‌اکس یا پورت ثابت ایجاد نمی‌شود.
*/
