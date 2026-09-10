// File => src/integrations/microservice/testMicroserviceCombinedAuth.js

import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

const mongoose = (await import("mongoose")).default;
const { connectDatabase } = await import("../../infra/mongo/connection.js");
const { microserviceAuthUseCase } = await import("../../core/auth/microserviceAuth.instance.js");

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function maskToken(token) {
    if (!token || token.length < 16) return "***";
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function printResult(title, result) {
    console.log(title);
    console.log({
        success: result.success,
        message: result.message,
        internalAction: result.internalAction,
        user: {
            id: result.user?.id,
            email: result.user?.email,
            userName: result.user?.userName
        },
        accessToken: maskToken(result.accessToken),
        refreshToken: maskToken(result.refreshToken),
        expiresIn: result.expiresIn,
        microservice: result.microservice
    });
}

async function runCombinedAuthOnce(label, username, password) {
    const result = await microserviceAuthUseCase.loginOrRegisterWithMicroservice({
        username,
        password,
        ip: "127.0.0.1",
        userAgent: "microservice-combined-auth-test/1.0"
    });

    printResult(label, result);
    return result;
}

async function main() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");

    await connectDatabase();

    await runCombinedAuthOnce("Combined auth attempt 1", username, password);
    await runCombinedAuthOnce("Combined auth attempt 2", username, password);
}

try {
    await main();
    console.log("Microservice combined auth test OK");
} catch (error) {
    console.error("Microservice combined auth test failed");
    console.error({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        statusCode: error?.statusCode,
        raw: error?.raw
    });

    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
