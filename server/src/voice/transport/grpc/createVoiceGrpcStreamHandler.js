// مسیر فایل: src/voice/transport/grpc/createVoiceGrpcStreamHandler.js

import {
    randomUUID
} from "node:crypto";

import {
    VoiceTransportName
} from "../voiceTransportConstants.js";

//* این تابع هنگام پرشدن صف خروجی جی‌آرپی تا آزادشدن جریان یا پایان مهلت انتظار می‌کند.
function waitForVoiceGrpcDrain(
    call,
    timeoutMs
) {
    return new Promise(
        (resolve, reject) => {
            let timeoutHandle = null;

            //* این تابع شنونده‌های موقت انتظار برای آزادشدن جریان را پاک می‌کند.
            function cleanupVoiceGrpcDrainWait() {
                call.off(
                    "drain",
                    handleVoiceGrpcDrain
                );

                call.off(
                    "error",
                    handleVoiceGrpcDrainError
                );

                call.off(
                    "cancelled",
                    handleVoiceGrpcDrainCancelled
                );

                if (timeoutHandle) {
                    clearTimeout(
                        timeoutHandle
                    );
                }
            }

            //* این تابع آزادشدن صف خروجی جی‌آرپی را تأیید می‌کند.
            function handleVoiceGrpcDrain() {
                cleanupVoiceGrpcDrainWait();
                resolve();
            }

            //* این تابع خطای جریان را هنگام انتظار برای آزادشدن صف برمی‌گرداند.
            function handleVoiceGrpcDrainError(
                error
            ) {
                cleanupVoiceGrpcDrainWait();
                reject(error);
            }

            //* این تابع لغو جریان را هنگام انتظار برای آزادشدن صف به خطا تبدیل می‌کند.
            function handleVoiceGrpcDrainCancelled() {
                cleanupVoiceGrpcDrainWait();

                reject(
                    new Error(
                        "Voice gRPC stream was cancelled while waiting for drain."
                    )
                );
            }

            call.once(
                "drain",
                handleVoiceGrpcDrain
            );

            call.once(
                "error",
                handleVoiceGrpcDrainError
            );

            call.once(
                "cancelled",
                handleVoiceGrpcDrainCancelled
            );

            timeoutHandle =
                setTimeout(
                    () => {
                        cleanupVoiceGrpcDrainWait();

                        reject(
                            new Error(
                                "Voice gRPC drain timeout."
                            )
                        );
                    },
                    timeoutMs
                );

            timeoutHandle.unref?.();
        }
    );
}

//* این تابع هندلر جریان دوطرفه جی‌آرپی صوت را بدون ثبت آن روی سرور اصلی می‌سازد.
function createVoiceGrpcStreamHandler({
    gateway,
    logger = null
} = {}) {
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

    //* این تابع یک جریان جی‌آرپی ورودی را به اتصال مستقل درگاه صوت تبدیل می‌کند.
    function handleVoiceGrpcStream(
        call
    ) {
        if (
            !call ||
            typeof call.on !==
                "function" ||
            typeof call.write !==
                "function" ||
            typeof call.end !==
                "function"
        ) {
            throw new TypeError(
                "Voice gRPC call does not provide the required stream interface."
            );
        }

        const transportConnectionKey =
            `voice-grpc-${randomUUID()}`;

        //* این تابع یک بسته باینری را با کنترل فشار خروجی روی جریان جی‌آرپی می‌فرستد.
        async function sendVoiceGrpcPacket(
            packet
        ) {
            if (
                call.cancelled ||
                call.destroyed
            ) {
                throw new Error(
                    "Voice gRPC stream is not writable."
                );
            }

            const canContinue =
                call.write({
                    packet
                });

            if (!canContinue) {
                await waitForVoiceGrpcDrain(
                    call,
                    gateway.policy
                        .sendTimeoutMs
                );
            }
        }

        //* این تابع جریان جی‌آرپی زیرین را در صورت بازبودن پایان می‌دهد.
        function closeVoiceGrpcStream() {
            if (!call.destroyed) {
                call.end();
            }
        }

        const connection =
            gateway.acceptConnection({
                transportName:
                    VoiceTransportName.GRPC,

                transportConnectionKey,

                getBufferedAmount:
                    () => 0,

                sendBinary:
                    sendVoiceGrpcPacket,

                closeTransport:
                    closeVoiceGrpcStream
            });

        //* این تابع بسته ورودی جریان جی‌آرپی را به هسته صوت تحویل می‌دهد.
        function handleVoiceGrpcData(
            message
        ) {
            void connection
                .receiveBinary(
                    message?.packet
                )
                .catch(
                    (error) => {
                        logger?.warn?.(
                            "Voice gRPC packet processing failed.",
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

        //* این تابع پایان عادی جریان درخواست را به هسته اعلام و پاسخ را پایان می‌دهد.
        function handleVoiceGrpcEnd() {
            void connection
                .notifyTransportClosed(
                    "Voice gRPC request stream ended."
                )
                .finally(
                    () => {
                        if (
                            !call.destroyed
                        ) {
                            call.end();
                        }
                    }
                );
        }

        //* این تابع لغوشدن جریان جی‌آرپی را به هسته انتقال اعلام می‌کند.
        function handleVoiceGrpcCancelled() {
            void connection
                .notifyTransportClosed(
                    "Voice gRPC stream was cancelled."
                );
        }

        //* این تابع خطای جریان جی‌آرپی را ثبت و به هسته انتقال اعلام می‌کند.
        function handleVoiceGrpcError(
            error
        ) {
            logger?.warn?.(
                "Voice gRPC transport failed.",
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
                    "Voice gRPC stream failed."
                );
        }

        call.on(
            "data",
            handleVoiceGrpcData
        );

        call.once(
            "end",
            handleVoiceGrpcEnd
        );

        call.once(
            "cancelled",
            handleVoiceGrpcCancelled
        );

        call.once(
            "error",
            handleVoiceGrpcError
        );

        return connection;
    }

    return handleVoiceGrpcStream;
}

export {
    createVoiceGrpcStreamHandler
};

/*
توضیح فایل:
این فایل برای هر جریان دوطرفه جی‌آرپی یک اتصال درگاه صوت می‌سازد. این فایل هیچ سرور یا پورتی را باز نمی‌کند.
*/
