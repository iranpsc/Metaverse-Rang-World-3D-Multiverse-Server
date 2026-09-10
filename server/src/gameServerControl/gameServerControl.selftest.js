// File => src/gameServerControl/gameServerControl.selftest.js

import { createGameServerControl } from "./index.js";

const SELFTEST_SECRET = "phase1_selftest_secret_123";
const SELFTEST_SERVER_ID = "ds_selftest_001";
const SELFTEST_ROOM_ID = "room_selftest_001";
const SELFTEST_USER_ID = "user_selftest_001";

//* این تابع خروجی مرحله تست را خواناتر چاپ می کند.
function printStep(title, value) {
    console.log(`\n========== ${title} ==========`);
    console.log(JSON.stringify(value, null, 2));
}

//* این تابع شرط تست را بررسی می کند و اگر خطا باشد تست را متوقف می کند.
function assertTest(condition, message, data = {}) {
    if (condition) return;

    const error = new Error(`[GameServerControlSelfTest] ${message}`);
    error.data = data;
    throw error;
}

//* این تابع تست کامل فاز یک ماژول کنترل گیم سرور را اجرا می کند.
async function runGameServerControlSelfTest() {
    const control = createGameServerControl({
        config: {
            enabled: true,
            defaultHost: "127.0.0.1",
            defaultPort: 7777,
            ticketTtlSeconds: 60,
            heartbeatTimeoutSeconds: 15,
            maxPlayersPerInstance: 20,
            cleanupIntervalSeconds: 10,
            serviceSecret: SELFTEST_SECRET
        }
    });

    try {
        const startResult = control.start();
        printStep("START", startResult);
        assertTest(startResult.success === true, "Start result must be success.", startResult);

        const serviceToken = control.serviceTokenService.createToken({
            serverId: SELFTEST_SERVER_ID,
            metadata: {
                test: "phase_1_selftest"
            }
        });

        printStep("SERVICE_TOKEN_CREATED", {
            tokenPrefix: serviceToken.slice(0, 20),
            serverId: SELFTEST_SERVER_ID
        });

        const registerResult = await control.dedicatedServerHandler.registerDedicatedServer({}, {
            serviceToken,
            serverId: SELFTEST_SERVER_ID,
            host: "127.0.0.1",
            port: 7777,
            roomId: SELFTEST_ROOM_ID,
            region: "eu-central",
            zone: "de-1",
            maxPlayers: 20,
            currentPlayers: 0,
            status: "online",
            tickRate: 20,
            buildVersion: "selftest"
        });

        printStep("REGISTER_DEDICATED_SERVER", registerResult);
        assertTest(registerResult.success === true, "Dedicated server register must be success.", registerResult);
        assertTest(registerResult.data.server.serverId === SELFTEST_SERVER_ID, "Registered serverId mismatch.", registerResult);

        const ticketResult = await control.clientHandler.requestGameServerTicket(
            { userId: SELFTEST_USER_ID },
            {
                roomId: SELFTEST_ROOM_ID,
                region: "eu-central",
                minFreeSlots: 1,
                metadata: {
                    test: "phase_1_selftest"
                }
            }
        );

        printStep("CLIENT_REQUEST_TICKET", ticketResult);
        assertTest(ticketResult.success === true, "Client ticket request must be success.", ticketResult);
        assertTest(ticketResult.data.ticket.ticketId, "Ticket id must exist.", ticketResult);
        assertTest(ticketResult.data.connection.serverId === SELFTEST_SERVER_ID, "Ticket connection serverId mismatch.", ticketResult);

        const ticket = ticketResult.data.ticket;
        const connection = ticketResult.data.connection;

        const verifyResult = await control.dedicatedServerHandler.verifyGameTicket({}, {
            serviceToken,
            serverId: connection.serverId,
            roomId: connection.roomId,
            userId: SELFTEST_USER_ID,
            ticketId: ticket.ticketId,
            signature: ticket.signature,
            sessionId: connection.sessionId,
            connectionId: "conn_selftest_001",
            playerId: "player_selftest_001",
            userName: "Selftest Player"
        });

        printStep("VERIFY_GAME_TICKET", verifyResult);
        assertTest(verifyResult.success === true, "Verify ticket must be success.", verifyResult);
        assertTest(verifyResult.data.session.currentPlayers === 1, "Session currentPlayers must be 1 after verify.", verifyResult);

        const doubleVerifyResult = await control.dedicatedServerHandler.verifyGameTicket({}, {
            serviceToken,
            serverId: connection.serverId,
            roomId: connection.roomId,
            userId: SELFTEST_USER_ID,
            ticketId: ticket.ticketId,
            signature: ticket.signature,
            sessionId: connection.sessionId,
            connectionId: "conn_selftest_001",
            playerId: "player_selftest_001",
            userName: "Selftest Player"
        });

        printStep("DOUBLE_VERIFY_SHOULD_FAIL", doubleVerifyResult);
        assertTest(doubleVerifyResult.success === false, "Double verify must fail because ticket is one-time.", doubleVerifyResult);

        const heartbeatResult = await control.dedicatedServerHandler.heartbeatDedicatedServer({}, {
            serviceToken,
            serverId: SELFTEST_SERVER_ID,
            roomId: SELFTEST_ROOM_ID,
            region: "eu-central",
            zone: "de-1",
            status: "online",
            fps: 60,
            tickRate: 20,
            currentPlayers: 1,
            maxPlayers: 20,
            memoryMb: 512,
            cpuPercent: 20,
            uptimeSeconds: 10,
            metadata: {
                test: "phase_1_selftest"
            }
        });

        printStep("HEARTBEAT", heartbeatResult);
        assertTest(heartbeatResult.success === true, "Heartbeat must be success.", heartbeatResult);
        assertTest(heartbeatResult.data.server.currentPlayers === 1, "Server currentPlayers must be 1 after heartbeat.", heartbeatResult);

        const statusResult = control.getStatus();
        printStep("CONTROL_STATUS", statusResult);
        assertTest(statusResult.success === true, "Control status must be success.", statusResult);
        assertTest(statusResult.data.registry.total === 1, "Registry total must be 1.", statusResult);
        assertTest(statusResult.data.sessions.active === 1, "Active sessions must be 1.", statusResult);
        assertTest(statusResult.data.tickets.consumed === 1, "Consumed tickets must be 1.", statusResult);

        const leftResult = await control.dedicatedServerHandler.reportPlayerLeft({}, {
            serviceToken,
            serverId: SELFTEST_SERVER_ID,
            sessionId: connection.sessionId,
            userId: SELFTEST_USER_ID
        });

        printStep("PLAYER_LEFT", leftResult);
        assertTest(leftResult.success === true, "Player left must be success.", leftResult);
        assertTest(leftResult.data.session.currentPlayers === 0, "Session currentPlayers must be 0 after player left.", leftResult);

        const finalStatusResult = control.getStatus();
        printStep("FINAL_STATUS", finalStatusResult);
        assertTest(finalStatusResult.data.registry.totalPlayers === 0, "Registry totalPlayers must be 0 at final status.", finalStatusResult);

        const stopResult = control.stop();
        printStep("STOP", stopResult);
        assertTest(stopResult.success === true, "Stop result must be success.", stopResult);

        printStep("SELFTEST_RESULT", {
            success: true,
            message: "GameServerControl phase 1 selftest passed."
        });
    } catch (error) {
        try {
            control.stop();
        } catch {
            // هیچ کاری لازم نیست.
        }

        console.error("\n========== SELFTEST_FAILED ==========");
        console.error(error.message);

        if (error.data) {
            console.error(JSON.stringify(error.data, null, 2));
        }

        process.exitCode = 1;
    }
}

await runGameServerControlSelfTest();

// این فایل فقط تست مستقل فاز یک ماژول کنترل گیم سرور را اجرا می کند و هیچ اتصال به استارتاپ اصلی سرور ایجاد نمی کند.
