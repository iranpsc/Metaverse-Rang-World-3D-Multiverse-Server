import "dotenv/config";

import { createGameServerControl } from "../../gameServerControl/index.js";
import { VOICE_NPC_SERVICE_TOKEN_PURPOSE } from "./createGameServerNpcServiceTokenVerifier.js";

function readArgument(name, fallback = "") {
    const equalsPrefix = `--${name}=`;
    const equalsValue = process.argv.find((item) => item.startsWith(equalsPrefix));
    if (equalsValue) return equalsValue.slice(equalsPrefix.length).trim();
    const index = process.argv.findIndex((item) => item === `--${name}`);
    return index >= 0 ? String(process.argv[index + 1] ?? fallback).trim() : fallback;
}

const serverId = readArgument("serverId");
const npcId = readArgument("npcId");
const serviceId = readArgument("serviceId", "voice-npc-service");
const ttlSeconds = Number.parseInt(readArgument("ttlSeconds", "60"), 10);

if (!serverId || !npcId || !serviceId) {
    throw new Error("--serverId, --npcId and --serviceId are required.");
}
if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300) {
    throw new RangeError("--ttlSeconds must be between 5 and 300.");
}

const control = createGameServerControl();
const token = control.serviceTokenService.createToken({
    serverId,
    purpose: VOICE_NPC_SERVICE_TOKEN_PURPOSE,
    ttlSeconds,
    metadata: {
        serviceId,
        role: "npc_voice_publisher",
        scope: "voice:npc:publish",
        npcId
    }
});

process.stdout.write(JSON.stringify({
    success: true,
    serverId,
    npcId,
    serviceId,
    ttlSeconds,
    purpose: VOICE_NPC_SERVICE_TOKEN_PURPOSE,
    token
}, null, 2) + "\n");

/*
توضیح فایل:
این ابزار یک Service Token کوتاه‌عمر و محدود به NPC مشخص می‌سازد؛ Token را فقط در خروجی استاندارد تحویل می‌دهد و داخل لاگ Runtime ذخیره نمی‌کند.
*/
