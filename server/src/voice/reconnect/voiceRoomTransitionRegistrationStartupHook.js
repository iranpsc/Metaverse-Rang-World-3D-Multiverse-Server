import {
    VoiceAuthoritativeConnectionRegistrationAdapter
} from "../adapters/voiceAuthoritativeConnectionRegistrationAdapter.js";

import {
    VoiceRoomTransitionRegistrationAdapter
} from "./voiceRoomTransitionRegistrationAdapter.js";

const installationKey = Symbol.for(
    "network_a.voice.room_transition_registration_hook"
);

if (globalThis[installationKey] !== true) {
    const originalRegisterAndActivate =
        VoiceAuthoritativeConnectionRegistrationAdapter.prototype.registerAndActivate;

    const adapters = new WeakMap();

    VoiceAuthoritativeConnectionRegistrationAdapter.prototype.registerAndActivate =
        function registerAndActivateWithRoomTransitionHandoff(input = {}) {
            let adapter = adapters.get(this);

            if (!adapter) {
                adapter = new VoiceRoomTransitionRegistrationAdapter({
                    baseRegistrationService: {
                        registerAndActivate: (request) =>
                            originalRegisterAndActivate.call(this, request)
                    },
                    voiceConnectionRegistry:
                        this.voiceConnectionRegistry,
                    reconnectCoordinator:
                        this.reconnectCoordinator,
                    now:
                        this.now
                });

                adapters.set(this, adapter);
            }

            return adapter.registerAndActivate(input);
        };

    globalThis[installationKey] = true;

    console.log(
        "VOICE_ROOM_TRANSITION_REGISTRATION_HOOK=READY" +
        " | platforms=all" +
        " | existingReconnectPolicyChanged=false" +
        " | coreFilesChanged=false"
    );
}
