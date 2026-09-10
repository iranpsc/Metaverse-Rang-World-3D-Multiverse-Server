// File => src/realTime/router/index.js

export { RealtimeRouteRegistry, createRealtimeRouteRegistry } from "./routeRegistry.js";
export { dispatch, dispatchByChannel, createRealtimeRouter, registerDefaultRealtimeRoutes, defaultRouteRegistry } from "./realtimeRouter.js";
export { systemRoutes, registerSystemRoutes } from "./systemRoutes.js";
export { presenceRoutes, registerPresenceRoutes } from "./presenceRoutes.js";
export { worldRoutes, registerWorldRoutes } from "./worldRoutes.js";
export { gameRoutes, registerGameRoutes } from "./gameRoutes.js";
export { chatRoutes, registerChatRoutes } from "./chatRoutes.js";
export { npcRoutes, registerNpcRoutes } from "./npcRoutes.js";
export { lobbyRoutes, registerLobbyRoutes } from "./lobbyRoutes.js";
/*
توضیح کلی اسکریپت:
این فایل خروجی مرکزی رُتِرهای ریل تایم است.
هدف این است که فایل های دیگر به جای ایمپورت های پراکنده، مسیرهای رُتِر را از یک نقطه بگیرند.
این فایل هیچ لاجیک اجرایی ندارد و فقط اکسپورت های مربوط به رُتِر و هَندلِر رجیستری را یکجا می کند.
*/
