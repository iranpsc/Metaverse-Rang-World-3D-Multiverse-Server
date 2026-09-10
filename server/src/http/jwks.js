// src/http/jwks.js
//‫کلید عمومی Access Token را به فرمت JWK تبدیل می کند و خروجی
import fs from "fs";
import { createPublicKey } from "crypto";
import cfg from "../config/env.js";

/**
 * pemToJwk
 * Converts PEM public key to JWK
 */
function pemToJwk(publicKeyPem) {
    const keyObject = createPublicKey(publicKeyPem);
    return keyObject.export({ format: "jwk" });
}

/**
 * buildAccessJwk
 * Builds the access-token public JWK for JWKS endpoint
 */
function buildAccessJwk() {
    const publicKeyPem = fs.readFileSync(cfg.jwt.accessPublicKeyPath, "utf8");
    const jwk = pemToJwk(publicKeyPem);

    return {
        ...jwk,
        use: "sig",
        alg: cfg.jwt.algorithm,
        kid: cfg.jwt.accessKeyId
    };
}

/**
 * buildJwksResponse
 * Returns the JWKS document
 */
export function buildJwksResponse() {
    return {
        keys: [buildAccessJwk()]
    };
}

/**
 * handleJwksRequest
 * Handles HTTP GET /.well-known/jwks.json
 */
export function handleJwksRequest(req, res) {
    if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return true;
    }

    const body = JSON.stringify(buildJwksResponse());

    res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
    });

    res.end(body);
    return true;
}

/* 
مسئول ساخت و پاسخ دادن به endpoint مربوط به JWKS است.

این endpoint معمولاً با مسیر /.well - known / jwks.json
توسط Envoy یا سرویس‌های دیگر خوانده می‌شود.

در این فایل، access public key از مسیر تنظیم‌شده در config خوانده می‌شود
و از فرمت PEM به فرمت JWK تبدیل می‌شود.

سپس این JWK همراه با اطلاعاتی مثل use، alg و kid
داخل ساختار استاندارد JWKS قرار می‌گیرد.

تابع handleJwksRequest فقط درخواست‌های GET را قبول می‌کند
و در صورت موفقیت، پاسخ JSON شامل public key را برمی‌گرداند.

Envoy از این public key برای verify کردن access token استفاده می‌کند
و */