// File => src/integrations/microservice/microserviceToken.client.js

import microserviceConfig from "./microservice.config.js";

export class MicroserviceTokenError extends Error {
    constructor({ code, message, statusCode = 0, raw = null }) {
        super(message || "Microservice token request failed");
        this.name = "MicroserviceTokenError";
        this.code = code || "MICROSERVICE_TOKEN_ERROR";
        this.statusCode = statusCode;
        this.raw = raw;
    }
}

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizePassword(value) {
    return typeof value === "string" ? value : "";
}

function createTimeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
    const timer = setTimeout(() => controller.abort(), safeTimeoutMs);

    timer.unref?.();

    return {
        signal: controller.signal,
        cancel: () => clearTimeout(timer)
    };
}

/*
 * سرویس accounts.irpsc.com طبق تست Postman بدنه multipart/form-data می‌خواهد.
 * Content-Type عمداً دستی تنظیم نمی‌شود تا Boundary صحیح را خود FormData بسازد.
 */
function createTokenForm(fields) {
    const body = new FormData();

    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        body.append(key, String(value));
    }

    return {
        body,
        headers: {
            Accept: "application/json"
        }
    };
}

function redactSensitiveText(value) {
    let text = typeof value === "string" ? value : "";

    text = text
        .replace(/("access_token"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
        .replace(/("refresh_token"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
        .replace(/("client_secret"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
        .replace(/("password"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
        .replace(/(access_token=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/(refresh_token=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/(client_secret=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/(password=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");

    return text.length > 1000 ? text.slice(0, 1000) + "...[TRUNCATED]" : text;
}

function mapTokenResponse(payload) {
    const accessToken = normalizeText(payload?.access_token);
    const refreshToken = normalizeText(payload?.refresh_token);
    const tokenType = normalizeText(payload?.token_type) || "Bearer";
    const expiresIn = Number(payload?.expires_in ?? 0);

    if (!accessToken) {
        throw new MicroserviceTokenError({
            code: "MICROSERVICE_TOKEN_MISSING_ACCESS_TOKEN",
            message: "Microservice response does not contain access_token",
            raw: {
                tokenTypePresent: Boolean(tokenType),
                refreshTokenPresent: Boolean(refreshToken),
                expiresIn
            }
        });
    }

    return {
        tokenType,
        expiresIn,
        accessToken,
        refreshToken,
        scope: normalizeText(payload?.scope),
        raw: payload
    };
}

function mapTokenError(payload, statusCode) {
    const error = normalizeText(payload?.error);
    const description = normalizeText(payload?.error_description);
    const message =
        normalizeText(payload?.message) ||
        description ||
        "Microservice authentication failed";

    if (error === "invalid_grant") {
        return new MicroserviceTokenError({
            code: "MICROSERVICE_INVALID_GRANT",
            message,
            statusCode,
            raw: {
                error,
                errorDescription: description
            }
        });
    }

    return new MicroserviceTokenError({
        code: error || "MICROSERVICE_TOKEN_REQUEST_FAILED",
        message,
        statusCode,
        raw: {
            error,
            errorDescription: description
        }
    });
}

async function readJsonResponse(response) {
    const text = await response.text();
    const contentType = normalizeText(response.headers.get("content-type"));
    const safePreview = redactSensitiveText(text);

    if (!text) {
        return {
            payload: {},
            responseInfo: {
                status: response.status,
                statusText: response.statusText,
                contentType,
                url: response.url,
                preview: ""
            }
        };
    }

    try {
        return {
            payload: JSON.parse(text),
            responseInfo: {
                status: response.status,
                statusText: response.statusText,
                contentType,
                url: response.url,
                preview: ""
            }
        };
    } catch {
        console.error("[MicroserviceTokenClient] Non-JSON response received", {
            status: response.status,
            statusText: response.statusText,
            contentType,
            url: response.url,
            preview: safePreview
        });

        throw new MicroserviceTokenError({
            code: "MICROSERVICE_INVALID_JSON",
            message:
                "Microservice response is not valid JSON" +
                " | status=" + response.status +
                " | contentType=" + (contentType || "missing"),
            statusCode: response.status,
            raw: {
                status: response.status,
                statusText: response.statusText,
                contentType,
                url: response.url,
                preview: safePreview
            }
        });
    }
}

async function sendTokenRequest(fields) {
    const { body, headers } = createTokenForm(fields);
    const timeout = createTimeoutSignal(microserviceConfig.timeoutMs);
    const grantType = normalizeText(fields?.grant_type);

    try {
        console.log("[MicroserviceTokenClient] Token request started", {
            url: microserviceConfig.tokenUrl,
            method: "POST",
            bodyMode: "multipart/form-data",
            grantType,
            usernamePresent: Boolean(normalizeText(fields?.username)),
            refreshTokenPresent: Boolean(normalizeText(fields?.refresh_token)),
            clientIdPresent: Boolean(normalizeText(String(fields?.client_id ?? ""))),
            clientSecretPresent: Boolean(normalizeText(String(fields?.client_secret ?? "")))
        });

        const response = await fetch(microserviceConfig.tokenUrl, {
            method: "POST",
            headers,
            body,
            signal: timeout.signal,
            redirect: "follow"
        });

        const { payload, responseInfo } = await readJsonResponse(response);

        if (!response.ok || payload?.error) {
            console.error("[MicroserviceTokenClient] OAuth request rejected", {
                status: response.status,
                statusText: response.statusText,
                contentType: responseInfo.contentType,
                oauthError: normalizeText(payload?.error),
                oauthMessage:
                    normalizeText(payload?.message) ||
                    normalizeText(payload?.error_description)
            });

            throw mapTokenError(payload, response.status);
        }

        const mappedToken = mapTokenResponse(payload);

        console.log("[MicroserviceTokenClient] Token request succeeded", {
            status: response.status,
            contentType: responseInfo.contentType,
            grantType,
            tokenType: mappedToken.tokenType,
            expiresIn: mappedToken.expiresIn,
            accessTokenPresent: Boolean(mappedToken.accessToken),
            refreshTokenPresent: Boolean(mappedToken.refreshToken)
        });

        return mappedToken;
    } catch (error) {
        if (error instanceof MicroserviceTokenError) throw error;

        if (error?.name === "AbortError") {
            throw new MicroserviceTokenError({
                code: "MICROSERVICE_TIMEOUT",
                message: "Microservice token request timeout"
            });
        }

        const causeCode = normalizeText(error?.cause?.code);
        const causeMessage = normalizeText(error?.cause?.message);
        const fullMessage = [normalizeText(error?.message), causeCode, causeMessage]
            .filter(Boolean)
            .join(" | ");

        console.error("[MicroserviceTokenClient] Network error", {
            message: normalizeText(error?.message),
            causeCode,
            causeMessage,
            url: microserviceConfig.tokenUrl
        });

        throw new MicroserviceTokenError({
            code: "MICROSERVICE_NETWORK_ERROR",
            message: fullMessage || "Microservice network error"
        });
    } finally {
        timeout.cancel();
    }
}

export async function loginWithPassword({ username, password }) {
    const normalizedUsername = normalizeText(username);
    const normalizedPassword = normalizePassword(password);

    if (!normalizedUsername) {
        throw new MicroserviceTokenError({
            code: "MICROSERVICE_USERNAME_REQUIRED",
            message: "username is required"
        });
    }

    if (!normalizedPassword.trim()) {
        throw new MicroserviceTokenError({
            code: "MICROSERVICE_PASSWORD_REQUIRED",
            message: "password is required"
        });
    }

    return sendTokenRequest({
        username: normalizedUsername,
        password: normalizedPassword,
        grant_type: "password",
        client_id: microserviceConfig.clientId,
        client_secret: microserviceConfig.clientSecret,
        scope: microserviceConfig.scope
    });
}

export async function refreshAccessToken({ refreshToken }) {
    const normalizedRefreshToken = normalizeText(refreshToken);

    if (!normalizedRefreshToken) {
        throw new MicroserviceTokenError({
            code: "MICROSERVICE_REFRESH_TOKEN_REQUIRED",
            message: "refresh_token is required"
        });
    }

    return sendTokenRequest({
        refresh_token: normalizedRefreshToken,
        grant_type: "refresh_token",
        client_id: microserviceConfig.clientId,
        client_secret: microserviceConfig.clientSecret,
        scope: microserviceConfig.scope
    });
}
