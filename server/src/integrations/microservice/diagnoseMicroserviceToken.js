import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

function read(name) {
    return process.env[name] || "";
}

function mask(value) {
    if (!value) return "";
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function required(name) {
    const value = read(name).trim();
    if (!value) throw new Error(`${name} is missing`);
    return value;
}

async function readPayload(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { raw: text };
    }
}

function buildFormData(fields) {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return { body, headers: {} };
}

function buildUrlEncoded(fields) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return {
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    };
}

async function testMode(mode, fields) {
    const tokenUrl = required("MICROSERVICE_TOKEN_URL");
    const request = mode === "urlencoded" ? buildUrlEncoded(fields) : buildFormData(fields);

    const response = await fetch(tokenUrl, {
        method: "POST",
        headers: request.headers,
        body: request.body
    });

    const payload = await readPayload(response);

    console.log(`\nMODE=${mode}`);
    console.log({
        status: response.status,
        ok: response.ok,
        error: payload?.error || "",
        message: payload?.message || payload?.error_description || "",
        hasAccessToken: !!payload?.access_token,
        hasRefreshToken: !!payload?.refresh_token,
        expiresIn: payload?.expires_in || 0
    });
}

async function main() {
    const fields = {
        username: required("MICROSERVICE_TEST_USERNAME"),
        password: required("MICROSERVICE_TEST_PASSWORD"),
        grant_type: "password",
        client_id: required("MICROSERVICE_CLIENT_ID"),
        client_secret: required("MICROSERVICE_CLIENT_SECRET"),
        scope: read("MICROSERVICE_SCOPE") || "*"
    };

    console.log("CONFIG CHECK");
    console.log({
        tokenUrl: required("MICROSERVICE_TOKEN_URL"),
        clientId: fields.client_id,
        clientSecretMasked: mask(fields.client_secret),
        clientSecretLength: fields.client_secret.length,
        username: fields.username,
        passwordLength: fields.password.length,
        scope: fields.scope
    });

    await testMode("form-data", fields);
    await testMode("urlencoded", fields);
}

main().catch((error) => {
    console.error("DIAGNOSE_FAILED");
    console.error({
        name: error?.name,
        message: error?.message
    });
    process.exit(1);
});
