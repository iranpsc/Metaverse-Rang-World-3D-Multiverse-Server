// مسیر فایل: src/voice/transport/voiceTransportGateway.js

import {
    VoiceTransportConnection
} from "./voiceTransportConnection.js";

import {
    createVoiceTransportPolicy
} from "./voiceTransportConstants.js";

class VoiceTransportGateway {
    //* این سازنده سرویس ثبت، رجیستری و سیاست مشترک تمام اتصال‌های آزمایشی انتقال را دریافت می‌کند.
    constructor({
        connectionRegistrationService,
        voiceConnectionRegistry,
        application = null,
        capacityController = null,
        operationalMetrics = null,
        policy = {}
    } = {}) {
        if (
            !connectionRegistrationService ||
            typeof connectionRegistrationService
                .registerAndActivate !==
                "function"
        ) {
            throw new TypeError(
                "connectionRegistrationService must provide registerAndActivate."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry
                .removeConnection !==
                "function" ||
            typeof voiceConnectionRegistry
                .getStats !==
                "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry does not provide the required interface."
            );
        }

        this.connectionRegistrationService =
            connectionRegistrationService;
        this.voiceConnectionRegistry =
            voiceConnectionRegistry;
        this.application = application;
        this.capacityController = capacityController;
        this.operationalMetrics = operationalMetrics;
        this.policy =
            createVoiceTransportPolicy(
                policy
            );
        this.connections = new Map();

        if (
            this.application &&
            typeof this.application.setGateway === "function"
        ) {
            this.application.setGateway(this);
        }
    }

    //* این تابع یک راه انتقال تازه را ثبت و هسته پردازش مستقل آن را ایجاد می‌کند.
    acceptConnection({
        transportName,
        transportConnectionKey,
        sendBinary,
        closeTransport,
        getBufferedAmount = () => 0,
        now = () => Date.now()
    } = {}) {
        if (this.capacityController) {
            const capacity = this.capacityController.evaluate({
                totalConnections: this.voiceConnectionRegistry.getStats().total
            });
            if (!capacity.allowed) {
                this.operationalMetrics?.increment?.("capacity_rejections");
                throw new Error(`Voice capacity rejected the connection: ${capacity.reason}.`);
            }
        }

        const normalizedKey =
            String(
                transportConnectionKey ?? ""
            ).trim();

        if (!normalizedKey) {
            throw new TypeError(
                "transportConnectionKey is required."
            );
        }

        if (
            this.connections.has(
                normalizedKey
            )
        ) {
            throw new Error(
                "A Voice transport connection already exists for this key."
            );
        }

        const connection =
            new VoiceTransportConnection({
                connectionRegistrationService:
                    this.connectionRegistrationService,
                voiceConnectionRegistry:
                    this.voiceConnectionRegistry,
                application:
                    this.application,
                transportName,
                transportConnectionKey:
                    normalizedKey,
                sendBinary,
                closeTransport,
                getBufferedAmount,
                policy:
                    this.policy,
                now,
                onClosed:
                    () => {
                        this.connections.delete(
                            normalizedKey
                        );
                    }
            });

        this.connections.set(
            normalizedKey,
            connection
        );
        this.operationalMetrics?.increment?.("transport_connections_accepted");

        return connection;
    }

    //* این تابع یک اتصال انتقال را با کلید راه انتقال پیدا می‌کند.
    getConnection(
        transportConnectionKey
    ) {
        return this.connections.get(
            String(
                transportConnectionKey ?? ""
            ).trim()
        ) ?? null;
    }

    //* این تابع راه انتقال فعال یک شناسه اتصال احراز‌شده را پیدا می‌کند.
    getConnectionByConnectionId(
        connectionId
    ) {
        const normalizedConnectionId =
            String(connectionId ?? "")
                .trim()
                .toLowerCase();

        if (!normalizedConnectionId) return null;

        for (const connection of this.connections.values()) {
            if (
                connection.connectionId ===
                normalizedConnectionId
            ) {
                return connection;
            }
        }

        return null;
    }

    //* این تابع تمام اتصال‌های آزمایشی باز را می‌بندد و پاک‌سازی آن‌ها را کامل می‌کند.
    async closeAll(
        message =
            "Voice transport gateway closed."
    ) {
        const connections =
            Array.from(
                this.connections.values()
            );

        await Promise.allSettled(
            connections.map(
                (connection) =>
                    connection.close({
                        closeMessage:
                            String(message)
                    })
            )
        );
    }

    //* این تابع آمار هسته انتقال و رجیستری اتصال صوتی را برمی‌گرداند.
    getStats() {
        return Object.freeze({
            transportConnections:
                this.connections.size,
            voiceConnections:
                this.voiceConnectionRegistry
                    .getStats()
        });
    }
}

export {
    VoiceTransportGateway
};

/*
توضیح فایل:
این فایل هسته مشترک انتقال را برای هر اتصال وب‌سوکت یا جی‌آرپی ایجاد می‌کند و مالک چرخه عمر اتصال‌های آزمایشی است. این درگاه به اجرای اصلی سرور متصل نمی‌شود و هیچ شنونده‌ای را به‌تنهایی باز نمی‌کند.
*/
