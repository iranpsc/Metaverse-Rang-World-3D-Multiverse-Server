// File => src/realTime/router/realtimeRouter.js

import { Channels } from "../protocol/channels.js";
import { createRealtimeRouteRegistry } from "./routeRegistry.js";
import { registerSystemRoutes, systemRoutes } from "./systemRoutes.js";
import { registerPresenceRoutes, presenceRoutes } from "./presenceRoutes.js";
import { registerWorldRoutes, worldRoutes } from "./worldRoutes.js";
import { registerGameRoutes, gameRoutes } from "./gameRoutes.js";
import { registerChatRoutes, chatRoutes } from "./chatRoutes.js";
import { registerNpcRoutes, npcRoutes } from "./npcRoutes.js";
import { registerLobbyRoutes, lobbyRoutes } from "./lobbyRoutes.js";

//* این تابع همه مسیرهای پیش فرض ریل تایم را روی رجیستری مسیر ثبت می کند.
function registerDefaultRealtimeRoutes(routeRegistry) {
    registerSystemRoutes(routeRegistry);//در ان تابع رجیسترمِنی در رت رجیستری فراخوانی شده وهمه مسیرها در در متغییر لیست  روتز قرار میدهد 
    registerPresenceRoutes(routeRegistry);
    registerWorldRoutes(routeRegistry);
    registerGameRoutes(routeRegistry);
    registerLobbyRoutes(routeRegistry);
    registerChatRoutes(routeRegistry);
    registerNpcRoutes(routeRegistry);
    return routeRegistry;
}
//*استفاده نمی شود
//یک بار یک نمونه از روت رجیستری ایجاد میکند  -- هر فایل روت با تابع رجیستر مِنی روت های خودش را در متغییر روتزِ اینفایل ذخیره میکند 
const defaultRouteRegistry = registerDefaultRealtimeRoutes(createRealtimeRouteRegistry());
//* فعلا استفاده نمی شود
//* این تابع اِنولوپ را با رجیستری پیش فرض بر اساس چَنِل و تایپ به هَندلِر درست می فرستد.
async function dispatch(ctx, env, server = null) {
    return await defaultRouteRegistry.dispatch(ctx, env, server);
}
//* شروع کلاس و ایجاد و ثبت مسیرها در رجیستری
//* این تابع یک رُتِر قابل تزریق می سازد تا کُر ریل تایم بتواند آن را مثل تابع ساده صدا بزند.
function createRealtimeRouter({ logger = null, routeRegistry = null } = {}) {
    const registry = routeRegistry ?? registerDefaultRealtimeRoutes(createRealtimeRouteRegistry({ logger }));

    const router = async (ctx, env, server = null) => await registry.dispatch(ctx, env, server);
    router.registry = registry;
    router.getSnapshot = () => registry.getSnapshot();
    return router;
}

//* این تابع مسیرهای قدیمی بر اساس چَنِل را حفظ می کند تا اگر جایی هنوز مستقیم صدا زده شد، پروژه نشکند.
function dispatchByChannel(ctx, env, server = null) {
    switch (env?.ch) {
        case Channels.presence: return presenceRoutes(ctx, env, server);
        case Channels.world: return worldRoutes(ctx, env, server);
        case Channels.game: return gameRoutes(ctx, env, server);
        case Channels.lobby: return lobbyRoutes(ctx, env, server);
        case Channels.chat: return chatRoutes(ctx, env, server);
        case Channels.npc: return npcRoutes(ctx, env, server);
        case Channels.system: return systemRoutes(ctx, env, server);
        default: return false;
    }
}

/*
توضیح کلی اسکریپت:
این فایل رُتِر اصلی ریل تایم را مدیریت می کند.
رُتِر پیام های معتبر را بر اساس چَنِل و تایپ به هَندلِر درست می فرستد.
در این نسخه، مسیرها از راه رجیستری مسیر ثبت می شوند تا اضافه کردن مسیرهای جدید ساده و قابل تست باشد.
تابع دیسپچ قدیمی حفظ شده است تا فایل های قبلی که آن را ایمپورت می کنند نشکنند.
این فایل نباید ترنسپورت خام، آث واقعی، دیتابیس یا لاجیک بازی سنگین اجرا کند.
وظیفه این فایل فقط وصل کردن اِنولوپ معتبر به هَندلِر مناسب است.
*/

export { dispatch, dispatchByChannel, createRealtimeRouter, registerDefaultRealtimeRoutes, defaultRouteRegistry };
