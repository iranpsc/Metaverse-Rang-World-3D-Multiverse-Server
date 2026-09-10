// File => src/integrations/microservice/testMicroserviceCompletedBuildFeatures.js

import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

const { loginWithPassword } = await import("./microserviceToken.client.js");
const { getMicroserviceCompletedBuildFeatures } = await import("./microserviceApi.client.js");
const { maskToken } = await import("./microserviceToken.crypto.js");

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function readPositiveInt(value, name, fallback) {
    const normalizedValue = value === undefined || value === "" ? fallback : Number(value);

    if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return normalizedValue;
}

async function main() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");
    const page = readPositiveInt(
        process.env.MICROSERVICE_TEST_COMPLETED_BUILD_FEATURES_PAGE,
        "MICROSERVICE_TEST_COMPLETED_BUILD_FEATURES_PAGE",
        1
    );

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

    const featuresResult = await getMicroserviceCompletedBuildFeatures({
        accessToken: tokenResult.accessToken,
        tokenType: tokenResult.tokenType,
        page
    });

    console.log("Microservice completed build features OK");
    console.log({
        statusCode: featuresResult.statusCode,
        page,
        data: featuresResult.data
    });
}

try {
    await main();
} catch (error) {
    console.error("Microservice completed build features test failed");
    console.error({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        statusCode: error?.statusCode,
        raw: error?.raw
    });

    process.exitCode = 1;
}
