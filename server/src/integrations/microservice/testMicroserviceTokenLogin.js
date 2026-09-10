import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.microservice-test.local", override: true });

const { loginWithPassword, refreshAccessToken } = await import("./microserviceToken.client.js");

function maskToken(token) {
    if (!token || token.length < 16) return "***";
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function requireValue(value, name) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required`);
    return String(value).trim();
}

function printTokenResult(title, result) {
    console.log(title);
    console.log({
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        accessToken: maskToken(result.accessToken),
        refreshToken: maskToken(result.refreshToken)
    });
}

async function runLoginTest() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");
    const result = await loginWithPassword({ username, password });
    printTokenResult("Microservice login OK", result);
}

async function runRefreshFromLoginTest() {
    const username = requireValue(process.env.MICROSERVICE_TEST_USERNAME, "MICROSERVICE_TEST_USERNAME");
    const password = requireValue(process.env.MICROSERVICE_TEST_PASSWORD, "MICROSERVICE_TEST_PASSWORD");

    const loginResult = await loginWithPassword({ username, password });
    printTokenResult("Microservice login OK", loginResult);

    if (!loginResult.refreshToken) throw new Error("refresh_token is missing from login response");

    const refreshResult = await refreshAccessToken({ refreshToken: loginResult.refreshToken });
    printTokenResult("Microservice refresh OK", refreshResult);
}

async function runRefreshByEnvTest() {
    const refreshToken = requireValue(process.env.MICROSERVICE_TEST_REFRESH_TOKEN, "MICROSERVICE_TEST_REFRESH_TOKEN");
    const result = await refreshAccessToken({ refreshToken });
    printTokenResult("Microservice refresh OK", result);
}

const mode = process.argv[2] || "login-refresh";

try {
    if (mode === "login") await runLoginTest();
    else if (mode === "refresh") await runRefreshByEnvTest();
    else await runRefreshFromLoginTest();
} catch (error) {
    console.error("Microservice token test failed");
    console.error({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        statusCode: error?.statusCode
    });

    process.exit(1);
}
