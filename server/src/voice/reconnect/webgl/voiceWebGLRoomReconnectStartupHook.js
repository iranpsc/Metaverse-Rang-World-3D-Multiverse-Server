// مسیر فایل: src/voice/reconnect/webgl/voiceWebGLRoomReconnectStartupHook.js

import {
    VoiceClientPlatform
} from "../../auth/voiceAuthConstants.js";

import {
    VoiceAuthoritativeConnectionRegistrationAdapter
} from "../../adapters/voiceAuthoritativeConnectionRegistrationAdapter.js";

import {
    VoiceWebGLRoomReconnectRegistrationAdapter
} from "./voiceWebGLRoomReconnectRegistrationAdapter.js";

const enabled = ["1", "true", "yes", "on"].includes(
    String(
        process.env.VOICE_WEBGL_ROOM_RECONNECT_RESUME_ENABLED ?? ""
    ).trim().toLowerCase()
);

const installationKey = Symbol.for(
    "network_a.voice.webgl.room_reconnect_registration_hook"
);

if (enabled && globalThis[installationKey] !== true) {
    const originalRegisterAndActivate =
        VoiceAuthoritativeConnectionRegistrationAdapter.prototype.registerAndActivate;

    const adapters = new WeakMap();

    VoiceAuthoritativeConnectionRegistrationAdapter.prototype.registerAndActivate =
        function registerAndActivateWithWebGLDedicatedIdentityHandoff(input = {}) {
            if (input.platform !== VoiceClientPlatform.WEBGL) {
                return originalRegisterAndActivate.call(this, input);
            }

            let adapter = adapters.get(this);

            if (!adapter) {
                adapter = new VoiceWebGLRoomReconnectRegistrationAdapter({
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
        "VOICE_WEBGL_ROOM_RECONNECT_REGISTRATION_HOOK=READY | mode=dedicated_identity_handoff | windowsPathChanged=false | questPathChanged=false"
    );
}

/*
توضیح فایل:
این راه‌انداز بدون تغییر فایل‌های مشترک، پوشاننده انتقال هویت صوتی وب جی ال پس از تغییر اتصال ددیکیتد را روی آداپتر قطعی ثبت نصب می‌کند و درخواست‌های ویندوز و کوئست را مستقیما به رفتار اصلی می‌سپارد.
*/
