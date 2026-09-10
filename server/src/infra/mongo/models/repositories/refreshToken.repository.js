// File => src/infra/mongo/models/repositories/refreshToken.repository.js
// src/infra/mongo/models/repositories/refreshToken.repository.js

import { RefreshTokenModel } from "../../models/refreshToken.model.js";

/**
 * mapRefreshTokenRecord
 * Maps mongo refresh token document/lean object to stable repository output
 */
function mapRefreshTokenRecord(doc) {
    if (!doc) {
        return null;
    }

    return {
        tokenId: doc.tokenId ?? "",
        userId: doc.userId ?? "",
        refreshHash: doc.refreshHash ?? "",
        userAgent: doc.userAgent ?? "",
        ip: doc.ip ?? "",
        isRevoked: Boolean(doc.isRevoked),
        createdAt: doc.createdAt ?? null,
        expiresAt: doc.expiresAt ?? null
    };
}

/**
 * mapUpdateResult
 * Maps mongoose update result to stable repository output
 */
function mapUpdateResult(result) {
    if (!result) {
        return {
            acknowledged: false,
            matchedCount: 0,
            modifiedCount: 0
        };
    }

    return {
        acknowledged: result.acknowledged ?? true,
        matchedCount: result.matchedCount ?? 0,
        modifiedCount: result.modifiedCount ?? 0
    };
}

/**
 * Repository for RefreshToken persistence
 */
export class RefreshTokenRepository {
    /**
     * Store new refresh token
     */
    async create({
        tokenId,
        userId,
        refreshHash,
        expiresAt,
        userAgent,
        ip
    }) {
        const created = await RefreshTokenModel.create({
            tokenId,
            userId,
            refreshHash,
            expiresAt,
            userAgent: userAgent ?? "",
            ip: ip ?? ""
        });

        return mapRefreshTokenRecord(
            created?.toObject ? created.toObject() : created
        );
    }

    /**
     * Find token by tokenId
     */
    async findByTokenId(tokenId) {
        const doc = await RefreshTokenModel.findOne({ tokenId }).lean();
        return mapRefreshTokenRecord(doc);
    }

    /**
     * Revoke token
     */
    async revoke(tokenId) {
        const result = await RefreshTokenModel.updateOne(
            { tokenId },
            { $set: { isRevoked: true } }
        );

        return mapUpdateResult(result);
    }

    /**
     * Revoke all tokens of a user
     */
    async revokeAllForUser(userId) {
        const result = await RefreshTokenModel.updateMany(
            { userId },
            { $set: { isRevoked: true } }
        );

        return mapUpdateResult(result);
    }
}

/* فایل refreshToken.repository.js برای مدیریت ذخیره‌سازی refresh tokenها در دیتابیس است.

این فایل کارهای زیر را انجام می‌دهد:

ذخیره refresh token جدید
پیدا کردن refresh token با tokenId
revoke کردن یک refresh token
revoke کردن همه refresh tokenهای یک کاربر
تبدیل خروجی MongoDB به object استاندارد برای لایه TokenService

خود این فایل JWT نمی‌سازد و token را verify نمی‌کند.
ساخت و verify در token.service.js انجام می‌شود.
این فایل فقط با دیتابیس کار می‌کند.

 */
/* 
فایل src / infra / mongo / models / repositories / refreshToken.repository.js مسئول عملیات دیتابیس مربوط به refresh tokenهاست.این فایل با استفاده از RefreshTokenModel رکوردهای refresh token را در MongoDB ذخیره، جستجو و revoke می‌کند و خروجی‌های MongoDB را به ساختارهای ثابت و قابل استفاده برای TokenService تبدیل می‌کند.

در مسیر Register، بعد از ساخت refresh token در tokenService.createRefreshToken، خود refresh token خام به کلاینت برگردانده می‌شود، اما hash آن همراه با tokenId، userId، زمان انقضا، userAgent و IP از طریق تابع create در دیتابیس ذخیره می‌شود.در مسیر Refresh، تابع findByTokenId برای پیدا کردن رکورد token قدیمی و تابع revoke برای باطل کردن آن استفاده می‌شود.در مسیر Logout نیز تابع revokeAllForUser همه refresh tokenهای کاربر را باطل می‌کند. */