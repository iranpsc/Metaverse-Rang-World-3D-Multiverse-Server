// File => src/infra/mongo/models/repositories/microserviceToken.repository.js

import { MicroserviceTokenModel } from "../microserviceToken.model.js";
import { encryptText, decryptText } from "../../../../integrations/microservice/microserviceToken.crypto.js";

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function calculateExpiresAt(expiresIn) {
    const seconds = Number(expiresIn || 0);

    if (!Number.isFinite(seconds) || seconds <= 0) {
        return new Date(Date.now() + 3600 * 1000);
    }

    return new Date(Date.now() + seconds * 1000);
}

function isExpired(expiresAt, skewSeconds = 60) {
    if (!expiresAt) return true;

    const expiresMs = new Date(expiresAt).getTime();
    const nowMs = Date.now();
    const skewMs = Number(skewSeconds || 0) * 1000;

    return Number.isNaN(expiresMs) || expiresMs <= nowMs + skewMs;
}

function mapDocument(doc, { includeTokens = false } = {}) {
    if (!doc) return null;

    const accessTokenEncrypted = doc.accessTokenEncrypted ?? "";
    const refreshTokenEncrypted = doc.refreshTokenEncrypted ?? "";

    const result = {
        userId: doc.userId ?? "",
        microserviceUserName: doc.microserviceUserName ?? "",
        tokenType: doc.tokenType ?? "Bearer",
        scope: doc.scope ?? "*",
        expiresAt: doc.expiresAt ?? null,
        lastLoginAt: doc.lastLoginAt ?? null,
        lastRefreshAt: doc.lastRefreshAt ?? null,
        lastTokenUpdateAt: doc.lastTokenUpdateAt ?? null,
        createdAt: doc.createdAt ?? null,
        updatedAt: doc.updatedAt ?? null,
        isExpired: isExpired(doc.expiresAt)
    };

    if (includeTokens) {
        result.accessToken = accessTokenEncrypted ? decryptText(accessTokenEncrypted) : "";
        result.refreshToken = refreshTokenEncrypted ? decryptText(refreshTokenEncrypted) : "";
    }

    return result;
}

export class MicroserviceTokenRepository {
    async upsertTokenSet({ userId, microserviceUserName, tokenSet, source = "login" }) {
        const normalizedUserId = normalizeText(userId);
        const normalizedMicroserviceUserName = normalizeText(microserviceUserName);

        if (!normalizedUserId) throw new Error("MicroserviceTokenRepository: userId is required");
        if (!normalizedMicroserviceUserName) throw new Error("MicroserviceTokenRepository: microserviceUserName is required");
        if (!tokenSet?.accessToken) throw new Error("MicroserviceTokenRepository: accessToken is required");

        const now = new Date();

        const setData = {
            userId: normalizedUserId,
            microserviceUserName: normalizedMicroserviceUserName,
            tokenType: normalizeText(tokenSet.tokenType) || "Bearer",
            accessTokenEncrypted: encryptText(tokenSet.accessToken),
            scope: normalizeText(tokenSet.scope) || "*",
            expiresAt: calculateExpiresAt(tokenSet.expiresIn),
            lastTokenUpdateAt: now,
            updatedAt: now
        };

        if (tokenSet.refreshToken) {
            setData.refreshTokenEncrypted = encryptText(tokenSet.refreshToken);
        }

        if (source === "refresh") {
            setData.lastRefreshAt = now;
        } else {
            setData.lastLoginAt = now;
        }

        await MicroserviceTokenModel.updateOne(
            { userId: normalizedUserId },
            {
                $set: setData,
                $setOnInsert: { createdAt: now }
            },
            { upsert: true }
        );

        return this.findByUserId(normalizedUserId);
    }

    async findByUserId(userId, options = {}) {
        const normalizedUserId = normalizeText(userId);

        if (!normalizedUserId) return null;

        const doc = await MicroserviceTokenModel.findOne({
            userId: normalizedUserId
        }).lean();

        return mapDocument(doc, options);
    }

    async getValidAccessToken(userId, skewSeconds = 60) {
        const record = await this.findByUserId(userId, { includeTokens: true });

        if (!record) {
            return {
                ok: false,
                reason: "not_found",
                accessToken: "",
                record: null
            };
        }

        if (isExpired(record.expiresAt, skewSeconds)) {
            return {
                ok: false,
                reason: "expired",
                accessToken: "",
                record
            };
        }

        return {
            ok: true,
            reason: "ok",
            accessToken: record.accessToken,
            tokenType: record.tokenType,
            record
        };
    }

    async clearByUserId(userId) {
        const normalizedUserId = normalizeText(userId);

        if (!normalizedUserId) {
            return {
                acknowledged: false,
                deletedCount: 0
            };
        }

        const result = await MicroserviceTokenModel.deleteOne({
            userId: normalizedUserId
        });

        return {
            acknowledged: result.acknowledged ?? true,
            deletedCount: result.deletedCount ?? 0
        };
    }
}
