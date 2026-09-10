// File => src/infra/mongo/models/microserviceProfile.model.js

import mongoose from "mongoose";

const MicroserviceProfileSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            index: true,
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

        microserviceId: {
            type: String,
            default: "",
            index: true,
            trim: true
        },

        name: {
            type: String,
            default: "",
            trim: true
        },

        code: {
            type: String,
            default: "",
            index: true,
            trim: true
        },

        avatar: {
            type: String,
            default: "",
            trim: true
        },

        rawData: {
            type: Object,
            default: {}
        },

        lastSyncAt: {
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
        collection: "microservice_profiles"
    }
);

export const MicroserviceProfileModel = mongoose.model(
    "MicroserviceProfile",
    MicroserviceProfileSchema
);
