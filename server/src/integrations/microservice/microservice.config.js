// File => src/integrations/microservice/microservice.config.js

import dotenv from "dotenv";

dotenv.config();

function get(name, fallback = "") {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

function must(name, fallback = "") {
    const value = get(name, fallback);
    if (!value) throw new Error(`Missing env var: ${name}`);
    return value;
}

function readPositiveInt(name, fallback) {
    const value = Number(get(name, fallback));
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid env var: ${name}`);
    return value;
}

const microserviceConfig = {
    tokenUrl: must("MICROSERVICE_TOKEN_URL", "https://accounts.irpsc.com/oauth/token"),
    meUrl: must("MICROSERVICE_ME_URL", "https://accounts.irpsc.com/api/me"),
    completedBuildFeaturesUrl: must(
        "MICROSERVICE_COMPLETED_BUILD_FEATURES_URL",
        "https://accounts.irpsc.com/api/features/build/completed"
    ),
    meMethod: get("MICROSERVICE_ME_METHOD", "POST").trim().toUpperCase(),
    meBodyMode: get("MICROSERVICE_ME_BODY_MODE", "none").trim().toLowerCase(),
    clientId: must("MICROSERVICE_CLIENT_ID", ""),
    clientSecret: must("MICROSERVICE_CLIENT_SECRET", ""),
    scope: get("MICROSERVICE_SCOPE", "*"),
    timeoutMs: readPositiveInt("MICROSERVICE_TIMEOUT_MS", "15000"),
    tokenBodyMode: get("MICROSERVICE_TOKEN_BODY_MODE", "form-data").trim().toLowerCase(),
    tokenEncryptionSecret: must("MICROSERVICE_TOKEN_ENCRYPTION_SECRET", "")
};

if (!["form-data", "urlencoded"].includes(microserviceConfig.tokenBodyMode)) {
    throw new Error("Invalid env var: MICROSERVICE_TOKEN_BODY_MODE");
}

if (!["GET", "POST"].includes(microserviceConfig.meMethod)) {
    throw new Error("Invalid env var: MICROSERVICE_ME_METHOD");
}

if (!["none", "json", "urlencoded"].includes(microserviceConfig.meBodyMode)) {
    throw new Error("Invalid env var: MICROSERVICE_ME_BODY_MODE");
}

export default microserviceConfig;
