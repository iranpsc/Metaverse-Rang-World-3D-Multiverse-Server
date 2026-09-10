// src/core/auth/auth.instance.js
//repository ها، token service و auth service را می سازد و به هم وصل می کند تا بقیه سیستم dependency آماده داشته باشند.‬

//** When Call at auth.handler.js << import { authService, tokenService } from "../../../core/auth/auth.instance.js";>> This file is executed and creates the necessary objects. */

import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";

// Mongo repositories
import { UserRepository } from "../../infra/mongo/models/repositories/user.repository.js";
import { RefreshTokenRepository } from "../../infra/mongo/models/repositories/refreshToken.repository.js";

import cfg from "../../config/env.js";

/**
 * Composition Root for AuthService
 */

const userRepository = new UserRepository();
const refreshTokenRepository = new RefreshTokenRepository();

const tokenService = new TokenService({
    config: cfg,
    refreshTokenRepository
});

const authService = new AuthService({
    userRepository,
    refreshTokenRepository,
    tokenService
});

export {
    userRepository,
    refreshTokenRepository,
    tokenService,
    authService
};
/* 
فایل src / core / auth / auth.instance.js محل ساخت و اتصال instanceهای اصلی بخش Auth است.این فایل ابتدا UserRepository و RefreshTokenRepository را می‌سازد، سپس با استفاده از cfg و refreshTokenRepository یک نمونه از TokenService ایجاد می‌کند و در نهایت با اتصال userRepository، refreshTokenRepository و tokenService یک نمونه از AuthService می‌سازد.

این فایل باعث می‌شود handlerها و interceptorها مجبور نباشند خودشان repositoryها و serviceها را بسازند.در نتیجه auth.handler.js فقط authService را import می‌کند و متدهایی مثل register، login و refresh را صدا می‌زند، و auth.interceptor.js هم از همان tokenService برای verify کردن access token استفاده می‌کند. */