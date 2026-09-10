// File => src/integrations/microservice/microserviceToken.crypto.js

import crypto from "crypto";
import microserviceConfig from "./microservice.config.js";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function normalizeText(value) {
    return typeof value === "string" ? value : "";
}

function encode(buffer) {
    return Buffer.from(buffer).toString("base64url");
}

function decode(value) {
    return Buffer.from(value, "base64url");
}

function deriveKey(salt) {
    return crypto.scryptSync(
        microserviceConfig.tokenEncryptionSecret,
        salt,
        KEY_LENGTH
    );
}

export function encryptText(plainText) {
    const text = normalizeText(plainText);

    if (!text) return "";

    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(salt);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });

    const encrypted = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return [
        VERSION,
        encode(salt),
        encode(iv),
        encode(tag),
        encode(encrypted)
    ].join(":");
}

export function decryptText(encryptedText) {
    const text = normalizeText(encryptedText);

    if (!text) return "";

    const parts = text.split(":");

    if (parts.length !== 5 || parts[0] !== VERSION) {
        throw new Error("Invalid encrypted token format");
    }

    const salt = decode(parts[1]);
    const iv = decode(parts[2]);
    const tag = decode(parts[3]);
    const encrypted = decode(parts[4]);
    const key = deriveKey(salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });

    decipher.setAuthTag(tag);

    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]).toString("utf8");
}

export function maskToken(token) {
    const text = normalizeText(token);

    if (!text || text.length < 16) return "***";

    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}
