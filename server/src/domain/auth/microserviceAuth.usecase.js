// File => src/domain/auth/microserviceAuth.usecase.js

import { AuthErrors } from "./authErrors.js";
import { loginWithPassword, MicroserviceTokenError } from "../../integrations/microservice/microserviceToken.client.js";
import { getMicroserviceMe, MicroserviceApiError } from "../../integrations/microservice/microserviceApi.client.js";
import { MicroserviceTokenRepository } from "../../infra/mongo/models/repositories/microserviceToken.repository.js";
import { MicroserviceProfileRepository } from "../../infra/mongo/models/repositories/microserviceProfile.repository.js";

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
    const text = normalizeText(value).toLowerCase();

    if (!text) {
        throw AuthErrors.invalidInput("username is required");
    }

    return text;
}

function mapMicroserviceError(error) {
    if (error instanceof MicroserviceTokenError && error.code === "MICROSERVICE_INVALID_GRANT") {
        return AuthErrors.unauth("invalid credentials");
    }

    if (error instanceof MicroserviceTokenError) {
        return AuthErrors.unauth(error.message || "microservice authentication failed");
    }

    if (error instanceof MicroserviceApiError) {
        return AuthErrors.unauth(error.message || "microservice profile request failed");
    }

    return error;
}

export class MicroserviceAuthUseCase {
    constructor({
        authService,
        userRepository,
        microserviceTokenRepository = new MicroserviceTokenRepository(),
        microserviceProfileRepository = new MicroserviceProfileRepository()
    }) {
        if (!authService) throw new Error("MicroserviceAuthUseCase: authService is required");
        if (!userRepository) throw new Error("MicroserviceAuthUseCase: userRepository is required");
        if (!microserviceTokenRepository) throw new Error("MicroserviceAuthUseCase: microserviceTokenRepository is required");
        if (!microserviceProfileRepository) throw new Error("MicroserviceAuthUseCase: microserviceProfileRepository is required");

        this.authService = authService;
        this.userRepository = userRepository;
        this.microserviceTokenRepository = microserviceTokenRepository;
        this.microserviceProfileRepository = microserviceProfileRepository;
    }

    async loginOrRegisterWithMicroservice({
        username,
        password,
        ip = "",
        userAgent = ""
    }) {
        const normalizedUsername = normalizeEmail(username);

        if (!password || typeof password !== "string") {
            throw AuthErrors.invalidInput("password is required");
        }

        let microserviceTokenSet;

        try {
            microserviceTokenSet = await loginWithPassword({
                username: normalizedUsername,
                password
            });
        } catch (error) {
            throw mapMicroserviceError(error);
        }

        const existingUser = await this.userRepository.findByEmail(normalizedUsername);
        const internalAction = existingUser ? "login" : "register";

        const internalResult = existingUser
            ? await this.authService.login({
                email: normalizedUsername,
                password,
                ip,
                userAgent
            })
            : await this.authService.register({
                email: normalizedUsername,
                password
            });

        const internalUserId = internalResult?.user?.id ?? internalResult?.user?.userId ?? "";

        if (!internalUserId) {
            throw AuthErrors.internal("internal user id is missing");
        }

        await this.microserviceTokenRepository.upsertTokenSet({
            userId: internalUserId,
            microserviceUserName: normalizedUsername,
            tokenSet: microserviceTokenSet,
            source: "login"
        });

        let microserviceMeResult;
        let microserviceProfile;

        try {
            microserviceMeResult = await getMicroserviceMe({
                accessToken: microserviceTokenSet.accessToken,
                tokenType: microserviceTokenSet.tokenType
            });

            microserviceProfile = await this.microserviceProfileRepository.upsertFromMePayload({
                userId: internalUserId,
                microserviceUserName: normalizedUsername,
                mePayload: microserviceMeResult.data
            });
        } catch (error) {
            throw mapMicroserviceError(error);
        }

        return {
            success: true,
            message: "ok",
            internalAction,
            accessToken: internalResult.accessToken,
            refreshToken: internalResult.refreshToken,
            expiresIn: internalResult.expiresIn,
            user: internalResult.user,
            microservice: {
                tokenSaved: true,
                profileSaved: true,
                tokenType: microserviceTokenSet.tokenType,
                expiresIn: microserviceTokenSet.expiresIn,
                scope: microserviceTokenSet.scope || "*",
                profile: {
                    microserviceId: microserviceProfile?.microserviceId || "",
                    name: microserviceProfile?.name || "",
                    code: microserviceProfile?.code || "",
                    avatar: microserviceProfile?.avatar || ""
                }
            }
        };
    }
}
