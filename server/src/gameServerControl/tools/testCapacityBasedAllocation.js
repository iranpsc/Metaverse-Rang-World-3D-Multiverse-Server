import { execFileSync } from "child_process";
import http from "http";

function readArg(name, fallbackValue = "") {
    const prefix = `--${name}=`;
    const arg = process.argv.find((item) => item.startsWith(prefix));
    if (!arg) return fallbackValue;
    return arg.slice(prefix.length);
}

function asInteger(value, fallbackValue) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function createJsonRequest({ method, host, port, path, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : "";
        const req = http.request({
            method,
            host,
            port,
            path,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
                ...headers
            }
        }, (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => text += chunk);
            res.on("end", () => {
                let json = null;
                try {
                    json = text ? JSON.parse(text) : null;
                } catch {
                    json = null;
                }

                resolve({
                    statusCode: res.statusCode,
                    text,
                    json
                });
            });
        });

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function createServiceToken(serverId) {
    const output = execFileSync(
        process.execPath,
        ["src/gameServerControl/tools/createGameServerServiceToken.js", `--serverId=${serverId}`],
        {
            cwd: process.cwd(),
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"]
        }
    );

    const parsed = JSON.parse(output);
    if (!parsed?.success || !parsed?.token) throw new Error("service_token_create_failed");
    return parsed.token;
}

async function createAccessTokenWithMicroservice({ username, password }) {
    const { connectDatabase } = await import("../../infra/mongo/connection.js");
    const { microserviceAuthUseCase } = await import("../../core/auth/microserviceAuth.instance.js");

    await connectDatabase();

    const result = await microserviceAuthUseCase.loginOrRegisterWithMicroservice({
        username,
        password,
        ip: "127.0.0.1",
        userAgent: "capacity-based-allocation-test/1.0"
    });

    if (!result?.success || !result?.accessToken) {
        throw new Error(result?.message || "microservice_auth_failed");
    }

    return {
        accessToken: result.accessToken,
        user: result.user || {},
        email: username
    };
}

async function registerDedicatedServer({ host, port, serverId, dedicatedHost, dedicatedPort, region, zone, maxPlayers }) {
    const serviceToken = createServiceToken(serverId);

    const registerResponse = await createJsonRequest({
        method: "POST",
        host,
        port,
        path: "/game-server-control/dedicated/register",
        body: {
            serviceToken,
            serverId,
            host: dedicatedHost,
            port: dedicatedPort,
            roomId: "",
            roomName: "",
            region,
            zone,
            maxPlayers,
            currentPlayers: 0,
            status: "online",
            tickRate: 20,
            buildVersion: "capacity-based-allocation-test",
            metadata: {
                source: "test_capacity_based_allocation"
            }
        }
    });

    const heartbeatResponse = await createJsonRequest({
        method: "POST",
        host,
        port,
        path: "/game-server-control/dedicated/heartbeat",
        body: {
            serviceToken,
            serverId,
            roomId: "",
            roomName: "",
            region,
            zone,
            status: "online",
            fps: 60,
            tickRate: 20,
            currentPlayers: 0,
            maxPlayers,
            memoryMb: 512,
            cpuPercent: 10,
            pingMs: 0,
            uptimeSeconds: 1,
            metadata: {
                source: "test_capacity_based_allocation"
            }
        }
    });

    if (!registerResponse.json?.success) {
        throw new Error(`dedicated_register_failed:${registerResponse.text}`);
    }

    if (!heartbeatResponse.json?.success) {
        throw new Error(`dedicated_heartbeat_failed:${heartbeatResponse.text}`);
    }

    return {
        serviceToken,
        registerResponse,
        heartbeatResponse
    };
}

async function requestTicket({ host, port, accessToken, roomId, roomName, roomMaxPlayers, region, zone }) {
    return await createJsonRequest({
        method: "POST",
        host,
        port,
        path: "/game-server-control/client/ticket",
        headers: {
            Authorization: `Bearer ${accessToken}`
        },
        body: {
            userId: "fake_user_should_be_ignored",
            roomId,
            roomName,
            roomMaxPlayers,
            region,
            zone,
            metadata: {
                source: "test_capacity_based_allocation"
            }
        }
    });
}

async function getStatus({ host, port }) {
    return await createJsonRequest({
        method: "GET",
        host,
        port,
        path: "/game-server-control/status"
    });
}

async function main() {
    const host = readArg("host", process.env.GSC_HTTP_HOST || "127.0.0.1");
    const port = asInteger(readArg("port", process.env.GSC_HTTP_PORT || "8080"), 8080);
    const serverId = readArg("serverId", process.env.GSC_SERVER_ID || `ds_capacity_${Date.now()}`);
    const dedicatedHost = readArg("dedicatedHost", "127.0.0.1");
    const dedicatedPort = asInteger(readArg("dedicatedPort", "7799"), 7799);
    const region = readArg("region", "eu-central");
    const zone = readArg("zone", "de-1");
    const maxPlayers = asInteger(readArg("maxPlayers", "200"), 200);
    const roomMaxPlayers = asInteger(readArg("roomMaxPlayers", "50"), 50);
    const roomCount = asInteger(readArg("roomCount", "4"), 4);
    const username = readArg("username", process.env.MICROSERVICE_TEST_USERNAME || "");
    const password = readArg("password", process.env.MICROSERVICE_TEST_PASSWORD || "");
    if (!username || !password) throw new Error("MICROSERVICE_TEST_USERNAME and MICROSERVICE_TEST_PASSWORD are required");

    const auth = await createAccessTokenWithMicroservice({ username, password });

    await registerDedicatedServer({
        host,
        port,
        serverId,
        dedicatedHost,
        dedicatedPort,
        region,
        zone,
        maxPlayers
    });

    const tickets = [];

    for (let index = 1; index <= roomCount; index++) {
        const roomId = `capacity_room_${index}_${serverId}`;
        const ticketResponse = await requestTicket({
            host,
            port,
            accessToken: auth.accessToken,
            roomId,
            roomName: `Capacity Room ${index}`,
            roomMaxPlayers,
            region,
            zone
        });

        tickets.push({
            roomId,
            success: ticketResponse.json?.success ?? false,
            reason: ticketResponse.json?.reason ?? "",
            serverId: ticketResponse.json?.data?.ticket?.serverId ?? "",
            roomMaxPlayers: ticketResponse.json?.data?.roomCapacity?.roomMaxPlayers ?? 0,
            reservedPlayers: ticketResponse.json?.data?.roomReservation?.reservedPlayers ?? 0,
            availableReservedSlots: ticketResponse.json?.data?.roomReservation?.availableReservedSlots ?? 0
        });

        if (!ticketResponse.json?.success) {
            console.log(JSON.stringify({
                failedAtRoom: roomId,
                ticketResponse: ticketResponse.json
            }, null, 2));
            process.exit(2);
        }
    }

    const overflowRoomId = `capacity_room_overflow_${serverId}`;
    const overflowResponse = await requestTicket({
        host,
        port,
        accessToken: auth.accessToken,
        roomId: overflowRoomId,
        roomName: "Capacity Room Overflow",
        roomMaxPlayers,
        region,
        zone
    });

    const statusResponse = await getStatus({ host, port });

    console.log(JSON.stringify({
        auth: {
            email: auth.email,
            userId: auth.user?.userId || auth.user?.id || ""
        },
        server: {
            serverId,
            maxPlayers
        },
        tickets,
        overflow: {
            roomId: overflowRoomId,
            success: overflowResponse.json?.success ?? false,
            reason: overflowResponse.json?.reason ?? "",
            serverId: overflowResponse.json?.data?.ticket?.serverId ?? "",
            roomMaxPlayers: overflowResponse.json?.data?.roomCapacity?.roomMaxPlayers ?? 0,
            reservedPlayers: overflowResponse.json?.data?.roomReservation?.reservedPlayers ?? 0,
            availableReservedSlots: overflowResponse.json?.data?.roomReservation?.availableReservedSlots ?? 0
        },
        registry: statusResponse.json?.data?.registry ?? {}
    }, null, 2));

    console.log("capacity_based_allocation_test_done");
}

main().catch((error) => {
    console.error("capacity_based_allocation_test_failed");
    console.error(error);
    process.exit(1);
});
