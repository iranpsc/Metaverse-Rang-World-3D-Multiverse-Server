// File => src/infra/mongo/models/user.model.js

import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            minlength: 1,
            trim: true
        },

        userName: {
            type: String,
            trim: true,
            minlength: 1,
            maxlength: 32,
            default: ""
        },

        userNameKey: {
            type: String,
            unique: true,
            sparse: true,
            index: true,
            lowercase: true,
            trim: true,
            minlength: 1,
            maxlength: 32
        },

        email: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true
        },

        passwordHash: {
            type: String,
            required: true,
            minlength: 1
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        lastLoginAt: {
            type: Date,
            default: null
        }
    },
    {
        versionKey: false
    }
);

export const UserModel = mongoose.model("User", UserSchema);
