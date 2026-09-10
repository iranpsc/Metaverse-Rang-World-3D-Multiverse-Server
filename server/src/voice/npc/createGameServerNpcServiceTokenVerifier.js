const VOICE_NPC_SERVICE_TOKEN_PURPOSE = "voice_npc_publisher";

//* این تابع سرویس توکن موجود Game Server را به Claims محدود مورد نیاز ناشر NPC تبدیل می‌کند.
function createGameServerNpcServiceTokenVerifier({ serviceTokenService } = {}) {
    if (!serviceTokenService || typeof serviceTokenService.verifyToken !== "function") {
        throw new TypeError("serviceTokenService must provide verifyToken.");
    }

    return Object.freeze({
        verifyServiceToken(token) {
            const result = serviceTokenService.verifyToken(token, {
                purpose: VOICE_NPC_SERVICE_TOKEN_PURPOSE
            });

            if (result?.success !== true || !result.payload) {
                const error = new Error("NPC service token is invalid.");
                error.code = String(result?.reason ?? "npc_service_token_invalid");
                throw error;
            }

            const metadata = result.payload.metadata ?? {};
            const roles = Array.isArray(metadata.roles)
                ? metadata.roles.map(String)
                : [String(metadata.role ?? "")].filter(Boolean);
            const scopes = Array.isArray(metadata.scopes)
                ? metadata.scopes.map(String)
                : String(metadata.scope ?? "").split(/\s+/).filter(Boolean);

            return Object.freeze({
                sub: String(metadata.serviceId ?? "").trim(),
                roles: Object.freeze(roles),
                scopes: Object.freeze(scopes),
                npcId: String(metadata.npcId ?? "").trim(),
                serverId: String(result.payload.serverId ?? "").trim(),
                exp: Math.floor(Number(result.payload.expiresAt ?? 0) / 1000)
            });
        }
    });
}

export {
    VOICE_NPC_SERVICE_TOKEN_PURPOSE,
    createGameServerNpcServiceTokenVerifier
};

/*
توضیح فایل:
این Adapter فقط توکن سرویس داخلی با Purpose اختصاصی NPC را می‌پذیرد و Metadata امضاشده را به Claims حداقلی Authorizer صوت تبدیل می‌کند.
*/
