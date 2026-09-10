// File => src/integrations/microservice/testMicroserviceProfileStorage.js

import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

const mongoose = (await import("mongoose")).default;
const { connectDatabase } = await import("../../infra/mongo/connection.js");
const { loginWithPassword } = await import("./microserviceToken.client.js");
const { getMicroserviceMe } = await import("./microserviceApi.client.js");
const { MicroserviceProfileRepository } = await import("../../infra/mongo/models/repositories/microserviceProfile.repository.js");

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function printProfile(title, profile) {
    console.log(title);
    console.log({
        userId: profile?.userId,
        microserviceUserName: profile?.microserviceUserName,
        microserviceId: profile?.microserviceId,
        name: profile?.name,
        code: profile?.code,
        avatar: profile?.avatar,
        lastSyncAt: profile?.lastSyncAt
    });
}

async function main() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");
    const testUserId = process.env.MICROSERVICE_TEST_INTERNAL_USER_ID || "microservice-test-user";

    await connectDatabase();

    const tokenResult = await loginWithPassword({
        username,
        password
    });

    const meResult = await getMicroserviceMe({
        accessToken: tokenResult.accessToken,
        tokenType: tokenResult.tokenType
    });

    const repository = new MicroserviceProfileRepository();

    const storedProfile = await repository.upsertFromMePayload({
        userId: testUserId,
        microserviceUserName: username,
        mePayload: meResult.data
    });

    printProfile("Stored microservice profile", storedProfile);

    if (!storedProfile?.microserviceId) throw new Error("microserviceId was not stored");
    if (!storedProfile?.name) throw new Error("name was not stored");
    if (!storedProfile?.code) throw new Error("code was not stored");
}

try {
    await main();
    console.log("Microservice profile storage test OK");
} catch (error) {
    console.error("Microservice profile storage test failed");
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
