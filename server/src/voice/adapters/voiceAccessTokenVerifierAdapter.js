// مسیر فایل: src/voice/adapters/voiceAccessTokenVerifierAdapter.js

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

class VoiceAccessTokenVerifierAdapter {
    //* این سازنده نمونه سرویس توکن فعلی پروژه را دریافت و نگهداری می‌کند.
    constructor({
        tokenService
    } = {}) {
        if (
            !tokenService ||
            typeof tokenService.verifyAccessToken !== "function"
        ) {
            throw new TypeError(
                "tokenService must provide verifyAccessToken."
            );
        }

        this.tokenService = tokenService;

        Object.seal(this);
    }

    //* این تابع توکن دسترسی را با سرویس فعلی پروژه بررسی و نتیجه یکدست ارتباط صوتی را برمی‌گرداند.
    verify(accessToken) {
        const normalizedAccessToken =
            typeof accessToken === "string"
                ? accessToken.trim()
                : "";

        if (!normalizedAccessToken) {
            return Object.freeze({
                success: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .ACCESS_TOKEN_MISSING,
                userId: "",
                tokenPayload: null
            });
        }

        try {
            const verifiedPayload =
                this.tokenService.verifyAccessToken(
                    normalizedAccessToken
                );

            if (
                !verifiedPayload ||
                typeof verifiedPayload !== "object" ||
                Array.isArray(verifiedPayload)
            ) {
                return Object.freeze({
                    success: false,
                    retryable: false,
                    code:
                        VoiceAuthResultCode
                            .ACCESS_TOKEN_INVALID,
                    userId: "",
                    tokenPayload: null
                });
            }

            const userId =
                String(
                    verifiedPayload.sub ?? ""
                ).trim();

            if (!userId) {
                return Object.freeze({
                    success: false,
                    retryable: false,
                    code:
                        VoiceAuthResultCode
                            .USER_ID_MISSING,
                    userId: "",
                    tokenPayload:
                        Object.freeze({
                            ...verifiedPayload
                        })
                });
            }

            return Object.freeze({
                success: true,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .AUTHENTICATED,
                userId,
                tokenPayload:
                    Object.freeze({
                        ...verifiedPayload
                    })
            });
        } catch (error) {
            if (
                error?.name ===
                "TokenExpiredError"
            ) {
                return Object.freeze({
                    success: false,
                    retryable: true,
                    code:
                        VoiceAuthResultCode
                            .ACCESS_TOKEN_EXPIRED,
                    userId: "",
                    tokenPayload: null
                });
            }

            return Object.freeze({
                success: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .ACCESS_TOKEN_INVALID,
                userId: "",
                tokenPayload: null
            });
        }
    }
}

export {
    VoiceAccessTokenVerifierAdapter
};

/*
توضیح فایل:
این فایل توکن دسترسی دریافتی از اتصال صوتی را به سرویس توکن فعلی پروژه می‌فرستد، شناسه کاربر را از توکن تأییدشده استخراج می‌کند و نتیجه معتبر، منقضی، نامعتبر یا ناقص را به شکل یکدست برمی‌گرداند.
*/
