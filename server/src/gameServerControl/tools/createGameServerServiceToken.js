// File => src/gameServerControl/tools/createGameServerServiceToken.js

import "dotenv/config";

import { createGameServerControl } from "../index.js";

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function readArg(name, fallback = "") {
    const equalsPrefix = `--${name}=`;
    const equalsValue = process.argv.find((item) => item.startsWith(equalsPrefix));

    if (equalsValue) return equalsValue.slice(equalsPrefix.length).trim();

    const plainIndex = process.argv.findIndex((item) => item === `--${name}`);

    if (plainIndex >= 0 && process.argv[plainIndex + 1]) return String(process.argv[plainIndex + 1]).trim();

    return fallback;
}

function readPositiveIntArg(name, fallback = 0) {
    const rawValue = readArg(name, "");
    const parsedValue = Number.parseInt(rawValue, 10);

    if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue;

    return fallback;
}

function resolveTtlSeconds() {
    const ttlSeconds = readPositiveIntArg("ttlSeconds", 0);

    if (ttlSeconds > 0) return ttlSeconds;

    const ttlDays = readPositiveIntArg("ttlDays", 0);

    if (ttlDays > 0) return ttlDays * 24 * 60 * 60;

    const ttlHours = readPositiveIntArg("ttlHours", 0);

    if (ttlHours > 0) return ttlHours * 60 * 60;

    return DEFAULT_TTL_SECONDS;
}

function decodeTokenPayload(token) {
    try {
        const parts = String(token || "").split(".");

        if (parts.length < 2) return null;

        return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
        return null;
    }
}

function createTokenForTest() {
    const serverId = readArg("serverId", process.env.GAME_SERVER_TEST_SERVER_ID || "ds_vps_test_001");
    const purpose = readArg("purpose", "dedicated_server");
    const ttlSeconds = resolveTtlSeconds();
    const ttlMs = ttlSeconds * 1000;
    const requestedIssuedAt = Date.now();
    const requestedExpiresAt = requestedIssuedAt + ttlMs;

    const control = createGameServerControl();

    const token = control.serviceTokenService.createToken({
        serverId,
        purpose,
        ttlSeconds,
        ttlMs,
        expiresAt: requestedExpiresAt,
        metadata: {
            source: "create_game_server_service_token_tool",
            requestedTtlSeconds: ttlSeconds
        }
    });

    const payload = decodeTokenPayload(token);
    const actualTtlSeconds = payload?.issuedAt && payload?.expiresAt ? Math.round((payload.expiresAt - payload.issuedAt) / 1000) : 0;
    const actualTtlDays = actualTtlSeconds > 0 ? Math.round(actualTtlSeconds / 86400) : 0;

    console.log(JSON.stringify({
        success: true,
        serverId,
        purpose,
        requestedTtlSeconds: ttlSeconds,
        requestedTtlDays: Math.round(ttlSeconds / 86400),
        actualTtlSeconds,
        actualTtlDays,
        ttlMatchesRequest: actualTtlSeconds === ttlSeconds,
        token,
        payload
    }, null, 2));
}

createTokenForTest();
