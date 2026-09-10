import {
    VoiceConnectionCloseReason
} from "../core/voiceConnectionConstants.js";

import {
    VoiceConnectionRegistrationStage
} from "../core/voiceConnectionRegistrationService.js";

class VoiceAuthoritativeConnectionRegistrationAdapter {
    //* این سازنده ثبت اتصال را با پاک‌سازی Voice قدیمی که دیگر به Dedicated authoritative تعلق ندارد هماهنگ می‌کند.
    constructor({
        connectionRegistrationService,
        voiceConnectionRegistry,
        reconnectCoordinator,
        now = () => Date.now()
    } = {}) {
        if (
            !connectionRegistrationService ||
            typeof connectionRegistrationService.registerAndActivate !== "function"
        ) {
            throw new TypeError(
                "connectionRegistrationService must provide registerAndActivate."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry.getByUserAndAvatar !== "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry must provide getByUserAndAvatar."
            );
        }

        if (
            !reconnectCoordinator ||
            typeof reconnectCoordinator.closeConnectionImmediately !== "function"
        ) {
            throw new TypeError(
                "reconnectCoordinator must provide closeConnectionImmediately."
            );
        }

        if (typeof now !== "function") {
            throw new TypeError("now must be a function.");
        }

        this.connectionRegistrationService =
            connectionRegistrationService;

        this.voiceConnectionRegistry =
            voiceConnectionRegistry;

        this.reconnectCoordinator =
            reconnectCoordinator;

        this.now = now;
        this.authoritativeHandoffs = 0;
    }

    //* این تابع فقط تعارض Voice قدیمی با Dedicated connection تازه و client instance تازه را پاک و همان Auth را یک بار تکرار می‌کند.
    registerAndActivate(input = {}) {
        const firstResult =
            this.connectionRegistrationService
                .registerAndActivate(input);

        if (
            firstResult?.success === true ||
            firstResult?.stage !==
                VoiceConnectionRegistrationStage.REGISTRATION
        ) {
            return firstResult;
        }

        const registrationInput =
            firstResult
                ?.preparationResult
                ?.registrationInput;

        if (!registrationInput) {
            return firstResult;
        }

        const conflictingConnection =
            this.voiceConnectionRegistry
                .getByUserAndAvatar(
                    registrationInput.userId,
                    registrationInput.avatarId
                );

        if (!conflictingConnection) {
            return firstResult;
        }

        const sameVoiceScope =
            conflictingConnection.userId ===
                registrationInput.userId &&
            conflictingConnection.avatarId ===
                registrationInput.avatarId &&
            conflictingConnection.roomId ===
                registrationInput.roomId;

        const dedicatedIdentityChanged =
            conflictingConnection.connectionId !==
                registrationInput.connectionId;

        const clientInstanceChanged =
            conflictingConnection.clientInstanceId !==
                registrationInput.clientInstanceId;

        if (
            !sameVoiceScope ||
            !dedicatedIdentityChanged ||
            !clientInstanceChanged
        ) {
            return firstResult;
        }

        const effectiveAtMs =
            Number.isSafeInteger(input?.activatedAtMs) &&
            input.activatedAtMs >= 0
                ? input.activatedAtMs
                : this.now();

        this.reconnectCoordinator
            .closeConnectionImmediately(
                conflictingConnection.connectionId,
                VoiceConnectionCloseReason.DEDICATED_DISCONNECTED,
                effectiveAtMs
            );

        const retryResult =
            this.connectionRegistrationService
                .registerAndActivate(input);

        if (retryResult?.success === true) {
            this.authoritativeHandoffs += 1;
        }

        return retryResult;
    }

    //* این تابع شمار handoffهای authoritative را برای عیب‌یابی محدود Voice برمی‌گرداند.
    getStats() {
        return Object.freeze({
            authoritativeHandoffs:
                this.authoritativeHandoffs
        });
    }
}

export {
    VoiceAuthoritativeConnectionRegistrationAdapter
};

/*
توضیح فایل:
این Adapter فقط وقتی اتصال Voice قبلی دیگر با Dedicated connection احراز‌شده فعلی یکی نیست و Runtime تازه‌ای وارد شده است، state قدیمی Voice را اتمیک می‌بندد و Auth را یک بار تکرار می‌کند. Reconnect همان Runtime دست‌نخورده می‌ماند.
*/
