// File => src/integrations/microservice/testGrpcGetMicroserviceUserData.js

import path from "path";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function loadAuthClient() {
    const protoRoot = path.resolve("protos");
    const authProtoPath = path.join(protoRoot, "auth", "auth.proto");

    const packageDefinition = protoLoader.loadSync(authProtoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true,
        includeDirs: [protoRoot]
    });

    const proto = grpc.loadPackageDefinition(packageDefinition);
    const AuthService = proto?.metaverse?.v1?.AuthService;

    if (!AuthService) throw new Error("AuthService was not loaded from proto");

    const host = process.env.GRPC_TEST_HOST || "127.0.0.1";
    const port = process.env.GRPC_PORT || "50051";

    return new AuthService(`${host}:${port}`, grpc.credentials.createInsecure());
}

function getMethod(client, methodName) {
    const lowerName = methodName.charAt(0).toLowerCase() + methodName.slice(1);

    if (typeof client[methodName] === "function") return client[methodName].bind(client);
    if (typeof client[lowerName] === "function") return client[lowerName].bind(client);

    throw new Error(`${methodName} method not found`);
}

function callUnary(client, methodName, request, metadata = null) {
    const method = getMethod(client, methodName);

    return new Promise((resolve, reject) => {
        const callback = (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(response);
        };

        if (metadata) method(request, metadata, callback);
        else method(request, callback);
    });
}

async function main() {
    const email = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");

    const client = loadAuthClient();

    const loginResponse = await callUnary(client, "Login", {
        email,
        password
    });

    if (!loginResponse?.accessToken) {
        throw new Error("Login did not return accessToken");
    }

    const metadata = new grpc.Metadata();
    metadata.add("authorization", `Bearer ${loginResponse.accessToken}`);

    const profileResponse = await callUnary(client, "GetMicroserviceUserData", {}, metadata);

    console.log("Grpc GetMicroserviceUserData OK");
    console.log({
        success: profileResponse.success,
        message: profileResponse.message,
        profile: profileResponse.profile
    });

    client.close();
}

try {
    await main();
} catch (error) {
    console.error("Grpc GetMicroserviceUserData failed");
    console.error({
        code: error?.code,
        details: error?.details,
        message: error?.message
    });

    process.exitCode = 1;
}
