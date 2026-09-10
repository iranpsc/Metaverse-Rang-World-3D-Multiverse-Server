const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const rootDir = "/home/world3d/apps/metaverse-server";
const protoPath = path.join(rootDir, "protos/auth/auth.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(rootDir, "protos")]
});

const loadedProto = grpc.loadPackageDefinition(packageDefinition);
const AuthService = loadedProto?.metaverse?.v1?.AuthService;

if (!AuthService) {
    console.error("[NATIVE-50052-AUTH] AuthService not found");
    console.error(JSON.stringify(Object.keys(loadedProto), null, 2));
    process.exit(1);
}

const client = new AuthService(
    "127.0.0.1:50052",
    grpc.credentials.createSsl(),
    {
        "grpc.ssl_target_name_override": "dev-world-3d.metarang.com",
        "grpc.default_authority": "dev-world-3d.metarang.com"
    }
);

function callUnary(methodName, request, metadata) {
    return new Promise((resolve, reject) => {
        const deadline = new Date(Date.now() + 10000);

        if (metadata) {
            client[methodName](request, metadata, { deadline }, (error, response) => {
                if (error) reject(error);
                else resolve(response);
            });
            return;
        }

        client[methodName](request, { deadline }, (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
}

async function main() {
    const stamp = Date.now();

    const email = `native50052_${stamp}@metaverse.local`;
    const password = "TestPass123";
    const userName = `native50052_${stamp}`;

    console.log("[NATIVE-50052-AUTH] Register request");
    const registerResponse = await callUnary("Register", {
        email,
        password,
        userName
    });

    console.log("[NATIVE-50052-AUTH] Register response");
    console.log(JSON.stringify({
        success: registerResponse.success,
        message: registerResponse.message,
        hasAccessToken: !!registerResponse.accessToken,
        hasRefreshToken: !!registerResponse.refreshToken,
        userId: registerResponse.user?.userId || registerResponse.user?.id || "",
        userName: registerResponse.user?.userName || ""
    }, null, 2));

    console.log("[NATIVE-50052-AUTH] Login request");
    const loginResponse = await callUnary("Login", {
        email,
        password
    });

    console.log("[NATIVE-50052-AUTH] Login response");
    console.log(JSON.stringify({
        success: loginResponse.success,
        message: loginResponse.message,
        hasAccessToken: !!loginResponse.accessToken,
        hasRefreshToken: !!loginResponse.refreshToken,
        userId: loginResponse.user?.userId || loginResponse.user?.id || "",
        userName: loginResponse.user?.userName || ""
    }, null, 2));

    const accessToken = loginResponse.accessToken || registerResponse.accessToken;
    if (!accessToken) {
        throw new Error("missing access token");
    }

    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${accessToken}`);

    console.log("[NATIVE-50052-AUTH] GetUserData request");
    const userDataResponse = await callUnary("GetUserData", {}, metadata);

    console.log("[NATIVE-50052-AUTH] GetUserData response");
    console.log(JSON.stringify({
        success: userDataResponse.success,
        message: userDataResponse.message,
        userId: userDataResponse.user?.userId || userDataResponse.user?.id || "",
        email: userDataResponse.user?.email || "",
        userName: userDataResponse.user?.userName || ""
    }, null, 2));

    console.log("[NATIVE-50052-AUTH] OK");
}

main().catch((error) => {
    console.error("[NATIVE-50052-AUTH] ERROR");
    console.error(error);
    process.exit(1);
});
