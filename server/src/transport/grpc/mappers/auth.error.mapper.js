// src/transport/grpc/mappers/auth.error.mapper.js
// src/transport/grpc/mappers/auth.error.mapper.js

import grpc from "@grpc/grpc-js";
import { AuthError } from "../../../domain/auth/authErrors.js";
import logger from "../../../utils/logger.js";

/**
 * mapCodeToGrpcStatus
 * Maps domain auth codes to gRPC status codes
 */
function mapCodeToGrpcStatus(code) {
    switch (code) {
        case "INVALID_ARGUMENT":
            return grpc.status.INVALID_ARGUMENT;

        case "ALREADY_EXISTS":
            return grpc.status.ALREADY_EXISTS;

        case "UNAUTHENTICATED":
            return grpc.status.UNAUTHENTICATED;

        case "PERMISSION_DENIED":
            return grpc.status.PERMISSION_DENIED;

        case "NOT_FOUND":
            return grpc.status.NOT_FOUND;

        case "INTERNAL":
        default:
            return grpc.status.INTERNAL;
    }
}

/**
 * mapKnownNonDomainError
 * Maps known non-domain errors (JWT / legacy errors) to gRPC shape
 */
function mapKnownNonDomainError(error) {
    const name = error?.name || "";
    const message = error?.message || "";
    const rawCode = error?.code || "";

    if (
        name === "TokenExpiredError" ||
        name === "JsonWebTokenError" ||
        name === "NotBeforeError" ||
        rawCode === "UNAUTHORIZED" ||
        rawCode === "TOKEN_EXPIRED" ||
        rawCode === "TOKEN_REVOKED" ||
        message === "UNAUTHORIZED" ||
        message === "TOKEN_EXPIRED" ||
        message === "TOKEN_REVOKED"
    ) {
        return {
            code: grpc.status.UNAUTHENTICATED,
            message: "Authentication failed"
        };
    }

    if (
        rawCode === "ACCESS_DENIED" ||
        message === "ACCESS_DENIED"
    ) {
        return {
            code: grpc.status.PERMISSION_DENIED,
            message: "Access denied"
        };
    }

    if (
        rawCode === "VALIDATION_ERROR" ||
        message === "VALIDATION_ERROR"
    ) {
        return {
            code: grpc.status.INVALID_ARGUMENT,
            message: "Invalid request"
        };
    }

    if (
        rawCode === "USERNAME_ALREADY_EXISTS" ||
        message === "USERNAME_ALREADY_EXISTS" ||
        message.toLowerCase() === "username already exists" ||
        message.toLowerCase() === "username already exists"
    ) {
        return {
            code: grpc.status.ALREADY_EXISTS,
            message: "USERNAME_ALREADY_EXISTS"
        };
    }

    if (
        rawCode === "EMAIL_ALREADY_EXISTS" ||
        message === "EMAIL_ALREADY_EXISTS" ||
        message.toLowerCase() === "user already exists" ||
        message.toLowerCase() === "email already exists"
    ) {
        return {
            code: grpc.status.ALREADY_EXISTS,
            message: "EMAIL_ALREADY_EXISTS"
        };
    }

    if (
        rawCode === 11000 ||
        rawCode === "11000" ||
        error?.codeName === "DuplicateKey"
    ) {
        const keyPattern = error?.keyPattern ?? {};
        const keyValue = error?.keyValue ?? {};
        const keys = new Set([...Object.keys(keyPattern), ...Object.keys(keyValue)]);

        return {
            code: grpc.status.ALREADY_EXISTS,
            message: keys.has("userNameKey") || keys.has("userName") ? "USERNAME_ALREADY_EXISTS" : "EMAIL_ALREADY_EXISTS"
        };
    }

    if (
        rawCode === "INVALID_CREDENTIALS" ||
        message === "INVALID_CREDENTIALS"
    ) {
        return {
            code: grpc.status.UNAUTHENTICATED,
            message: "Invalid credentials"
        };
    }

    return null;
}

/**
 * mapAuthError
 * تبدیل Domain Error به gRPC Status + لاگ داخلی
 */
export function mapAuthError(error) {
    console.error("[AuthError]", error);

    logger.error("Auth error occurred", {
        layer: "transport.grpc",
        mapper: "auth.error",
        errorName: error?.name || "",
        errorCode: error?.code || "",
        errorMessage: error?.message || "",
        stack: error?.stack || ""
    });

    if (!error) {
        return {
            code: grpc.status.INTERNAL,
            message: "Internal server error"
        };
    }

    if (error instanceof AuthError) {
        return {
            code: mapCodeToGrpcStatus(error.code),
            message: error.message || "Authentication error"
        };
    }

    const knownMapped = mapKnownNonDomainError(error);
    if (knownMapped) {
        return knownMapped;
    }

    return {
        code: grpc.status.INTERNAL,
        message: "Internal server error"
    };
}

/**
 * mapErrorToGrpc
 * Backward-compatible alias
 */
export const mapErrorToGrpc = mapAuthError;

/* 
فایل src / transport / grpc / mappers / auth.error.mapper.js
مسئول تبدیل خطاهای داخلی Auth به خطاهای استاندارد gRPC است.

وقتی در Register، Login، Refresh، GetUserData یا Logout خطایی رخ دهد،
handler یا intercep
mapAuthError می‌دهد.

این فایل خطاهای AuthError را بر اساس code داخلی،
به status code مناسب gRPC مثل INVALID_ARGUMENT،
ALREADY_EXISTS، UNAUTHENTICATED یا NOT_FOUND تبدیل می‌کند.

همچنین خطاهای شناخته‌شده بیرونی مثل TokenExpiredError
یا JsonWebTokenError را هم به خطای مناسب gRPC تبدیل می‌کند.

اگر خطا ناشناخته باشد، پاسخ نهایی به صورت INTERNAL
و با پیام کنترل‌شده Internal server error برگردانده می‌شود.
 */
