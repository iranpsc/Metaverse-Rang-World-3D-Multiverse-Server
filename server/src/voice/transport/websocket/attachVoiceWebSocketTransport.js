// مسیر فایل: src/voice/transport/websocket/attachVoiceWebSocketTransport.js

import {
    randomUUID
} from "node:crypto";

import WebSocket from "ws";

import {
    VoiceTransportCloseCode,
    VoiceTransportName
} from "../voiceTransportConstants.js";

//* این تابع علت بستن وب‌سوکت را بدون شکستن نویسه‌ها به محدوده مجاز داده پایانی کاهش می‌دهد.
function normalizeVoiceWebSocketCloseReason(
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

//* این تابع کد داخلی بستن انتقال را به کد مجاز وب‌سوکت تبدیل می‌کند.
function normalizeVoiceWebSocketCloseCode(
    value
) {
    if (
        Number.isInteger(value) &&
        (
            value === 1000 ||
            (
                value >= 3000 &&
                value <= 4999
            )
        )
    ) {
        return value;
    }

    return 1011;
}

//* این تابع یک شنونده وب‌سوکت از قبل ساخته‌شده را بدون ساخت سرور یا پورت تازه به درگاه انتقال صوت متصل می‌کند.
function attachVoiceWebSocketTransport({
    webSocketServer,
    gateway,
    logger = null
} = {}) {
    if (
        !webSocketServer ||
        typeof webSocketServer.on !==
            "function" ||
        (
            typeof webSocketServer.off !==
                "function" &&
            typeof webSocketServer
                .removeListener !==
                "function"
        )
    ) {
        throw new TypeError(
            "webSocketServer does not provide the required event interface."
        );
    }

    if (
        !gateway ||
        typeof gateway
            .acceptConnection !==
            "function" ||
        !gateway.policy
    ) {
        throw new TypeError(
            "gateway does not provide the required Voice transport interface."
        );
    }

    const attachedConnections =
        new Map();

    let stopped = false;

    //* این تابع یک بسته باینری را روی وب‌سوکت باز ارسال و نتیجه ارسال را انتظار می‌کشد.
    function sendVoiceWebSocketPacket(
        socket,
        packet
    ) {
        return new Promise(
            (resolve, reject) => {
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

    //* این تابع رویداد اتصال وب‌سوکت را به یک اتصال مستقل درگاه صوت تبدیل می‌کند.
    function handleVoiceWebSocketConnection(
        socket
    ) {
        if (
            stopped ||
            !socket ||
            typeof socket.on !==
                "function" ||
            typeof socket.send !==
                "function"
        ) {
            socket?.terminate?.();
            return;
        }

        const transportConnectionKey =
            `voice-websocket-${randomUUID()}`;

        let connection = null;

        //* این تابع راه انتقال زیرین وب‌سوکت را با کد و علت تعیین‌شده می‌بندد.
        function closeVoiceWebSocket(
            closeCode,
            closeReason
        ) {
            const normalizedCode =
                normalizeVoiceWebSocketCloseCode(
                    closeCode
                );

            const normalizedReason =
                normalizeVoiceWebSocketCloseReason(
                    closeReason
                );

            if (
                socket.readyState ===
                WebSocket.OPEN
            ) {
                socket.close(
                    normalizedCode,
                    normalizedReason
                );

                return;
            }

            if (
                socket.readyState ===
                WebSocket.CONNECTING
            ) {
                socket.terminate?.();
            }
        }

        connection =
            gateway.acceptConnection({
                transportName:
                    VoiceTransportName
                        .WEBSOCKET,

                transportConnectionKey,

                getBufferedAmount:
                    () =>
                        Number(
                            socket
                                .bufferedAmount ??
                            0
                        ),

                sendBinary:
                    (packet) =>
                        sendVoiceWebSocketPacket(
                            socket,
                            packet
                        ),

                closeTransport:
                    closeVoiceWebSocket
            });

        attachedConnections.set(
            transportConnectionKey,
            {
                socket,
                connection
            }
        );

        //* این تابع پیام ورودی وب‌سوکت را فقط در حالت باینری به هسته صوت تحویل می‌دهد.
        function handleVoiceWebSocketMessage(
            data,
            isBinary
        ) {
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

            if (Buffer.isBuffer(data)) {
                packet = data;
            } else if (
                Array.isArray(data)
            ) {
                packet =
                    Buffer.concat(data);
            } else if (
                data instanceof
                ArrayBuffer
            ) {
                packet =
                    Buffer.from(data);
            } else if (
                data instanceof
                Uint8Array
            ) {
                packet =
                    Buffer.from(
                        data.buffer,
                        data.byteOffset,
                        data.byteLength
                    );
            }

            void connection
                .receiveBinary(packet)
                .catch(
                    (error) => {
                        logger?.warn?.(
                            "Voice WebSocket packet processing failed.",
                            {
                                transportConnectionKey,
                                error:
                                    error?.message ??
                                    String(error)
                            }
                        );
                    }
                );
        }

        //* این تابع بسته‌شدن وب‌سوکت را به هسته اعلام و رکورد محلی آداپتور را پاک می‌کند.
        function handleVoiceWebSocketClose() {
            attachedConnections.delete(
                transportConnectionKey
            );

            void connection
                .notifyTransportClosed(
                    "Voice WebSocket closed."
                );
        }

        //* این تابع خطای وب‌سوکت را ثبت و به هسته انتقال اعلام می‌کند.
        function handleVoiceWebSocketError(
            error
        ) {
            attachedConnections.delete(
                transportConnectionKey
            );

            logger?.warn?.(
                "Voice WebSocket transport failed.",
                {
                    transportConnectionKey,
                    error:
                        error?.message ??
                        String(error)
                }
            );

            void connection
                .notifyTransportClosed(
                    error?.message ??
                    "Voice WebSocket failed."
                );
        }

        socket.on(
            "message",
            handleVoiceWebSocketMessage
        );

        socket.once(
            "close",
            handleVoiceWebSocketClose
        );

        socket.once(
            "error",
            handleVoiceWebSocketError
        );
    }

    webSocketServer.on(
        "connection",
        handleVoiceWebSocketConnection
    );

    //* این تابع اتصال رویداد وب‌سوکت و همه اتصال‌های ساخته‌شده توسط همین آداپتور را پاک‌سازی می‌کند.
    async function stopVoiceWebSocketTransport() {
        if (stopped) {
            return;
        }

        stopped = true;

        if (
            typeof webSocketServer.off ===
            "function"
        ) {
            webSocketServer.off(
                "connection",
                handleVoiceWebSocketConnection
            );
        } else {
            webSocketServer.removeListener(
                "connection",
                handleVoiceWebSocketConnection
            );
        }

        const connections =
            Array.from(
                attachedConnections
                    .values()
            );

        attachedConnections.clear();

        await Promise.allSettled(
            connections.map(
                ({ connection }) =>
                    connection.close({
                        closeCode:
                            VoiceTransportCloseCode
                                .NORMAL,

                        closeMessage:
                            "Voice WebSocket transport stopped."
                    })
            )
        );
    }

    //* این تابع آمار اتصال‌های ساخته‌شده توسط آداپتور و آمار درگاه مشترک را برمی‌گرداند.
    function getVoiceWebSocketTransportStats() {
        return Object.freeze({
            attachedConnections:
                attachedConnections.size,

            gateway:
                gateway.getStats?.() ??
                null
        });
    }

    return Object.freeze({
        webSocketServer,
        gateway,

        stop:
            stopVoiceWebSocketTransport,

        getStats:
            getVoiceWebSocketTransportStats
    });
}

export {
    attachVoiceWebSocketTransport
};

/*
توضیح فایل:
این فایل یک شنونده وب‌سوکت از قبل ساخته‌شده را به هسته انتقال صوت متصل می‌کند. خودش سرور، پورت یا مسیر عمومی ایجاد نمی‌کند.
*/
