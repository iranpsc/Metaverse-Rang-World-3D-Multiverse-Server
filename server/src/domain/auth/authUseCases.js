// src/domain/auth/authUseCases.js

import { authService } from "../../core/auth/auth.instance.js";

/**
 * register
 * Wrapper روی AuthService.register
 */
export async function register(email, password) {
    return authService.register({
        email,
        password
    });
}

/**
 * login
 * Wrapper روی AuthService.login
 */
export async function login(email, password) {
    return authService.login({
        email,
        password
    });
}

/**
 * refresh
 * Wrapper روی AuthService.refresh
 * امضای تابع حفظ شده و فقط پارامترهای اختیاری اضافه شده‌اند
 */
export async function refresh(refreshToken, userAgent = "", ip = "") {
    return authService.refresh({
        refreshToken,
        userAgent,
        ip
    });
}

/**
 * getUserDataFromUser
 * Wrapper روی AuthService.getUserData
 */
export async function getUserDataFromUser(userFromAuth) {
    const userId = userFromAuth?.id ?? userFromAuth?.userId ?? "";

    return authService.getUserData({
        userId
    });
}