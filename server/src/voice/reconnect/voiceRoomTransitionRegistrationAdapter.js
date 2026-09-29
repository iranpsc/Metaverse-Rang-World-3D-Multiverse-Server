import {
    VoiceConnectionCloseReason
} from "../core/voiceConnectionConstants.js";

class VoiceRoomTransitionRegistrationAdapter {
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
            typeof voiceConnectionRegistry.getByUserAndAvatar !== "function" ||
            !reconnectCoordinator ||
            typeof reconnectCoordinator.closeConnectionImmediately !== "function" ||
            typeof now !== "function"
        ) {
            throw new TypeError(
                "Voice room transition registration adapter dependencies are incomplete."
            );
        }

        this.baseRegistrationService = baseRegistrationService;
        this.voiceConnectionRegistry = voiceConnectionRegistry;
        this.reconnectCoordinator = reconnectCoordinator;
        this.now = now;
        Object.seal(this);
    }

    registerAndActivate(input = {}) {
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
            this.voiceConnectionRegistry.getByUserAndAvatar(
                registrationInput.userId,
                registrationInput.avatarId
            );

        if (!retainedConnection) {
            return firstResult;
        }

        const sameUserAvatar =
            retainedConnection.userId === registrationInput.userId &&
            retainedConnection.avatarId === registrationInput.avatarId;

        const roomChanged =
            retainedConnection.roomId !== registrationInput.roomId;

        const dedicatedIdentityChanged =
            retainedConnection.connectionId !== registrationInput.connectionId;

        if (
            !sameUserAvatar ||
            !roomChanged ||
            !dedicatedIdentityChanged
        ) {
            return firstResult;
        }

        const previousConnectionId =
            String(retainedConnection.connectionId ?? "")
                .trim()
                .toLowerCase();

        const previousRoomId =
            String(retainedConnection.roomId ?? "").trim();

        const currentConnectionId =
            String(registrationInput.connectionId ?? "")
                .trim()
                .toLowerCase();

        const currentRoomId =
            String(registrationInput.roomId ?? "").trim();

        const effectiveAtMs =
            Number.isSafeInteger(input.activatedAtMs) &&
            input.activatedAtMs >= 0
                ? input.activatedAtMs
                : this.now();

        this.reconnectCoordinator.closeConnectionImmediately(
            previousConnectionId,
            VoiceConnectionCloseReason.ROOM_LEFT,
            effectiveAtMs
        );

        const retryResult =
            this.baseRegistrationService.registerAndActivate(input);

        console.log(
            "VOICE_ROOM_TRANSITION_REGISTRATION_HANDOFF=" +
            (retryResult?.success === true ? "PASS" : "FAIL") +
            " | platform=" + String(registrationInput.platform ?? "") +
            " | previousConnectionId=" + previousConnectionId +
            " | currentConnectionId=" + currentConnectionId +
            " | previousRoomId=" + previousRoomId +
            " | currentRoomId=" + currentRoomId +
            " | staleRetentionBypassed=true"
        );

        return Object.freeze({
            ...retryResult,
            roomTransitionRegistrationHandoff:
                retryResult?.success === true,
            previousVoiceConnectionId:
                previousConnectionId,
            currentVoiceConnectionId:
                currentConnectionId,
            previousVoiceRoomId:
                previousRoomId,
            currentVoiceRoomId:
                currentRoomId
        });
    }
}

export {
    VoiceRoomTransitionRegistrationAdapter
};
