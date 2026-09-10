const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const rootDir = "/home/world3d/apps/metaverse-server";
const protoPath = path.join(rootDir, "protos/health.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(rootDir, "protos")]
});

const loadedProto = grpc.loadPackageDefinition(packageDefinition);

const HealthService = loadedProto?.metaverse?.v1?.HealthService;

if (!HealthService) {
    console.error("[NATIVE-50052-HEALTH] HealthService پیدا نشد");
    console.error(JSON.stringify(Object.keys(loadedProto), null, 2));
    process.exit(1);
}

const client = new HealthService(
    "127.0.0.1:50052",
    grpc.credentials.createSsl(),
    {
        "grpc.ssl_target_name_override": "dev-world-3d.metarang.com",
        "grpc.default_authority": "dev-world-3d.metarang.com"
    }
);

const deadline = new Date(Date.now() + 8000);

client.Check({}, { deadline }, (error, response) => {
    if (error) {
        console.error("[NATIVE-50052-HEALTH] ERROR");
        console.error(error);
        process.exit(1);
    }

    console.log("[NATIVE-50052-HEALTH] OK");
    console.log(JSON.stringify(response, null, 2));
    process.exit(0);
});
