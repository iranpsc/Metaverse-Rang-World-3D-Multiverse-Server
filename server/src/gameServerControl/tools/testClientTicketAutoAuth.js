import http from "http";
import readline from "readline";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { execFileSync } from "child_process";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

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

function requireValue(value, name) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (value !== undefined && value !== null && String(value).trim().length > 0) return String(value).trim();
    throw new Error(`${name}_required`);
}

function askVisible(questionText) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(questionText, (answer) => {
            rl.close();
            resolve(String(answer || "").trim());
        });
    });
}

function askHidden(questionText) {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        let value = "";

        stdout.write(questionText);
        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.setEncoding("utf8");

        function onData(char) {
            const text = String(char);

            if (text === "\u0003") {
                stdout.write("\n");
                process.exit(130);
            }

            if (text === "\r" || text === "\n") {
                stdin.setRawMode?.(false);
                stdin.pause();
                stdin.removeListener("data", onData);
                stdout.write("\n");
                resolve(value);
                return;
            }

            if (text === "\u007f" || text === "\b") {
                value = value.slice(0, -1);
                return;
            }

            value += text;
        }

        stdin.on("data", onData);
    });
}

async function readCredentials() {
    let username = readArg("username", process.env.MICROSERVICE_TEST_USERNAME || process.env.GSC_TEST_USERNAME || "");
    let password = readArg("password", process.env.MICROSERVICE_TEST_PASSWORD || process.env.GSC_TEST_PASSWORD || "");

    if (!username) username = await askVisible("Microservice username/email: ");
    if (!password) password = await askHidden("Microservice password: ");

    return {
        username: requireValue(username, "username"),
        password: requireValue(password, "password")
    };
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

async function createAccessTokenWithMicroservice({ username, password }) {
    const { connectDatabase } = await import("../../infra/mongo/connection.js");
    const { microserviceAuthUseCase } = await import("../../core/auth/microserviceAuth.instance.js");

    await connectDatabase();

    const result = await microserviceAuthUseCase.loginOrRegisterWithMicroservice({
        username,
        password,
        ip: "127.0.0.1",
        userAgent: "game-server-control-ticket-test/1.0"
    });

    if (!result?.success || !result?.accessToken) {
        throw new Error(result?.message || "microservice_auth_failed");
    }

    return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || "",
        user: result.user || {},
        email: username,
        internalAction: result.internalAction || "",
        authReason: "microservice_auth_ok"
    };
}

async function ensureDedicatedServerOnline({ httpHost, httpPort, serverId, dedicatedHost, dedicatedPort, roomId, region, zone, maxPlayers }) {
    const serviceToken = createServiceToken(serverId);

    const registerResponse = await createJsonRequest({
        method: "POST",
        host: httpHost,
        port: httpPort,
        path: "/game-server-control/dedicated/register",
        body: {
            serviceToken,
            serverId,
            host: dedicatedHost,
            port: dedicatedPort,
            roomId,
            region,
            zone,
            maxPlayers,
            currentPlayers: 0,
            status: "online",
            tickRate: 20,
            buildVersion: "microservice-auto-auth-test",
            metadata: {
                source: "test_client_ticket_auto_auth"
            }
        }
    });

    if (!registerResponse.json?.success) {
        throw new Error(`dedicated_register_failed:${registerResponse.text}`);
    }

    const heartbeatResponse = await createJsonRequest({
        method: "POST",
        host: httpHost,
        port: httpPort,
        path: "/game-server-control/dedicated/heartbeat",
        body: {
            serviceToken,
            serverId,
            roomId,
            region,
            zone,
            status: "online",
            fps: 60,
            tickRate: 20,
            currentPlayers: 0,
            maxPlayers,
            memoryMb: 512,
            cpuPercent: 18,
            pingMs: 0,
            uptimeSeconds: 0,
            metadata: {
                source: "test_client_ticket_auto_auth"
            }
        }
    });

    if (!heartbeatResponse.json?.success) {
        throw new Error(`dedicated_heartbeat_failed:${heartbeatResponse.text}`);
    }

    return {
        serviceToken,
        registerResponse,
        heartbeatResponse
    };
}

async function requestClientTicket({ httpHost, httpPort, accessToken, roomId, region, zone }) {
    const roomName = readArg("roomName", process.env.GSC_ROOM_NAME || roomId);
    const roomMaxPlayers = asInteger(readArg("roomMaxPlayers", process.env.GSC_ROOM_MAX_PLAYERS || "50"), 50);
    if (!Number.isInteger(roomMaxPlayers) || roomMaxPlayers < 1) throw new Error("roomMaxPlayers_invalid");

    return await createJsonRequest({
        method: "POST",
        host: httpHost,
        port: httpPort,
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
                source: "test_client_ticket_auto_auth",
                roomMaxPlayers
            }
        }
    });
}

async function verifyTicket({ httpHost, httpPort, serviceToken, ticketResponse }) {
    const data = ticketResponse.json?.data ?? {};
    const ticket = data.ticket ?? {};
    const connection = data.connection ?? {};

    if (data.userId === "fake_user_should_be_ignored") {
        throw new Error("body_user_id_was_accepted");
    }

    const serverId = requireValue(connection.serverId ?? ticket.serverId, "serverId");
    const roomId = requireValue(connection.roomId ?? ticket.roomId, "roomId");
    const userId = requireValue(data.userId ?? ticket.userId, "userId");
    const ticketId = requireValue(ticket.ticketId, "ticketId");
    const signature = requireValue(ticket.signature, "signature");
    const sessionId = requireValue(connection.sessionId ?? ticket.metadata?.sessionId, "sessionId");

    return await createJsonRequest({
        method: "POST",
        host: httpHost,
        port: httpPort,
        path: "/game-server-control/dedicated/verify-ticket",
        body: {
            serviceToken,
            serverId,
            roomId,
            userId,
            ticketId,
            signature,
            sessionId,
            connectionId: `microservice_auto_test_connection_${Date.now()}`,
            playerId: userId,
            userName: "gsc_microservice_test_user",
            metadata: {
                source: "test_client_ticket_auto_auth"
            }
        }
    });
}

function printSummary({ authResult, dedicatedResult, ticketResponse, verifyResponse }) {
    const ticketData = ticketResponse.json?.data ?? {};
    const ticket = ticketData.ticket ?? {};
    const connection = ticketData.connection ?? {};
    const verifyData = verifyResponse.json?.data ?? {};
    const verifySession = verifyData.session ?? {};
    const verifyPlayer = verifyData.player ?? {};

    console.log(JSON.stringify({
        auth: {
            reason: authResult.authReason,
            internalAction: authResult.internalAction,
            userId: authResult.user?.id || authResult.user?.userId || "",
            email: authResult.user?.email || ""
        },
        dedicated: {
            register: dedicatedResult.registerResponse.json?.reason || "",
            heartbeat: dedicatedResult.heartbeatResponse.json?.reason || ""
        },
        ticket: {
            success: ticketResponse.json?.success === true,
            reason: ticketResponse.json?.reason || "",
            userId: ticketData.userId || "",
            fakeUserIdAccepted: ticketData.userId === "fake_user_should_be_ignored",
            ticketId: ticket.ticketId || "",
            serverId: connection.serverId || ticket.serverId || "",
            host: connection.host || "",
            port: connection.port || 0,
            roomId: connection.roomId || ticket.roomId || "",
            sessionId: connection.sessionId || ticket.metadata?.sessionId || "",
            roomMaxPlayers: ticketData.roomCapacity?.roomMaxPlayers || ticket.metadata?.roomMaxPlayers || connection.roomMaxPlayers || 0
        },
        verify: {
            success: verifyResponse.json?.success === true,
            reason: verifyResponse.json?.reason || "",
            message: verifyResponse.json?.message || "",
            sessionId: verifySession.sessionId || "",
            currentPlayers: verifySession.currentPlayers || 0,
            userId: verifyPlayer.userId || ""
        }
    }, null, 2));
}

async function main() {
    const httpHost = readArg("httpHost", process.env.GSC_HTTP_HOST || "127.0.0.1");
    const httpPort = asInteger(readArg("httpPort", process.env.GSC_HTTP_PORT || "8080"), 8080);

    const serverId = readArg("serverId", process.env.GSC_SERVER_ID || "ds_vps_test_001");
    const dedicatedHost = readArg("dedicatedHost", process.env.GSC_DEDICATED_HOST || "127.0.0.1");
    const dedicatedPort = asInteger(readArg("dedicatedPort", process.env.GSC_DEDICATED_PORT || "7777"), 7777);
    const roomId = readArg("roomId", process.env.GSC_ROOM_ID || "room_vps_test_001");
    const region = readArg("region", process.env.GSC_REGION || "eu-central");
    const zone = readArg("zone", process.env.GSC_ZONE || "de-1");
    const maxPlayers = asInteger(readArg("maxPlayers", process.env.GSC_MAX_PLAYERS || "20"), 20);

    const credentials = await readCredentials();

    const dedicatedResult = await ensureDedicatedServerOnline({
        httpHost,
        httpPort,
        serverId,
        dedicatedHost,
        dedicatedPort,
        roomId,
        region,
        zone,
        maxPlayers
    });

    const authResult = await createAccessTokenWithMicroservice(credentials);

    const ticketResponse = await requestClientTicket({
        httpHost,
        httpPort,
        accessToken: authResult.accessToken,
        roomId,
        region,
        zone
    });

    if (!ticketResponse.json?.success) {
        printSummary({ authResult, dedicatedResult, ticketResponse, verifyResponse: { json: {} } });
        console.log(ticketResponse.text);
        process.exitCode = 2;
        return;
    }

    const verifyResponse = await verifyTicket({
        httpHost,
        httpPort,
        serviceToken: dedicatedResult.serviceToken,
        ticketResponse
    });

    printSummary({ authResult, dedicatedResult, ticketResponse, verifyResponse });

    if (!verifyResponse.json?.success) {
        console.log(verifyResponse.text);
        process.exitCode = 3;
        return;
    }

    console.log("game_server_control_microservice_auth_ticket_flow_ok");
}

main()
    .catch((error) => {
        console.error("game_server_control_microservice_auth_ticket_flow_failed");
        console.error(error?.stack || error?.message || String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {}
    });
