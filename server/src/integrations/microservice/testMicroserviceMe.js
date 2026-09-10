// File => src/integrations/microservice/testMicroserviceMe.js

import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

const { loginWithPassword } = await import("./microserviceToken.client.js");
const { getMicroserviceMe } = await import("./microserviceApi.client.js");
const { maskToken } = await import("./microserviceToken.crypto.js");

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function unwrapMeData(payload) {
    if (payload?.data && typeof payload.data === "object") return payload.data;
    return payload;
}

function summarizeMeData(payload) {
    const data = unwrapMeData(payload);

    if (!data || typeof data !== "object") return data;

    return {
        id: data.id ?? data.user_id ?? data.userId ?? "",
        name: data.name ?? data.full_name ?? data.fullName ?? "",
        username: data.username ?? data.userName ?? "",
        email: data.email ?? "",
        code: data.code ?? "",
        avatar: data.avatar ?? "",
        keys: Object.keys(data)
    };
}

async function main() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");

    const tokenResult = await loginWithPassword({
        username,
        password
    });

    console.log("Microservice login OK");
    console.log({
        tokenType: tokenResult.tokenType,
        expiresIn: tokenResult.expiresIn,
        accessToken: maskToken(tokenResult.accessToken)
    });

    const meResult = await getMicroserviceMe({
        accessToken: tokenResult.accessToken,
        tokenType: tokenResult.tokenType
    });

    console.log("Microservice /api/me OK");
    console.log({
        statusCode: meResult.statusCode,
        dataSummary: summarizeMeData(meResult.data),
        rawData: meResult.data
    });
}

try {
    await main();
} catch (error) {
    console.error("Microservice /api/me test failed");
    console.error({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        statusCode: error?.statusCode,
        raw: error?.raw
    });

    process.exitCode = 1;
}
