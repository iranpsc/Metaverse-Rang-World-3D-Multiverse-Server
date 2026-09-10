// مسیر فایل: src/voice/transport/grpc/voiceGrpcTestAdapter.js

import {
    randomUUID
} from "node:crypto";

import {
    fileURLToPath
} from "node:url";

import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

import {
    VoiceTransportName
} from "../voiceTransportConstants.js";

const VOICE_GRPC_PROTO_PATH =
    fileURLToPath(
        new URL(
            "./voiceTransport.proto",
            import.meta.url
        )
    );

const VOICE_GRPC_TEST_PROTO_PATH =
    fileURLToPath(
        new URL(
            "./voiceTransportTest.proto",
            import.meta.url
        )
    );

const VOICE_GRPC_LOADER_OPTIONS =
    Object.freeze({
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });

//* این تابع یک قرارداد جی‌آرپی را از مسیر تعیین‌شده بارگذاری و شاخه بسته مورد انتظار را برمی‌گرداند.
function loadVoiceGrpcPackage(
    protoPath,
    packageSelector,
    serviceName
) {
    const packageDefinition =
        protoLoader.loadSync(
            protoPath,
            VOICE_GRPC_LOADER_OPTIONS
        );

    const loaded =
        grpc.loadPackageDefinition(
            packageDefinition
        );

    const servicePackage =
        packageSelector(loaded);

    if (
        !servicePackage ||
        !servicePackage[serviceName]
    ) {
        throw new Error(
            `Voice gRPC service ${serviceName} could not be loaded from ${protoPath}.`
        );
    }

    return servicePackage;
}

//* این تابع قرارداد جدید جی‌آرپی انتقال صوتی را از فایل پروتو بارگذاری می‌کند.
function loadVoiceGrpcTransportDefinition() {
    return loadVoiceGrpcPackage(
        VOICE_GRPC_PROTO_PATH,
        (loaded) =>
            loaded?.metaverse?.voice
                ?.transport?.v1,
        "VoiceTransport"
    );
}

//* این تابع قرارداد سازگار با آزمون‌های قبلی جی‌آرپی را از فایل پروتو بارگذاری می‌کند.
function loadVoiceGrpcTestDefinition() {
    return loadVoiceGrpcPackage(
        VOICE_GRPC_TEST_PROTO_PATH,
        (loaded) =>
            loaded?.metaverse?.voice
                ?.transport?.test?.v1,
        "VoiceTransportTest"
    );
}

//* این تابع کلاینت سازگار با آزمون‌های قبلی جی‌آرپی را برای نشانی محلی تعیین‌شده می‌سازد.
function createVoiceGrpcTestClient(
    target,
    options = {}
) {
    if (
        typeof target !== "string" ||
        !target.trim()
    ) {
        throw new TypeError(
            "Voice gRPC test target must be a non-empty string."
        );
    }

    if (
        !options ||
        typeof options !== "object" ||
        Array.isArray(options)
    ) {
        throw new TypeError(
            "Voice gRPC client options must be an object."
        );
    }

    const servicePackage =
        loadVoiceGrpcTestDefinition();

    const client =
        new servicePackage
            .VoiceTransportTest(
                target.trim(),
                grpc.credentials
                    .createInsecure(),
                options
            );

    if (
        typeof client.connect !==
            "function" &&
        typeof client.Connect ===
            "function"
    ) {
        Object.defineProperty(
            client,
            "connect",
            {
                configurable: true,
                enumerable: false,
                writable: false,
                value:
                    client.Connect.bind(
                        client
                    )
            }
        );
    }

    return client;
}

//* این تابع در زمان پرشدن صف خروجی جی‌آرپی تا آزادشدن جریان یا رسیدن مهلت انتظار می‌کند.
function waitForGrpcDrain(
    call,
    timeoutMs
) {
    return new Promise(
        (resolve, reject) => {
            let timeoutHandle = null;

            const cleanup = () => {
                call.off(
                    "drain",
                    handleDrain
                );

                call.off(
                    "error",
                    handleError
                );

                call.off(
                    "cancelled",
                    handleCancelled
                );

                if (timeoutHandle) {
                    clearTimeout(
                        timeoutHandle
                    );
                }
            };

            const handleDrain = () => {
                cleanup();
                resolve();
            };

            const handleError = (error) => {
                cleanup();
                reject(error);
            };

            const handleCancelled = () => {
                cleanup();

                reject(
                    new Error(
                        "Voice gRPC stream was cancelled while waiting for drain."
                    )
                );
            };

            call.once(
                "drain",
                handleDrain
            );

            call.once(
                "error",
                handleError
            );

            call.once(
                "cancelled",
                handleCancelled
            );

            timeoutHandle =
                setTimeout(
                    () => {
                        cleanup();

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

class VoiceGrpcTestAdapter {
    //* این سازنده درگاه مشترک انتقال و هر دو قرارداد آزمون جی‌آرپی را آماده می‌کند.
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

        this.servicePackage =
            loadVoiceGrpcTransportDefinition();

        this.testServicePackage =
            loadVoiceGrpcTestDefinition();
    }

    //* این تابع شنونده جی‌آرپی را فقط روی نشانی محلی و پورت موقت یا تعیین‌شده آزمون باز می‌کند.
    async start({
        host = "127.0.0.1",
        port = 0
    } = {}) {
        if (this.server) {
            throw new Error(
                "Voice gRPC test adapter is already started."
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

        const server =
            new grpc.Server({
                "grpc.max_receive_message_length":
                    this.gateway.policy
                        .maxPacketBytes,

                "grpc.max_send_message_length":
                    this.gateway.policy
                        .maxPacketBytes
            });

        server.addService(
            this.servicePackage
                .VoiceTransport
                .service,
            {
                connect:
                    (call) => {
                        this.attachCall(call);
                    }
            }
        );

        server.addService(
            this.testServicePackage
                .VoiceTransportTest
                .service,
            {
                connect:
                    (call) => {
                        this.attachCall(call);
                    }
            }
        );

        let boundPort = 0;

        try {
            boundPort =
                await new Promise(
                    (resolve, reject) => {
                        server.bindAsync(
                            `${host.trim()}:${port}`,
                            grpc.ServerCredentials
                                .createInsecure(),
                            (
                                error,
                                resultPort
                            ) => {
                                if (error) {
                                    reject(error);
                                    return;
                                }

                                resolve(
                                    resultPort
                                );
                            }
                        );
                    }
                );
        } catch (error) {
            server.forceShutdown();
            throw error;
        }

        this.server = server;
        this.host = host.trim();
        this.port = boundPort;

        server.start();

        const target =
            `${this.host}:${this.port}`;

        return Object.freeze({
            host: this.host,
            port: this.port,
            address: target,
            target
        });
    }

    //* این تابع یک جریان دوطرفه جی‌آرپی را به هسته مشترک باینری متصل و رویدادهای آن را پاک‌سازی می‌کند.
    attachCall(call) {
        const transportConnectionKey =
            `voice-grpc-test-${randomUUID()}`;

        const connection =
            this.gateway
                .acceptConnection({
                    transportName:
                        VoiceTransportName
                            .GRPC_BIDIRECTIONAL_TEST,

                    transportConnectionKey,

                    getBufferedAmount:
                        () => 0,

                    sendBinary:
                        async (packet) => {
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
                                await waitForGrpcDrain(
                                    call,
                                    this.gateway
                                        .policy
                                        .sendTimeoutMs
                                );
                            }
                        },

                    closeTransport:
                        () => {
                            if (
                                !call.destroyed
                            ) {
                                call.end();
                            }
                        }
                });

        call.on(
            "data",
            (message) => {
                void connection
                    .receiveBinary(
                        message?.packet
                    )
                    .catch(
                        () => undefined
                    );
            }
        );

        call.once(
            "end",
            () => {
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
        );

        call.once(
            "cancelled",
            () => {
                void connection
                    .notifyTransportClosed(
                        "Voice gRPC stream was cancelled."
                    );
            }
        );

        call.once(
            "error",
            (error) => {
                void connection
                    .notifyTransportClosed(
                        error?.message ??
                        "Voice gRPC stream failed."
                    );
            }
        );
    }

    //* این تابع تمام اتصال‌ها و شنونده موقت جی‌آرپی را می‌بندد و آزادشدن پورت را انتظار می‌کشد.
    async stop() {
        const server = this.server;

        if (!server) return;

        this.server = null;

        await this.gateway.closeAll(
            "Voice gRPC test adapter stopped."
        );

        await new Promise(
            (resolve) => {
                let completed = false;

                const finish = () => {
                    if (completed) return;

                    completed = true;
                    resolve();
                };

                const timeoutHandle =
                    setTimeout(
                        () => {
                            server.forceShutdown();
                            finish();
                        },
                        2_000
                    );

                timeoutHandle.unref?.();

                server.tryShutdown(
                    () => {
                        clearTimeout(
                            timeoutHandle
                        );

                        finish();
                    }
                );
            }
        );

        this.host = "";
        this.port = 0;
    }

    //* این تابع نام قدیمی عملیات بستن شنونده جی‌آرپی را به عملیات فعلی متصل می‌کند.
    async close() {
        await this.stop();
    }
}

//* این نام سازگار، سازنده قدیمی شنونده جی‌آرپی را بدون حذف نام جدید نگه می‌دارد.
const VoiceGrpcTestListener =
    VoiceGrpcTestAdapter;

export {
    VOICE_GRPC_PROTO_PATH,
    VOICE_GRPC_TEST_PROTO_PATH,
    VoiceGrpcTestAdapter,
    VoiceGrpcTestListener,
    createVoiceGrpcTestClient,
    loadVoiceGrpcTestDefinition,
    loadVoiceGrpcTransportDefinition
};

/*
توضیح فایل:
این فایل هر دو قرارداد آزمایشی جی‌آرپی موجود را روی یک شنونده موقت محلی ثبت می‌کند. نام‌های جدید و قبلی آداپتور و کلاینت هم‌زمان حفظ شده‌اند و هیچ اتصال به اجرای اصلی، انووی یا پورت ثابت ایجاد نمی‌شود.
*/
