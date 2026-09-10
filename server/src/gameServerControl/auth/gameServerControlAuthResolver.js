function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function readHeader(headers = {}, headerName = "") {
    if (!headers || !headerName) return "";

    const directValue = headers[headerName] ?? headers[headerName.toLowerCase()] ?? headers[headerName.toUpperCase()];
    if (Array.isArray(directValue)) return String(directValue[0] ?? "").trim();

    return String(directValue ?? "").trim();
}

function readBearerAccessToken(req = {}) {
    const authorization = readHeader(req.headers ?? {}, "authorization");
    if (!isNonEmptyString(authorization)) return "";

    const prefix = "Bearer ";
    if (!authorization.startsWith(prefix)) return "";

    return authorization.slice(prefix.length).trim();
}

function normalizeGameServerControlUser(payload = {}) {
    const userId = String(payload?.sub ?? payload?.userId ?? payload?.id ?? "").trim();
    if (!userId) return null;

    return {
        id: userId,
        userId,
        tokenId: String(payload?.jti ?? ""),
        issuedAt: payload?.iat ?? 0,
        email: String(payload?.email ?? ""),
        userName: String(payload?.userName ?? ""),
        source: "access_token"
    };
}

function createGameServerControlAuthResolver({ tokenService, logger = console } = {}) {
    return async function resolveGameServerControlUserFromRequest(req = {}) {
        const accessToken = readBearerAccessToken(req);
        if (!accessToken) return null;

        if (!tokenService || typeof tokenService.verifyAccessToken !== "function") {
            logger?.warn?.("[GameServerControlAuth] TokenService verifyAccessToken is not available.");
            return null;
        }

        try {
            const payload = tokenService.verifyAccessToken(accessToken);
            return normalizeGameServerControlUser(payload);
        } catch (error) {
            logger?.warn?.("[GameServerControlAuth] Access token verification failed.", {
                error: String(error?.message ?? error)
            });
            return null;
        }
    };
}

export {
    createGameServerControlAuthResolver,
    normalizeGameServerControlUser,
    readBearerAccessToken
};
