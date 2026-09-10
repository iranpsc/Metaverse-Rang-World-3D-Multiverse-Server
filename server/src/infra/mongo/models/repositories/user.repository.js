// File ==> src/infra/mongo/models/repositories/user.repository.js

import { UserModel } from "../../models/user.model.js";

//* این تابع ایمیل را برای ذخیره و جستجو استاندارد می کند.
function normalizeEmail(email) {
    if (typeof email !== "string") {
        return "";
    }

    return email.trim().toLowerCase();
}

//* این تابع نام یوزر را برای نمایش استاندارد می کند.
function normalizeUserName(userName) {
    if (typeof userName !== "string") {
        return "";
    }

    return userName.trim();
}

//* این تابع کلید جستجوی نام یوزر را یکسان و کوچک می کند.
function normalizeUserNameKey(userName) {
    const normalized = normalizeUserName(userName);

    if (!normalized) {
        return "";
    }

    return normalized.toLowerCase();
}

//* این تابع خروجی خام مونگو را به خروجی ثابت ریپازیتوری تبدیل می کند.
function mapUserDocument(doc) {
    if (!doc) {
        return null;
    }

    let createdAtUnix = 0;

    if (doc.createdAt) {
        const ms = new Date(doc.createdAt).getTime();
        createdAtUnix = Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
    }

    return {
        id: doc.userId ?? "",
        userId: doc.userId ?? "",
        userName: doc.userName ?? "",
        userNameKey: doc.userNameKey ?? "",
        email: doc.email ?? "",
        passwordHash: doc.passwordHash ?? "",
        createdAt: doc.createdAt ?? null,
        createdAtUnix,
        lastLoginAt: doc.lastLoginAt ?? null
    };
}

//* این تابع نتیجه آپدیت مونگو را به خروجی ثابت تبدیل می کند.
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

//* این کلاس فقط عملیات دیتابیس مربوط به یوزر را انجام می دهد.
export class UserRepository {
    //* ساخت یوزر جدید در دیتابیس.
    async create({ userId, id, email, passwordHash, userName }) {
        const normalizedUserId = userId ?? id ?? "";
        const normalizedEmail = normalizeEmail(email);
        const normalizedUserName = normalizeUserName(userName ?? "");
        const normalizedUserNameKey = normalizeUserNameKey(normalizedUserName);

        const createData = {
            userId: normalizedUserId,
            email: normalizedEmail,
            passwordHash
        };

        if (normalizedUserName) {
            createData.userName = normalizedUserName;
        }

        if (normalizedUserNameKey) {
            createData.userNameKey = normalizedUserNameKey;
        }

        const created = await UserModel.create(createData);

        return mapUserDocument(created.toObject ? created.toObject() : created);
    }

    //* پیدا کردن یوزر با ایمیل.
    async findByEmail(email) {
        const normalizedEmail = normalizeEmail(email);
        const doc = await UserModel.findOne({ email: normalizedEmail }).lean();
        return mapUserDocument(doc);
    }

    //* پیدا کردن یوزر با نام یوزر.
    async findByUserName(userName) {
        const normalizedUserNameKey = normalizeUserNameKey(userName);

        if (!normalizedUserNameKey) {
            return null;
        }

        const doc = await UserModel.findOne({
            userNameKey: normalizedUserNameKey
        }).lean();

        return mapUserDocument(doc);
    }

    //* پیدا کردن یوزر با شناسه یوزر.
    async findByUserId(userId) {
        const doc = await UserModel.findOne({ userId }).lean();
        return mapUserDocument(doc);
    }

    //* نام قدیمی برای سازگاری با کدهای قبلی.
    async findById(id) {
        return this.findByUserId(id);
    }

    //* آپدیت نام یوزر برای یوزر موجود.
    async updateUserName(userId, userName) {
        const normalizedUserName = normalizeUserName(userName);
        const normalizedUserNameKey = normalizeUserNameKey(normalizedUserName);

        if (!userId || !normalizedUserName || !normalizedUserNameKey) {
            return {
                acknowledged: false,
                matchedCount: 0,
                modifiedCount: 0
            };
        }

        const result = await UserModel.updateOne(
            { userId },
            {
                $set: {
                    userName: normalizedUserName,
                    userNameKey: normalizedUserNameKey
                }
            }
        );

        return mapUpdateResult(result);
    }

    //* آپدیت زمان آخرین لاگین.
    async updateLastLogin(userId) {
        const result = await UserModel.updateOne(
            { userId },
            { $set: { lastLoginAt: new Date() } }
        );

        return mapUpdateResult(result);
    }
}
