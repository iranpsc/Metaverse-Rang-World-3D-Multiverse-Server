// مسیر فایل: src/voice/bootstrap/sharedVoiceAccessTokenVerifier.js

import {
    tokenService
} from "../../core/auth/auth.instance.js";

import {
    VoiceAccessTokenVerifierAdapter
} from "../adapters/voiceAccessTokenVerifierAdapter.js";

const sharedVoiceAccessTokenVerifier =
    new VoiceAccessTokenVerifierAdapter({
        tokenService
    });

export {
    sharedVoiceAccessTokenVerifier
};

/*
توضیح فایل:
این فایل همان نمونه سرویس توکن فعلی پروژه را به سازگارکننده ارتباط صوتی متصل می‌کند تا احراز توکن صوتی از کلیدها و تنظیمات اصلی پروژه استفاده کند.
*/
