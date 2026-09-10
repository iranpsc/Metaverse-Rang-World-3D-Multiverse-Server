// File => src/integrations/microservice/testMicroserviceTokenStorage.js

import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

const mongoose = (await import("mongoose")).default;
const { connectDatabase } = await import("../../infra/mongo/connection.js");
const { loginWithPassword, refreshAccessToken } = await import("./microserviceToken.client.js");
const { maskToken } = await import("./microserviceToken.crypto.js");
const { MicroserviceTokenRepository } = await import("../../infra/mongo/models/repositories/microserviceToken.repository.js");

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function printStoredRecord(title, record) {
    console.log(title);
    console.log({
        userId: record?.userId,
        microserviceUserName: record?.microserviceUserName,
        tokenType: record?.tokenType,
        scope: record?.scope,
        expiresAt: record?.expiresAt,
        isExpired: record?.isExpired,
        accessToken: maskToken(record?.accessToken),
        refreshToken: maskToken(record?.refreshToken)
    });
}

async function main() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");
    const testUserId = process.env.MICROSERVICE_TEST_INTERNAL_USER_ID || "microservice-test-user";

    await connectDatabase();

    const repository = new MicroserviceTokenRepository();

    const loginResult = await loginWithPassword({
        username,
        password
    });

    await repository.upsertTokenSet({
        userId: testUserId,
        microserviceUserName: username,
        tokenSet: loginResult,
        source: "login"
    });

    const storedAfterLogin = await repository.findByUserId(testUserId, {
        includeTokens: true
    });

    printStoredRecord("Stored after login", storedAfterLogin);

    if (!storedAfterLogin?.refreshToken) {
        throw new Error("Stored refresh token is missing");
    }

    const refreshResult = await refreshAccessToken({
        refreshToken: storedAfterLogin.refreshToken
    });

    await repository.upsertTokenSet({
        userId: testUserId,
        microserviceUserName: username,
        tokenSet: refreshResult,
        source: "refresh"
    });

    const storedAfterRefresh = await repository.findByUserId(testUserId, {
        includeTokens: true
    });

    printStoredRecord("Stored after refresh", storedAfterRefresh);

    const validAccessToken = await repository.getValidAccessToken(testUserId);

    console.log("Valid access token check");
    console.log({
        ok: validAccessToken.ok,
        reason: validAccessToken.reason,
        tokenType: validAccessToken.tokenType,
        accessToken: maskToken(validAccessToken.accessToken)
    });
}

try {
    await main();
    console.log("Microservice token storage test OK");
} catch (error) {
    console.error("Microservice token storage test failed");
    console.error({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        statusCode: error?.statusCode
    });

    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
