// File => src/integrations/microservice/testGrpcMicroserviceLogin.js

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
    const address = `${host}:${port}`;

    return new AuthService(address, grpc.credentials.createInsecure());
}

function getLoginWithMicroserviceMethod(client) {
    if (typeof client.LoginWithMicroservice === "function") return client.LoginWithMicroservice.bind(client);
    if (typeof client.loginWithMicroservice === "function") return client.loginWithMicroservice.bind(client);

    const methodNames = Object.keys(client)
        .filter((key) => typeof client[key] === "function")
        .sort();

    throw new Error(`LoginWithMicroservice method not found. Available methods: ${methodNames.join(", ")}`);
}

function loginWithMicroservice(client, request) {
    const method = getLoginWithMicroserviceMethod(client);

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

async function main() {
    const email = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");

    const client = loadAuthClient();

    const response = await loginWithMicroservice(client, {
        email,
        password
    });

    console.log("Grpc LoginWithMicroservice OK");
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

    client.close();
}

try {
    await main();
} catch (error) {
    console.error("Grpc LoginWithMicroservice failed");
    console.error({
        code: error?.code,
        details: error?.details,
        message: error?.message
    });

    process.exitCode = 1;
}
