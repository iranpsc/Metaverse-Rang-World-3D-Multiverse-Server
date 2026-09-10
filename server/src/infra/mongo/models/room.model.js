// File => src/infra/mongo/models/room.model.js

import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema(
    {
        roomId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            minlength: 1,
            trim: true
        },

        roomName: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 64
        },

        roomNameKey: {
            type: String,
            required: true,
            index: true,
            lowercase: true,
            trim: true,
            minlength: 2,
            maxlength: 64
        },

        description: {
            type: String,
            trim: true,
            maxlength: 256,
            default: ""
        },

        ownerUserId: {
            type: String,
            required: true,
            index: true,
            trim: true
        },

        ownerUserName: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 32
        },

        visibility: {
            type: String,
            enum: ["public", "private"],
            default: "public",
            index: true
        },

        status: {
            type: String,
            enum: ["open", "full", "empty", "closed"],
            default: "open",
            index: true
        },

        maxPlayers: {
            type: Number,
            default: 20,
            min: 1,
            max: 100
        },

        onlineCount: {
            type: Number,
            default: 0,
            min: 0
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        updatedAt: {
            type: Date,
            default: Date.now
        },

        lastActiveAt: {
            type: Date,
            default: Date.now,
            index: true
        },

        closedAt: {
            type: Date,
            default: null
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        versionKey: false
    }
);

RoomSchema.index({ visibility: 1, status: 1, lastActiveAt: -1 });
RoomSchema.index({ ownerUserId: 1, status: 1 });

export const RoomModel = mongoose.model("Room", RoomSchema);
