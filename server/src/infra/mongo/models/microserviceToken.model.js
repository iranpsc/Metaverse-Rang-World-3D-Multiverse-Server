// File => src/infra/mongo/models/microserviceToken.model.js

import mongoose from "mongoose";

const MicroserviceTokenSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            minlength: 1
        },

        microserviceUserName: {
            type: String,
            required: true,
            index: true,
            trim: true,
            minlength: 1
        },

        tokenType: {
            type: String,
            default: "Bearer",
            trim: true
        },

        accessTokenEncrypted: {
            type: String,
            required: true,
            minlength: 1
        },

        refreshTokenEncrypted: {
            type: String,
            default: ""
        },

        scope: {
            type: String,
            default: "*",
            trim: true
        },

        expiresAt: {
            type: Date,
            required: true,
            index: true
        },

        lastLoginAt: {
            type: Date,
            default: null
        },

        lastRefreshAt: {
            type: Date,
            default: null
        },

        lastTokenUpdateAt: {
            type: Date,
            default: Date.now
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        versionKey: false,
        collection: "microservice_tokens"
    }
);

export const MicroserviceTokenModel = mongoose.model(
    "MicroserviceToken",
    MicroserviceTokenSchema
);
