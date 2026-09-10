import http from "http";
import { execFileSync } from "child_process";

function readArg(name, fallback = "") {
    const prefix = `--${name}=`;
    const direct = process.argv.find((item) => item.startsWith(prefix));
    if (direct) return direct.slice(prefix.length).trim();

    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]).trim();

    return fallback;
}

function asInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function createJsonRequest({ method, host, port, path, headers = {}, body = {} }) {
    return new Promise((resolve) => {
        const rawBody = JSON.stringify(body);

        const req = http.request({
            method,
            host,
            port,
            path,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(rawBody),
                ...headers
            }
        }, (res) => {
            const chunks = [];

            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let json = null;

                try {
                    json = text ? JSON.parse(text) : null;
                } catch {
                    json = null;
                }

                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    text,
                    json
                });
            });
        });

        req.on("error", (error) => {
            resolve({
                statusCode: 0,
                headers: {},
                text: "",
                json: {
                    success: false,
                    reason: "http_request_failed",
                    message: error.message,
                    data: {}
                }
            });
        });

        req.write(rawBody);
        req.end();
    });
}

function createServiceToken(serverId) {
    const output = execFileSync(process.execPath, [
        "src/gameServerControl/tools/createGameServerServiceToken.js",
        `--serverId=${serverId}`
    ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });

    const parsed = JSON.parse(output);
    if (!parsed?.success || !parsed?.token) throw new Error("service_token_create_failed");

    return parsed.token;
}

function requireValue(value, name) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    throw new Error(`${name}_required`);
}

function printStep(title, response) {
    console.log("");
    console.log(`=== ${title} ===`);
    console.log(JSON.stringify({
        statusCode: response.statusCode,
        success: response.json?.success ?? false,
        reason: response.json?.reason ?? "",
        message: response.json?.message ?? ""
    }, null, 2));
}

function printTicketSummary(ticketResponse) {
    const data = ticketResponse.json?.data ?? {};
    const ticket = data.ticket ?? {};
    const connection = data.connection ?? {};

    console.log("");
    console.log("=== ticket_summary ===");
    console.log(JSON.stringify({
        success: ticketResponse.json?.success ?? false,
        reason: ticketResponse.json?.reason ?? "",
        userId: data.userId ?? "",
        fakeUserIdAccepted: data.userId === "fake_user_should_be_ignored",
        ticketId: ticket.ticketId ?? "",
        serverId: connection.serverId ?? ticket.serverId ?? "",
        host: connection.host ?? "",
        port: connection.port ?? 0,
        roomId: connection.roomId ?? ticket.roomId ?? "",
        sessionId: connection.sessionId ?? ticket.metadata?.sessionId ?? "",
        region: connection.region ?? "",
        zone: connection.zone ?? ""
    }, null, 2));
}

function printVerifySummary(verifyResponse) {
    const data = verifyResponse.json?.data ?? {};
    const ticket = data.ticket ?? {};
    const session = data.session ?? {};
    const player = data.player ?? {};

    console.log("");
    console.log("=== verify_summary ===");
    console.log(JSON.stringify({
        success: verifyResponse.json?.success ?? false,
        reason: verifyResponse.json?.reason ?? "",
        ticketId: ticket.ticketId ?? "",
        userId: player.userId ?? ticket.userId ?? "",
        sessionId: session.sessionId ?? "",
        currentPlayers: session.currentPlayers ?? 0
    }, null, 2));
}

async function main() {
    const host = readArg("host", process.env.GSC_HTTP_HOST || "127.0.0.1");
    const port = asInteger(readArg("port", process.env.GSC_HTTP_PORT || "8080"), 8080);
    const roomId = readArg("roomId", process.env.GSC_ROOM_ID || "room_vps_test_001");
    const roomName = readArg("roomName", process.env.GSC_ROOM_NAME || roomId);
    const roomMaxPlayers = asInteger(readArg("roomMaxPlayers", process.env.GSC_ROOM_MAX_PLAYERS || "50"), 50);
    const region = readArg("region", process.env.GSC_REGION || "eu-central");
    const zone = readArg("zone", process.env.GSC_ZONE || "");
    const accessToken = readArg("accessToken", process.env.ACCESS_TOKEN || "");

    requireValue(accessToken, "accessToken");
    requireValue(roomId, "roomId");
    if (!Number.isInteger(roomMaxPlayers) || roomMaxPlayers < 1) throw new Error("roomMaxPlayers_invalid");

    const ticketResponse = await createJsonRequest({
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
            zone
        }
    });

    printStep("client_ticket", ticketResponse);
    printTicketSummary(ticketResponse);

    const capacityData = ticketResponse.json?.data ?? {};
    const capacityRoom = capacityData.roomCapacity ?? {};
    const capacityTicketMetadata = capacityData.ticket?.metadata ?? {};
    const capacityConnection = capacityData.connection ?? {};

    console.log("");
    console.log("=== room_capacity_summary ===");
    console.log(JSON.stringify({
        requestedRoomMaxPlayers: roomMaxPlayers,
        responseRoomMaxPlayers: capacityRoom.roomMaxPlayers ?? 0,
        ticketMetadataRoomMaxPlayers: capacityTicketMetadata.roomMaxPlayers ?? 0,
        connectionRoomMaxPlayers: capacityConnection.roomMaxPlayers ?? 0
    }, null, 2));

    if (!ticketResponse.json?.success) {
        console.log("");
        console.log(ticketResponse.text);
        process.exit(2);
    }

    const data = ticketResponse.json.data ?? {};
    const ticket = data.ticket ?? {};
    const connection = data.connection ?? {};

    if (data.userId === "fake_user_should_be_ignored") {
        throw new Error("body_user_id_was_accepted");
    }

    const serverId = requireValue(connection.serverId ?? ticket.serverId, "serverId");
    const verifiedRoomId = requireValue(connection.roomId ?? ticket.roomId, "roomId");
    const userId = requireValue(data.userId ?? ticket.userId, "userId");
    const ticketId = requireValue(ticket.ticketId, "ticketId");
    const signature = requireValue(ticket.signature, "signature");
    const sessionId = requireValue(connection.sessionId ?? ticket.metadata?.sessionId, "sessionId");
    const serviceToken = createServiceToken(serverId);

    const verifyResponse = await createJsonRequest({
        method: "POST",
        host,
        port,
        path: "/game-server-control/dedicated/verify-ticket",
        body: {
            serviceToken,
            serverId,
            roomId: verifiedRoomId,
            userId,
            ticketId,
            signature,
            sessionId,
            connectionId: `test_connection_${Date.now()}`,
            playerId: userId,
            userName: "gsc_test_user",
            metadata: {
                source: "test_client_ticket_with_access_token"
            }
        }
    });

    printStep("dedicated_verify_ticket", verifyResponse);
    printVerifySummary(verifyResponse);

    if (!verifyResponse.json?.success) {
        console.log("");
        console.log(verifyResponse.text);
        process.exit(3);
    }

    console.log("");
    console.log("game_server_control_ticket_flow_ok");
}

main().catch((error) => {
    console.error("");
    console.error("game_server_control_ticket_flow_failed");
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
