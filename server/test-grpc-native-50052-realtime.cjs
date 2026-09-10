const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const rootDir = "/home/world3d/apps/metaverse-server";

const authProtoPath = path.join(rootDir, "protos/auth/auth.proto");
const realtimeProtoPath = path.join(rootDir, "protos/realtime/realtime_stream.proto");
const includeDirs = [path.join(rootDir, "protos")];

function loadProto(protoPath) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

const authLoadedProto = loadProto(authProtoPath);
const realtimeLoadedProto = loadProto(realtimeProtoPath);

const AuthService = authLoadedProto?.metaverse?.v1?.AuthService;
const RealtimeStreamService = realtimeLoadedProto?.metaverse?.v1?.realtime?.RealtimeStreamService;

if (!AuthService) {
    console.error("[NATIVE-50052-REALTIME] AuthService پیدا نشد");
    console.error(JSON.stringify(Object.keys(authLoadedProto), null, 2));
    process.exit(1);
}

if (!RealtimeStreamService) {
    console.error("[NATIVE-50052-REALTIME] RealtimeStreamService پیدا نشد");
    console.error(JSON.stringify(Object.keys(realtimeLoadedProto), null, 2));
    process.exit(1);
}

const clientOptions = {
    "grpc.ssl_target_name_override": "dev-world-3d.metarang.com",
    "grpc.default_authority": "dev-world-3d.metarang.com"
};

const authClient = new AuthService(
    "127.0.0.1:50052",
    grpc.credentials.createSsl(),
    clientOptions
);

const realtimeClient = new RealtimeStreamService(
    "127.0.0.1:50052",
    grpc.credentials.createSsl(),
    clientOptions
);

function callUnary(client, methodName, request, metadata) {
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

function makeEnvelope(ch, t, payload, extra = {}) {
    return {
        v: 1,
        ch,
        t,
        id: extra.id || `native50052_${t}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ts: Date.now(),
        room: extra.room || "",
        payload: payload || {},
        requiresAck: !!extra.requiresAck,
        replyTo: extra.replyTo || ""
    };
}

function writeEnvelope(stream, envelope) {
    const rawJson = JSON.stringify(envelope);
    console.log("[NATIVE-50052-REALTIME] OUT", rawJson);
    stream.write({ rawJson });
}

async function createAccessToken() {
    const stamp = Date.now();
    const email = `native50052_rt_${stamp}@metaverse.local`;
    const password = "TestPass123";
    const userName = `native50052_rt_${stamp}`;

    console.log("[NATIVE-50052-REALTIME] Register request");
    const registerResponse = await callUnary(authClient, "Register", {
        email,
        password,
        userName
    });

    if (!registerResponse?.success || !registerResponse?.accessToken) {
        throw new Error(`register failed: ${JSON.stringify(registerResponse)}`);
    }

    console.log("[NATIVE-50052-REALTIME] Register OK");
    console.log(JSON.stringify({
        userId: registerResponse.user?.userId || registerResponse.user?.id || "",
        userName: registerResponse.user?.userName || "",
        hasAccessToken: !!registerResponse.accessToken
    }, null, 2));

    return registerResponse.accessToken;
}

async function main() {
    const accessToken = await createAccessToken();

    console.log("[NATIVE-50052-REALTIME] Opening stream");
    const stream = realtimeClient.Open();

    let gotPong = false;
    let gotAuthOk = false;
    let finished = false;

    const finishTimer = setTimeout(() => {
        if (finished) return;

        console.error("[NATIVE-50052-REALTIME] TIMEOUT");
        console.error(JSON.stringify({ gotPong, gotAuthOk }, null, 2));

        try {
            stream.end();
        } catch (_) {}

        process.exit(1);
    }, 12000);

    stream.on("data", (frame) => {
        const rawJson = frame?.rawJson || frame?.raw_json || "";
        console.log("[NATIVE-50052-REALTIME] IN", rawJson);

        let envelope = null;
        try {
            envelope = JSON.parse(rawJson);
        } catch (error) {
            console.error("[NATIVE-50052-REALTIME] invalid json frame");
            console.error(error);
            return;
        }

        if (envelope?.ch === "system" && envelope?.t === "pong") {
            gotPong = true;
        }

        if (envelope?.ch === "system" && envelope?.t === "auth_ok") {
            gotAuthOk = true;
        }

        if (gotPong && gotAuthOk && !finished) {
            finished = true;
            clearTimeout(finishTimer);

            console.log("[NATIVE-50052-REALTIME] OK");
            console.log(JSON.stringify({ gotPong, gotAuthOk }, null, 2));

            try {
                stream.end();
            } catch (_) {}

            process.exit(0);
        }
    });

    stream.on("error", (error) => {
        if (finished) return;

        console.error("[NATIVE-50052-REALTIME] STREAM ERROR");
        console.error(error);

        clearTimeout(finishTimer);
        process.exit(1);
    });

    stream.on("end", () => {
        if (finished) return;

        console.error("[NATIVE-50052-REALTIME] STREAM ENDED BEFORE OK");
        clearTimeout(finishTimer);
        process.exit(1);
    });

    setTimeout(() => {
        writeEnvelope(stream, makeEnvelope("system", "ping", { ts: Date.now() }));
    }, 300);

    setTimeout(() => {
        writeEnvelope(stream, makeEnvelope("system", "auth", { accessToken }));
    }, 700);
}

main().catch((error) => {
    console.error("[NATIVE-50052-REALTIME] ERROR");
    console.error(error);
    process.exit(1);
});
