// File => src/integrations/microservice/testGrpcExistingAuthMicroserviceBridge.js

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

function maskToken(token) {
    if (!token || token.length < 16) return "***";
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
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

function callUnary(client, methodName, request) {
    const method = getMethod(client, methodName);

    return new Promise((resolve, reject) => {
        method(request, (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(response);
        });
    });
}

function printResult(title, response) {
    console.log(title);
    console.log({
        success: response.success,
        message: response.message,
        expiresIn: response.expiresIn,
        user: {
            id: response.user?.id,
            email: response.user?.email,
            userName: response.user?.userName
        },
        accessToken: maskToken(response.accessToken),
        refreshToken: maskToken(response.refreshToken)
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

    printResult("Existing Login through microservice bridge OK", loginResponse);

    const registerResponse = await callUnary(client, "Register", {
        email,
        password,
        userName: ""
    });

    printResult("Existing Register through microservice bridge OK", registerResponse);

    client.close();
}

try {
    await main();
    console.log("Existing Register/Login microservice bridge test OK");
} catch (error) {
    console.error("Existing Register/Login microservice bridge test failed");
    console.error({
        code: error?.code,
        details: error?.details,
        message: error?.message
    });

    process.exitCode = 1;
}
