// File => src/integrations/microservice/microserviceApi.client.js

import microserviceConfig from "./microservice.config.js";

export class MicroserviceApiError extends Error {
    constructor({ code, message, statusCode = 0, raw = null }) {
        super(message || "Microservice API request failed");
        this.name = "MicroserviceApiError";
        this.code = code || "MICROSERVICE_API_ERROR";
        this.statusCode = statusCode;
        this.raw = raw;
    }
}

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function createTimeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    return {
        signal: controller.signal,
        cancel: () => clearTimeout(timer)
    };
}

function createMeBody() {
    if (microserviceConfig.meMethod === "GET") {
        return {
            body: undefined,
            extraHeaders: {}
        };
    }

    if (microserviceConfig.meBodyMode === "json") {
        return {
            body: JSON.stringify({}),
            extraHeaders: {
                "Content-Type": "application/json"
            }
        };
    }

    if (microserviceConfig.meBodyMode === "urlencoded") {
        return {
            body: new URLSearchParams(),
            extraHeaders: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        };
    }

    return {
        body: undefined,
        extraHeaders: {}
    };
}

async function readResponseBody(response) {
    const text = await response.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function mapApiError(payload, statusCode) {
    const message =
        normalizeText(payload?.message) ||
        normalizeText(payload?.error_description) ||
        normalizeText(payload?.error) ||
        `Microservice API request failed with status ${statusCode}`;

    if (statusCode === 401) {
        return new MicroserviceApiError({
            code: "MICROSERVICE_API_UNAUTHORIZED",
            message,
            statusCode,
            raw: payload
        });
    }

    if (statusCode === 403) {
        return new MicroserviceApiError({
            code: "MICROSERVICE_API_FORBIDDEN",
            message,
            statusCode,
            raw: payload
        });
    }

    return new MicroserviceApiError({
        code: "MICROSERVICE_API_REQUEST_FAILED",
        message,
        statusCode,
        raw: payload
    });
}

function createCompletedBuildFeaturesUrl(page) {
    const normalizedPage = Number(page);

    if (!Number.isInteger(normalizedPage) || normalizedPage <= 0) {
        throw new MicroserviceApiError({
            code: "MICROSERVICE_API_PAGE_INVALID",
            message: "page must be a positive integer"
        });
    }

    let requestUrl;

    try {
        requestUrl = new URL(microserviceConfig.completedBuildFeaturesUrl);
    } catch {
        throw new MicroserviceApiError({
            code: "MICROSERVICE_API_URL_INVALID",
            message: "MICROSERVICE_COMPLETED_BUILD_FEATURES_URL is invalid"
        });
    }

    requestUrl.searchParams.set("page", String(normalizedPage));
    return requestUrl;
}

export async function getMicroserviceMe({ accessToken, tokenType = "Bearer" }) {
    const normalizedAccessToken = normalizeText(accessToken);
    const normalizedTokenType = normalizeText(tokenType) || "Bearer";

    if (!normalizedAccessToken) {
        throw new MicroserviceApiError({
            code: "MICROSERVICE_API_ACCESS_TOKEN_REQUIRED",
            message: "accessToken is required"
        });
    }

    const timeout = createTimeoutSignal(microserviceConfig.timeoutMs);
    const { body, extraHeaders } = createMeBody();

    try {
        const response = await fetch(microserviceConfig.meUrl, {
            method: microserviceConfig.meMethod,
            headers: {
                "Accept": "application/json",
                "Authorization": `${normalizedTokenType} ${normalizedAccessToken}`,
                ...extraHeaders
            },
            body,
            signal: timeout.signal
        });

        const payload = await readResponseBody(response);

        if (!response.ok) throw mapApiError(payload, response.status);

        return {
            success: true,
            statusCode: response.status,
            data: payload
        };
    } catch (error) {
        if (error instanceof MicroserviceApiError) throw error;

        if (error?.name === "AbortError") {
            throw new MicroserviceApiError({
                code: "MICROSERVICE_API_TIMEOUT",
                message: "Microservice API request timeout"
            });
        }

        const causeCode = error?.cause?.code || "";
        const causeMessage = error?.cause?.message || "";
        const fullMessage = [error?.message, causeCode, causeMessage].filter(Boolean).join(" | ");

        throw new MicroserviceApiError({
            code: "MICROSERVICE_API_NETWORK_ERROR",
            message: fullMessage || "Microservice API network error"
        });
    } finally {
        timeout.cancel();
    }
}

export async function getMicroserviceCompletedBuildFeatures({
    accessToken,
    tokenType = "Bearer",
    page = 1
}) {
    const normalizedAccessToken = normalizeText(accessToken);
    const normalizedTokenType = normalizeText(tokenType) || "Bearer";

    if (!normalizedAccessToken) {
        throw new MicroserviceApiError({
            code: "MICROSERVICE_API_ACCESS_TOKEN_REQUIRED",
            message: "accessToken is required"
        });
    }

    const requestUrl = createCompletedBuildFeaturesUrl(page);
    const timeout = createTimeoutSignal(microserviceConfig.timeoutMs);

    try {
        const response = await fetch(requestUrl, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Authorization": `${normalizedTokenType} ${normalizedAccessToken}`
            },
            signal: timeout.signal
        });

        const payload = await readResponseBody(response);

        if (!response.ok) throw mapApiError(payload, response.status);

        return {
            success: true,
            statusCode: response.status,
            data: payload
        };
    } catch (error) {
        if (error instanceof MicroserviceApiError) throw error;

        if (error?.name === "AbortError") {
            throw new MicroserviceApiError({
                code: "MICROSERVICE_API_TIMEOUT",
                message: "Microservice API request timeout"
            });
        }

        const causeCode = error?.cause?.code || "";
        const causeMessage = error?.cause?.message || "";
        const fullMessage = [error?.message, causeCode, causeMessage].filter(Boolean).join(" | ");

        throw new MicroserviceApiError({
            code: "MICROSERVICE_API_NETWORK_ERROR",
            message: fullMessage || "Microservice API network error"
        });
    } finally {
        timeout.cancel();
    }
}
