// مسیر فایل: src/voice/core/voiceConnectionRegistrationService.js

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionState
} from "./voiceConnectionConstants.js";

const VoiceConnectionRegistrationStage =
    Object.freeze({
        PREPARATION:
            "preparation",

        REGISTRATION:
            "registration",

        ACTIVATION:
            "activation",

        ACTIVE:
            "active"
    });

class VoiceConnectionRegistrationService {
    //* این سازنده سرویس آماده‌سازی و رجیستری اتصال صوتی را دریافت می‌کند.
    constructor({
        connectionPreparationService,
        voiceConnectionRegistry
    } = {}) {
        if (
            !connectionPreparationService ||
            typeof connectionPreparationService
                .prepare !== "function"
        ) {
            throw new TypeError(
                "connectionPreparationService must provide prepare."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry
                .registerAuthenticatedConnection !==
                "function" ||
            typeof voiceConnectionRegistry
                .getByConnectionId !==
                "function" ||
            typeof voiceConnectionRegistry
                .removeConnection !==
                "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry does not provide the required interface."
            );
        }

        this.connectionPreparationService =
            connectionPreparationService;

        this.voiceConnectionRegistry =
            voiceConnectionRegistry;

        Object.seal(this);
    }

    //* این تابع بررسی‌های اتصال را انجام می‌دهد و اتصال تأییدشده را ثبت و فعال می‌کند.
    registerAndActivate({
        activatedAtMs =
            Date.now(),

        ...preparationInput
    } = {}) {
        if (
            !Number.isSafeInteger(
                activatedAtMs
            ) ||
            activatedAtMs < 0
        ) {
            return Object.freeze({
                success: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .INVALID_PAYLOAD,
                stage:
                    VoiceConnectionRegistrationStage
                        .ACTIVATION,
                reused: false,
                connectionId: "",
                userId: "",
                roomId: "",
                connection: null,
                preparationResult: null,
                message:
                    "activatedAtMs is invalid."
            });
        }

        const preparationResult =
            this.connectionPreparationService
                .prepare(
                    preparationInput
                );

        if (
            preparationResult?.ready !==
                true ||
            !preparationResult
                .registrationInput
        ) {
            return Object.freeze({
                success: false,
                retryable:
                    preparationResult
                        ?.retryable ===
                    true,
                code:
                    preparationResult
                        ?.code ??
                    VoiceAuthResultCode
                        .INVALID_PAYLOAD,
                stage:
                    VoiceConnectionRegistrationStage
                        .PREPARATION,
                reused: false,
                connectionId: "",
                userId:
                    String(
                        preparationResult
                            ?.userId ??
                        ""
                    ).trim(),
                roomId:
                    String(
                        preparationResult
                            ?.roomId ??
                        ""
                    ).trim(),
                connection: null,
                preparationResult:
                    preparationResult ??
                    null,
                message:
                    "Voice connection preparation failed."
            });
        }

        const registrationInput =
            preparationResult
                .registrationInput;

        const existingConnection =
            this.voiceConnectionRegistry
                .getByConnectionId(
                    registrationInput
                        .connectionId
                );

        if (existingConnection) {
            const isSameConnection =
                existingConnection.userId ===
                    registrationInput.userId &&
                existingConnection.avatarId ===
                    registrationInput.avatarId &&
                existingConnection.roomId ===
                    registrationInput.roomId &&
                existingConnection.clientInstanceId ===
                    registrationInput
                        .clientInstanceId;

            if (!isSameConnection) {
                return Object.freeze({
                    success: false,
                    retryable: false,
                    code:
                        VoiceAuthResultCode
                            .INVALID_PAYLOAD,
                    stage:
                        VoiceConnectionRegistrationStage
                            .REGISTRATION,
                    reused: false,
                    connectionId:
                        registrationInput
                            .connectionId,
                    userId:
                        registrationInput
                            .userId,
                    roomId:
                        registrationInput
                            .roomId,
                    connection: null,
                    preparationResult,
                    message:
                        "The Dedicated connection id belongs to another Voice connection."
                });
            }

            const usesSameTransport =
                existingConnection.transportName ===
                    registrationInput.transportName &&
                existingConnection.transportConnectionKey ===
                    registrationInput.transportConnectionKey;

            if (
                existingConnection.state ===
                    VoiceConnectionState.ACTIVE &&
                !usesSameTransport
            ) {
                return Object.freeze({
                    success: false,
                    retryable: true,
                    code:
                        VoiceAuthResultCode
                            .REALTIME_NOT_READY,
                    stage:
                        VoiceConnectionRegistrationStage
                            .REGISTRATION,
                    reused: false,
                    resumed: false,
                    connectionId:
                        existingConnection.connectionId,
                    userId:
                        existingConnection.userId,
                    roomId:
                        existingConnection.roomId,
                    connection:
                        existingConnection.snapshot(),
                    preparationResult,
                    message:
                        "The existing Voice connection is still active on another transport."
                });
            }

            if (
                existingConnection.state ===
                VoiceConnectionState
                    .AUTHENTICATED
            ) {
                existingConnection.activate(
                    activatedAtMs
                );
            }

            let resumed = false;

            if (
                existingConnection.state ===
                VoiceConnectionState
                    .SUSPENDED
            ) {
                existingConnection.resume({
                    transportName:
                        registrationInput
                            .transportName,
                    transportConnectionKey:
                        registrationInput
                            .transportConnectionKey,
                    resumedAtMs:
                        activatedAtMs
                });

                resumed = true;
            }

            if (
                existingConnection.state !==
                VoiceConnectionState.ACTIVE
            ) {
                return Object.freeze({
                    success: false,
                    retryable: true,
                    code:
                        VoiceAuthResultCode
                            .REALTIME_NOT_READY,
                    stage:
                        VoiceConnectionRegistrationStage
                            .ACTIVATION,
                    reused: false,
                    connectionId:
                        existingConnection
                            .connectionId,
                    userId:
                        existingConnection
                            .userId,
                    roomId:
                        existingConnection
                            .roomId,
                    connection:
                        existingConnection
                            .snapshot(),
                    preparationResult,
                    message:
                        "The existing Voice connection requires the reconnect flow."
                });
            }

            return Object.freeze({
                success: true,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .AUTHENTICATED,
                stage:
                    VoiceConnectionRegistrationStage
                        .ACTIVE,
                reused: true,
                resumed,
                connectionId:
                    existingConnection
                        .connectionId,
                userId:
                    existingConnection
                        .userId,
                roomId:
                    existingConnection
                        .roomId,
                connection:
                    existingConnection
                        .snapshot(),
                preparationResult,
                message:
                    resumed
                        ? "The suspended Voice connection was resumed."
                        : "The existing Voice connection is already active."
            });
        }

        let connection = null;

        try {
            connection =
                this.voiceConnectionRegistry
                    .registerAuthenticatedConnection(
                        registrationInput
                    );
        } catch (error) {
            return Object.freeze({
                success: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .INVALID_PAYLOAD,
                stage:
                    VoiceConnectionRegistrationStage
                        .REGISTRATION,
                reused: false,
                connectionId:
                    registrationInput
                        .connectionId,
                userId:
                    registrationInput
                        .userId,
                roomId:
                    registrationInput
                        .roomId,
                connection: null,
                preparationResult,
                message:
                    error?.message ??
                    String(error)
            });
        }

        let snapshot = null;

        try {
            snapshot =
                connection.activate(
                    activatedAtMs
                );
        } catch (error) {
            this.voiceConnectionRegistry
                .removeConnection(
                    connection.connectionId
                );

            return Object.freeze({
                success: false,
                retryable: true,
                code:
                    VoiceAuthResultCode
                        .INTERNAL_ERROR,
                stage:
                    VoiceConnectionRegistrationStage
                        .ACTIVATION,
                reused: false,
                connectionId:
                    connection.connectionId,
                userId:
                    connection.userId,
                roomId:
                    connection.roomId,
                connection: null,
                preparationResult,
                message:
                    error?.message ??
                    String(error)
            });
        }

        return Object.freeze({
            success: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            stage:
                VoiceConnectionRegistrationStage
                    .ACTIVE,
            reused: false,
            connectionId:
                connection.connectionId,
            userId:
                connection.userId,
            roomId:
                connection.roomId,
            connection:
                snapshot,
            preparationResult,
            message:
                "Voice connection registered and activated."
        });
    }
}

export {
    VoiceConnectionRegistrationService,
    VoiceConnectionRegistrationStage
};

/*
توضیح فایل:
این فایل ابتدا توکن، روم و حضور کاربر داخل سرور اختصاصی را بررسی می‌کند. سپس اتصال صوتی را با همان شناسه اتصال بازیکن داخل رجیستری ثبت و فعال می‌کند. درخواست تکراری کاملاً یکسان دوباره ثبت نمی‌شود.
*/
