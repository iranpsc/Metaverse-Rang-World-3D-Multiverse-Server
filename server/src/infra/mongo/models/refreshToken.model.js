// File => src/infra/mongo/models/refreshToken.model.js
// src/infra/mongo/models/refreshToken.model.js

import mongoose from "mongoose";

const RefreshTokenSchema = new mongoose.Schema(
    {
        tokenId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            minlength: 1,
            trim: true
        },
        userId: {
            type: String,
            required: true,
            index: true,
            minlength: 1,
            trim: true
        },
        refreshHash: {
            type: String,
            required: true,
            minlength: 1
        },
        userAgent: {
            type: String,
            default: ""
        },
        ip: {
            type: String,
            default: ""
        },
        isRevoked: {
            type: Boolean,
            default: false
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true
        }
    },
    {
        versionKey: false
    }
);

// TTL Index برای پاک شدن خودکار
RefreshTokenSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

export const RefreshTokenModel = mongoose.model(
    "RefreshToken",
    RefreshTokenSchema
);