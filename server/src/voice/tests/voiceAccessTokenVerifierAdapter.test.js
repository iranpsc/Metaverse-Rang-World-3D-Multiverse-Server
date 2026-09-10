// مسیر فایل: src/voice/tests/voiceAccessTokenVerifierAdapter.test.js

import assert from "node:assert/strict";

import {
    tokenService
} from "../../core/auth/auth.instance.js";

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

import {
    VoiceAccessTokenVerifierAdapter
} from "../adapters/voiceAccessTokenVerifierAdapter.js";

import {
    sharedVoiceAccessTokenVerifier
} from "../bootstrap/sharedVoiceAccessTokenVerifier.js";

const verifiedUserId =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

class FakeTokenService {
    //* این سازنده نوع نتیجه آزمایشی بررسی توکن را نگهداری می‌کند.
    constructor(resultMode) {
        this.resultMode = resultMode;
        this.receivedAccessToken = "";
    }

    //* این تابع رفتارهای معتبر، منقضی، نامعتبر و بدون شناسه کاربر را برای آزمون شبیه‌سازی می‌کند.
    verifyAccessToken(accessToken) {
        this.receivedAccessToken =
            accessToken;

        if (
            this.resultMode ===
            "valid"
        ) {
            return {
                sub: verifiedUserId,
                email:
                    "voice-test@example.test",
                userName:
                    "voice-test"
            };
        }

        if (
            this.resultMode ===
            "missing_user"
        ) {
            return {
                email:
                    "voice-test@example.test"
            };
        }

        if (
            this.resultMode ===
            "expired"
        ) {
            const error =
                new Error("jwt expired");

            error.name =
                "TokenExpiredError";

            throw error;
        }

        const error =
            new Error("invalid signature");

        error.name =
            "JsonWebTokenError";

        throw error;
    }
}

const validTokenService =
    new FakeTokenService("valid");

const validAdapter =
    new VoiceAccessTokenVerifierAdapter({
        tokenService: validTokenService
    });

const validResult =
    validAdapter.verify(
        "  valid.access.token  "
    );

assert.equal(
    validTokenService.receivedAccessToken,
    "valid.access.token"
);

assert.equal(
    validResult.success,
    true
);

assert.equal(
    validResult.retryable,
    false
);

assert.equal(
    validResult.code,
    VoiceAuthResultCode.AUTHENTICATED
);

assert.equal(
    validResult.userId,
    verifiedUserId
);

assert.equal(
    validResult.tokenPayload.sub,
    verifiedUserId
);

assert.equal(
    Object.isFrozen(validResult),
    true
);

assert.equal(
    Object.isFrozen(
        validResult.tokenPayload
    ),
    true
);

const missingTokenResult =
    validAdapter.verify("");

assert.equal(
    missingTokenResult.success,
    false
);

assert.equal(
    missingTokenResult.code,
    VoiceAuthResultCode
        .ACCESS_TOKEN_MISSING
);

assert.equal(
    missingTokenResult.retryable,
    false
);

const expiredAdapter =
    new VoiceAccessTokenVerifierAdapter({
        tokenService:
            new FakeTokenService("expired")
    });

const expiredResult =
    expiredAdapter.verify(
        "expired.access.token"
    );

assert.equal(
    expiredResult.success,
    false
);

assert.equal(
    expiredResult.code,
    VoiceAuthResultCode
        .ACCESS_TOKEN_EXPIRED
);

assert.equal(
    expiredResult.retryable,
    true
);

const invalidAdapter =
    new VoiceAccessTokenVerifierAdapter({
        tokenService:
            new FakeTokenService("invalid")
    });

const invalidResult =
    invalidAdapter.verify(
        "invalid.access.token"
    );

assert.equal(
    invalidResult.success,
    false
);

assert.equal(
    invalidResult.code,
    VoiceAuthResultCode
        .ACCESS_TOKEN_INVALID
);

assert.equal(
    invalidResult.retryable,
    false
);

const missingUserAdapter =
    new VoiceAccessTokenVerifierAdapter({
        tokenService:
            new FakeTokenService("missing_user")
    });

const missingUserResult =
    missingUserAdapter.verify(
        "token.without.user"
    );

assert.equal(
    missingUserResult.success,
    false
);

assert.equal(
    missingUserResult.code,
    VoiceAuthResultCode
        .USER_ID_MISSING
);

assert.equal(
    missingUserResult.userId,
    ""
);

let invalidServiceError = null;

try {
    new VoiceAccessTokenVerifierAdapter({
        tokenService: {}
    });
} catch (error) {
    invalidServiceError = error;
}

assert.match(
    invalidServiceError?.message ?? "",
    /must provide verifyAccessToken/
);

assert.equal(
    sharedVoiceAccessTokenVerifier
        .tokenService,
    tokenService
);

const currentServiceInvalidResult =
    sharedVoiceAccessTokenVerifier.verify(
        "not.a.valid.token"
    );

assert.equal(
    currentServiceInvalidResult.success,
    false
);

assert.equal(
    currentServiceInvalidResult.code,
    VoiceAuthResultCode
        .ACCESS_TOKEN_INVALID
);

console.log(
    "VOICE_V2_2_ACCESS_TOKEN_ADAPTER_TEST=OK"
);

/*
توضیح فایل:
این فایل اتصال سازگارکننده به سرویس توکن، استخراج شناسه کاربر، تشخیص توکن منقضی و نامعتبر و استفاده از نمونه واقعی سرویس توکن پروژه را بررسی می‌کند.
*/
