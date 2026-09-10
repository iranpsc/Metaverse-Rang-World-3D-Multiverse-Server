const REQUIRED_ROLE = "npc_voice_publisher";
const REQUIRED_SCOPE = "voice:npc:publish";

class VoiceNpcPublisherAuthorizationService {
    //* این سازنده Verifier توکن سرویس و ساعت قابل آزمون را دریافت می‌کند.
    constructor({ serviceTokenVerifier, now = () => Date.now() } = {}) {
        if (!serviceTokenVerifier || typeof serviceTokenVerifier.verifyServiceToken !== "function")
            throw new TypeError("serviceTokenVerifier must provide verifyServiceToken.");
        if (typeof now !== "function") throw new TypeError("now must be a function.");
        this.serviceTokenVerifier = serviceTokenVerifier;
        this.now = now;
    }

    //* این تابع Service Token را از نظر نقش، Scope، NPC و سرور مجاز بررسی می‌کند.
    async authorize({ token, npcId, serverId } = {}) {
        const safeToken = String(token ?? "").trim();
        const safeNpcId = String(npcId ?? "").trim();
        const safeServerId = String(serverId ?? "").trim();
        if (!safeToken || !safeNpcId || !safeServerId)
            return Object.freeze({ authorized: false, reason: "npc_auth_input_missing", claims: null });

        let claims;
        try { claims = await this.serviceTokenVerifier.verifyServiceToken(safeToken); }
        catch { return Object.freeze({ authorized: false, reason: "npc_service_token_invalid", claims: null }); }

        const roles = Array.isArray(claims?.roles) ? claims.roles : [claims?.role];
        const scopes = Array.isArray(claims?.scopes)
            ? claims.scopes
            : String(claims?.scope ?? "").split(/\s+/).filter(Boolean);
        const expiresAtMs = Number(claims?.exp ?? 0) * 1000;

        if (!roles.includes(REQUIRED_ROLE))
            return Object.freeze({ authorized: false, reason: "npc_role_missing", claims: null });
        if (!scopes.includes(REQUIRED_SCOPE))
            return Object.freeze({ authorized: false, reason: "npc_scope_missing", claims: null });
        if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= this.now())
            return Object.freeze({ authorized: false, reason: "npc_service_token_expired", claims: null });
        if (String(claims?.npcId ?? "").trim() !== safeNpcId)
            return Object.freeze({ authorized: false, reason: "npc_identity_mismatch", claims: null });
        if (String(claims?.serverId ?? "").trim() !== safeServerId)
            return Object.freeze({ authorized: false, reason: "npc_server_mismatch", claims: null });

        return Object.freeze({
            authorized: true,
            reason: "npc_authorized",
            claims: Object.freeze({
                serviceId: String(claims?.sub ?? "").trim(),
                npcId: safeNpcId,
                serverId: safeServerId,
                role: REQUIRED_ROLE,
                scope: REQUIRED_SCOPE,
                expiresAtMs
            })
        });
    }
}

export { REQUIRED_ROLE, REQUIRED_SCOPE, VoiceNpcPublisherAuthorizationService };

/*
توضیح فایل:
این فایل فقط Service Token دارای نقش npc_voice_publisher، Scope انتشار، npcId و serverId دقیق را برای مسیر NPC می‌پذیرد و توکن کاربر عادی را مجاز نمی‌کند.
*/
