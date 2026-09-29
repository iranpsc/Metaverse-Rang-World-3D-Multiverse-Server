import "dotenv/config";
import http from "node:http";
import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = 3_000;

function readRequiredPort(name) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} is invalid.`);
    return value;
}

function requestJson({ host, port, method, path, authorization = "", body = null }) {
    return new Promise((resolve, reject) => {
        const payload = body === null ? null : Buffer.from(JSON.stringify(body), "utf8");
        const headers = { Accept: "application/json" };
        if (authorization) headers.Authorization = authorization;
        if (payload) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = String(payload.length);
        }

        const request = http.request({ host, port, method, path, headers, timeout: REQUEST_TIMEOUT_MS }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.once("error", reject);
            response.once("end", () => {
                try {
                    const text = Buffer.concat(chunks).toString("utf8");
                    const value = JSON.parse(text || "{}");
                    resolve({ statusCode: Number(response.statusCode ?? 0), value });
                } catch (error) {
                    reject(new Error(`Invalid JSON response: ${String(error?.message ?? error)}`));
                }
            });
        });

        request.once("timeout", () => request.destroy(new Error("Request timed out.")));
        request.once("error", reject);
        if (payload) request.write(payload);
        request.end();
    });
}

function readTotalRooms(response) {
    const value = Number(response?.value?.scaling?.rooms?.totalRooms);
    if (!Number.isInteger(value) || value < 0) throw new Error("Backend room statistics are invalid.");
    return value;
}

function safe(value) {
    return String(value ?? "").replace(/[\r\n|]/g, "_");
}

async function run() {
    const host = String(process.env.VOICE_MEDIA_P11_BACKEND_HOST ?? "127.0.0.1").trim();
    const port = readRequiredPort("VOICE_MEDIA_P11_BACKEND_PORT");
    const secret = String(process.env.VOICE_MEDIA_NODE_BRIDGE_SECRET ?? "");
    if (!host) throw new Error("VOICE_MEDIA_P11_BACKEND_HOST is invalid.");
    if (secret.length < 32) throw new Error("VOICE_MEDIA_NODE_BRIDGE_SECRET is invalid.");

    const before = await requestJson({ host, port, method: "GET", path: "/health" });
    const roomsBefore = readTotalRooms(before);
    const connectedNodesBefore = Number(before?.value?.connectedNodes ?? 0);
    const backendHealthy = before.statusCode === 200 && before.value?.success === true && before.value?.status === "healthy" && before.value?.stopped === false;
    const nodesConnected = Number.isInteger(connectedNodesBefore) && connectedNodesBefore >= 2;

    const rejected = await requestJson({
        host,
        port,
        method: "POST",
        path: "/phase11/resolve-room",
        authorization: `Bearer ${secret}`,
        body: {
            accessToken: `invalid-${randomUUID()}`,
            roomId: `media-authorization-probe-${randomUUID()}`,
            controlConnectionId: randomUUID(),
            region: "",
            zone: "",
            transport: "grpc"
        }
    });

    const after = await requestJson({ host, port, method: "GET", path: "/health" });
    const roomsAfter = readTotalRooms(after);
    const connectedNodesAfter = Number(after?.value?.connectedNodes ?? 0);
    const invalidTokenRejected = rejected.statusCode === 403 && rejected.value?.success === false && rejected.value?.reason === "media_edge_authorization_failed";
    const unauthorizedRoomAssignment = roomsAfter !== roomsBefore;
    const nodesRemainConnected = connectedNodesAfter === connectedNodesBefore && connectedNodesAfter >= 2;
    const pass = backendHealthy && nodesConnected && invalidTokenRejected && !unauthorizedRoomAssignment && nodesRemainConnected;

    console.log(
        `VME2_PHASE13_MEDIA_AUTHORIZATION_LIVE=${pass ? "PASS" : "FAIL"}` +
        ` | backendHealthy=${backendHealthy}` +
        ` | invalidTokenRejected=${invalidTokenRejected}` +
        ` | unauthorizedRoomAssignment=${unauthorizedRoomAssignment}` +
        ` | roomsBefore=${roomsBefore}` +
        ` | roomsAfter=${roomsAfter}` +
        ` | connectedNodes=${connectedNodesAfter}` +
        ` | nodesRemainConnected=${nodesRemainConnected}` +
        " | probeReadOnly=True"
    );

    if (!pass) process.exitCode = 1;
}

run().catch((error) => {
    console.error(`VME2_PHASE13_MEDIA_AUTHORIZATION_LIVE=FAIL | error=${safe(error?.message ?? error)} | probeReadOnly=True`);
    process.exitCode = 1;
});
