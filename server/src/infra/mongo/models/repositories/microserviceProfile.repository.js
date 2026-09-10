// File => src/infra/mongo/models/repositories/microserviceProfile.repository.js

import { MicroserviceProfileModel } from "../microserviceProfile.model.js";

function normalizeText(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function unwrapMeData(payload) {
    if (payload?.data && typeof payload.data === "object") return payload.data;
    return payload;
}

function normalizeProfilePayload(payload) {
    const data = unwrapMeData(payload);

    if (!data || typeof data !== "object") {
        return {
            microserviceId: "",
            name: "",
            code: "",
            avatar: "",
            rawData: payload ?? {}
        };
    }

    return {
        microserviceId: normalizeText(data.id ?? data.user_id ?? data.userId),
        name: normalizeText(data.name ?? data.full_name ?? data.fullName),
        code: normalizeText(data.code),
        avatar: normalizeText(data.avatar),
        rawData: data
    };
}

function mapDocument(doc) {
    if (!doc) return null;

    return {
        userId: doc.userId ?? "",
        microserviceUserName: doc.microserviceUserName ?? "",
        microserviceId: doc.microserviceId ?? "",
        name: doc.name ?? "",
        code: doc.code ?? "",
        avatar: doc.avatar ?? "",
        rawData: doc.rawData ?? {},
        lastSyncAt: doc.lastSyncAt ?? null,
        createdAt: doc.createdAt ?? null,
        updatedAt: doc.updatedAt ?? null
    };
}

export class MicroserviceProfileRepository {
    async upsertFromMePayload({ userId, microserviceUserName, mePayload }) {
        const normalizedUserId = normalizeText(userId);
        const normalizedMicroserviceUserName = normalizeText(microserviceUserName);

        if (!normalizedUserId) throw new Error("MicroserviceProfileRepository: userId is required");
        if (!normalizedMicroserviceUserName) throw new Error("MicroserviceProfileRepository: microserviceUserName is required");

        const now = new Date();
        const profile = normalizeProfilePayload(mePayload);

        await MicroserviceProfileModel.updateOne(
            { userId: normalizedUserId },
            {
                $set: {
                    userId: normalizedUserId,
                    microserviceUserName: normalizedMicroserviceUserName,
                    microserviceId: profile.microserviceId,
                    name: profile.name,
                    code: profile.code,
                    avatar: profile.avatar,
                    rawData: profile.rawData,
                    lastSyncAt: now,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true }
        );

        return this.findByUserId(normalizedUserId);
    }

    async findByUserId(userId) {
        const normalizedUserId = normalizeText(userId);

        if (!normalizedUserId) return null;

        const doc = await MicroserviceProfileModel.findOne({
            userId: normalizedUserId
        }).lean();

        return mapDocument(doc);
    }

    async clearByUserId(userId) {
        const normalizedUserId = normalizeText(userId);

        if (!normalizedUserId) {
            return {
                acknowledged: false,
                deletedCount: 0
            };
        }

        const result = await MicroserviceProfileModel.deleteOne({
            userId: normalizedUserId
        });

        return {
            acknowledged: result.acknowledged ?? true,
            deletedCount: result.deletedCount ?? 0
        };
    }
}
