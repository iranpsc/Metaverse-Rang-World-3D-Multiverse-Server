// مسیر فایل: src/voice/reconnect/webgl/voiceWebGLRoomReconnectRegistrationAdapter.js

import {
    VoiceClientPlatform
} from "../../auth/voiceAuthConstants.js";

import {
    VoiceConnectionCloseReason
} from "../../core/voiceConnectionConstants.js";

class VoiceWebGLRoomReconnectRegistrationAdapter {
    //* این سازنده سرویس اصلی را بدون تغییر نگه می‌دارد و فقط مسیر بازیابی وب جی ال را در اختیار می‌گیرد.
    constructor({
        baseRegistrationService,
        voiceConnectionRegistry,
        reconnectCoordinator,
        now = () => Date.now()
    } = {}) {
        if (
            !baseRegistrationService ||
            typeof baseRegistrationService.registerAndActivate !== "function" ||
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry.getByClientInstanceId !== "function" ||
            !reconnectCoordinator ||
            typeof reconnectCoordinator.closeConnectionImmediately !== "function" ||
            typeof now !== "function"
        ) {
            throw new TypeError(
                "WebGL Voice reconnect adapter dependencies are incomplete."
            );
        }

        this.baseRegistrationService = baseRegistrationService;
        this.voiceConnectionRegistry = voiceConnectionRegistry;
        this.reconnectCoordinator = reconnectCoordinator;
        this.now = now;
        Object.seal(this);
    }

    //* این تابع فقط احراز تازه وب جی ال را پس از تغییر شناسه قطعی ددیکیتد به اتصال تازه منتقل می‌کند.
    registerAndActivate(input = {}) {
        if (input.platform !== VoiceClientPlatform.WEBGL) {
            return this.baseRegistrationService.registerAndActivate(input);
        }

        const firstResult =
            this.baseRegistrationService.registerAndActivate(input);

        if (
            firstResult?.success === true ||
            !firstResult?.preparationResult?.registrationInput
        ) {
            return firstResult;
        }

        const registrationInput =
            firstResult.preparationResult.registrationInput;

        const retainedConnection =
            this.voiceConnectionRegistry.getByClientInstanceId(
                registrationInput.clientInstanceId
            );

        const sameAuthority =
            retainedConnection &&
            retainedConnection.platform === VoiceClientPlatform.WEBGL &&
            retainedConnection.userId === registrationInput.userId &&
            retainedConnection.avatarId === registrationInput.avatarId &&
            retainedConnection.roomId === registrationInput.roomId &&
            retainedConnection.clientInstanceId === registrationInput.clientInstanceId;

        if (
            !sameAuthority ||
            retainedConnection.connectionId === registrationInput.connectionId
        ) {
            return firstResult;
        }

        const previousConnectionState = retainedConnection.state;

        const retainedConnectionId =
            String(retainedConnection.connectionId ?? "")
                .trim()
                .toLowerCase();

        const currentDedicatedConnectionId =
            String(registrationInput.connectionId ?? "")
                .trim()
                .toLowerCase();

        const effectiveAtMs =
            Number.isSafeInteger(input.activatedAtMs) &&
            input.activatedAtMs >= 0
                ? input.activatedAtMs
                : this.now();

        this.reconnectCoordinator.closeConnectionImmediately(
            retainedConnectionId,
            VoiceConnectionCloseReason.DEDICATED_DISCONNECTED,
            effectiveAtMs
        );

        const reboundResult =
            this.baseRegistrationService.registerAndActivate(input);

        console.log(
            "VOICE_WEBGL_DEDICATED_IDENTITY_HANDOFF=" +
            (reboundResult?.success === true ? "PASS" : "FAIL") +
            " | previousConnectionId=" + retainedConnectionId +
            " | previousConnectionState=" + previousConnectionState +
            " | currentConnectionId=" + currentDedicatedConnectionId +
            " | windowsPathChanged=false" +
            " | questPathChanged=false"
        );

        return Object.freeze({
            ...reboundResult,
            webglDedicatedIdentityHandoff:
                reboundResult?.success === true,
            previousVoiceConnectionId:
                retainedConnectionId,
            currentVoiceConnectionId:
                currentDedicatedConnectionId
        });
    }
}

export {
    VoiceWebGLRoomReconnectRegistrationAdapter
};

/*
توضیح فایل:
این فایل فقط برای وب جی ال، پس از ریکانکت عمومی و تغییر شناسه قطعی ددیکیتد، اتصال صوتی معلق قبلی را از مسیر رسمی پاک‌سازی می‌کند و احراز تازه را با شناسه ددیکیتد جاری تکرار می‌کند. ریکانکت صرفا صوتی با شناسه ثابت و مسیرهای ویندوز و کوئست بدون تغییر باقی می‌مانند.
*/
