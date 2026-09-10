// File => src/core/auth/microserviceAuth.instance.js

import { authService, userRepository } from "./auth.instance.js";
import { MicroserviceAuthUseCase } from "../../domain/auth/microserviceAuth.usecase.js";
import { MicroserviceTokenRepository } from "../../infra/mongo/models/repositories/microserviceToken.repository.js";
import { MicroserviceProfileRepository } from "../../infra/mongo/models/repositories/microserviceProfile.repository.js";

const microserviceTokenRepository = new MicroserviceTokenRepository();
const microserviceProfileRepository = new MicroserviceProfileRepository();

const microserviceAuthUseCase = new MicroserviceAuthUseCase({
    authService,
    userRepository,
    microserviceTokenRepository,
    microserviceProfileRepository
});

export {
    microserviceTokenRepository,
    microserviceProfileRepository,
    microserviceAuthUseCase
};
