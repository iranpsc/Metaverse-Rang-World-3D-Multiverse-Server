// File => src/realTime/index.js

import { WebSocketRealtimeTransport } from "./transport/websocket/websocketTransport.js";
import { createRealtimeServer } from "./core/realtimeServer.js";
import { createRealtimeRouter } from "./router/realtimeRouter.js";
import { ClientsRegistry } from "./clientsRegistry.js";
import { RoomManager } from "./roomManager.js";
import { createGameServices } from "./modules/game/index.js";
import { makeFloodProtection } from "./stability/floodProtection.js";
import { createAckTracker } from "./stability/ackTracker.js";
import { startHeartbeat } from "./stability/heartbeat.js";
import { cleanupRealtimeConnection } from "./stability/disconnectCleanup.js";
import { RoomDirectoryService } from "./lobby/roomDirectoryService.js";
import { broadcastRoomUpdatedToRealtimeRoom } from "./lobby/roomUpdateBroadcastService.js";
//* این تابع فلاد پروتکشن را قبل از پَرس اِنولوپ اجرا می کند تا پیام های اسپم وارد کُر نشوند.
function runRealtimeFloodProtection(ctx, floodProtection, logger = null) {
  if (!floodProtection?.allow(ctx)) {
    logger?.warn?.("Realtime message blocked by flood protection", { connectionId: ctx?.connectionId, userId: ctx?.user?.id ?? ctx?.user?.userId ?? "" });
    return false;
  }

  return true;
}

//* این تابع بعد از پَرس اِنولوپ، اَک های دریافتی را به اَک ترَکِر تحویل می دهد و مسیر رُتِر را باز نگه می دارد.
function resolveRealtimeAckEnvelope(envelope, ackTracker) {
  ackTracker?.resolve?.(envelope);
  return true;
}

//* این تابع هارت بیت وب سوکت را برای کانکشن تازه شروع می کند و تابع توقف آن را داخل کانتکست نگه می دارد.
function attachRealtimeHeartbeatToContext(ctx, logger = null) {
  const socket = ctx?.connection?.socket;
  if (!socket) return false;

  ctx.meta.stopHeartbeat = startHeartbeat(socket, {
    logger,
    onTimeout: () => {
      logger?.warn?.("Realtime heartbeat timeout", { connectionId: ctx?.connectionId });
      ctx?.realtimeConnection?.close?.(4000, "heartbeat_timeout");
    }
  });

  return true;
}

//* این تابع شناسه روم های کانکشن را قبل از کلیناپ می خواند تا بعد از حذف عضویت، فرصت برادکست خروج از دست نرود.
function readRealtimeRoomIdsBeforeCleanup(ctx) {
  const connection = ctx?.realtimeConnection ?? ctx?.connection;
  const roomIds = typeof ctx?.rooms?.getConnectionRooms === "function" ? ctx.rooms.getConnectionRooms(connection) : [];
  const cleanRoomIds = [...new Set(roomIds.map((roomId) => String(roomId ?? "").trim()).filter(Boolean))];
  const fallbackRoomId = String(ctx?.roomId ?? "").trim();
  if (cleanRoomIds.length === 0 && fallbackRoomId) cleanRoomIds.push(fallbackRoomId);
  return cleanRoomIds;
}

//* این تابع یک اِنولوپ سبک برای پرزنس دیسکانکت می سازد تا مسیر خروج اجباری هم مثل لیو روم دستی دیده شود.
function makeRealtimeDisconnectPresenceEnvelope(ctx, roomId, closeInfo = null) {
  return {
    id: `disconnect_${ctx?.connectionId ?? "unknown"}_${Date.now()}`,
    room: String(roomId ?? ""),
    payload: {
      roomId: String(roomId ?? ""),
      data: { reason: "disconnect", closeInfo }
    }
  };
}

//* این تابع قبل از حذف کانکشن از روم ها، پیام خروج پلیر را برای اعضای باقی مانده برادکست می کند.
function broadcastRealtimeDisconnectPresence(ctx, roomIds = [], closeInfo = null, gameServices = null, logger = null) {
  if (!ctx || !gameServices?.presenceService || roomIds.length === 0) return { roomCount: 0, sent: 0 };

  let sent = 0;
  for (const roomId of roomIds) {
    try {
      const envelope = makeRealtimeDisconnectPresenceEnvelope(ctx, roomId, closeInfo);
      const result = gameServices.presenceService.broadcastPlayerLeft(ctx, envelope, roomId);
      sent += Number(result?.sent ?? 0);
    } catch (error) {
      logger?.warn?.("Realtime disconnect presence broadcast failed", {
        connectionId: ctx?.connectionId ?? "",
        roomId,
        error: error?.message ?? String(error)
      });
    }
  }

  logger?.info?.("Realtime disconnect presence broadcast completed", {
    connectionId: ctx?.connectionId ?? "",
    userId: ctx?.user?.id ?? ctx?.user?.userId ?? "",
    roomCount: roomIds.length,
    sent
  });

  return { roomCount: roomIds.length, sent };
}

//* این تابع بعد از حذف کانکشن، شمارنده آنلاین روم ها را در دایرکتوری روم آپدیت می کند.
function updateRealtimeRoomDirectoryAfterDisconnect(ctx, roomIds = [], roomDirectoryService = null, logger = null) {
  if (!ctx || !roomDirectoryService || roomIds.length === 0) {
    return { scheduled: false, roomCount: 0 };
  }

  const tasks = roomIds.map(async (roomId) => {
    const connectionCount = typeof ctx?.rooms?.getRoomSize === "function"
      ? ctx.rooms.getRoomSize(roomId)
      : 0;
    const onlineCount = typeof ctx?.rooms?.getRoomUserCount === "function"
      ? ctx.rooms.getRoomUserCount(roomId)
      : connectionCount;

    const updatedRoom = await roomDirectoryService.markUserLeft(roomId, onlineCount);
    const roomUpdateBroadcast = broadcastRoomUpdatedToRealtimeRoom(ctx, updatedRoom, {
      source: "websocket_disconnect",
      logger
    });

    logger?.info?.("Realtime disconnect room directory updated", {
      roomId,
      connectionCount,
      userCount: onlineCount,
      roomUpdateSent: roomUpdateBroadcast.sent ?? 0,
      status: updatedRoom?.status ?? "",
      onlineCount: updatedRoom?.onlineCount ?? onlineCount
    });

    return {
      roomId,
      connectionCount,
      userCount: onlineCount,
      roomUpdateSent: roomUpdateBroadcast.sent ?? 0,
      status: updatedRoom?.status ?? "",
      onlineCount: updatedRoom?.onlineCount ?? onlineCount
    };
  });

  Promise.allSettled(tasks).then((results) => {
    const failed = results.filter((item) => item.status === "rejected");

    if (failed.length > 0) {
      logger?.warn?.("Realtime disconnect room directory update partially failed", {
        roomCount: roomIds.length,
        failedCount: failed.length,
        errors: failed.map((item) => item.reason?.message ?? String(item.reason))
      });
    }
  }).catch((error) => {
    logger?.warn?.("Realtime disconnect room directory update failed", {
      error: error?.message ?? String(error)
    });
  });

  return { scheduled: true, roomCount: roomIds.length };
}

//* این تابع هنگام دیسکانکت، اول خروج پلیر را برادکست می کند، بعد کانکشن را پاک می کند و سپس دایرکتوری روم را آپدیت می کند.
function cleanupRealtimeContext(ctx, closeInfo = null, gameServices = null, roomDirectoryService = null, logger = null) {
  const roomIds = readRealtimeRoomIdsBeforeCleanup(ctx);
  const presence = broadcastRealtimeDisconnectPresence(ctx, roomIds, closeInfo, gameServices, logger);
  try { ctx?.meta?.stopHeartbeat?.(); } catch { }
  const cleaned = cleanupRealtimeConnection(ctx, { closeInfo });
  const roomDirectory = updateRealtimeRoomDirectoryAfterDisconnect(ctx, roomIds, roomDirectoryService, logger);
  return { cleaned, presence, roomDirectory };
}
//* یک بار در شروع اولیه سرور اجرا می شود .
//*بعداً هر وقت کلاینت وصل شد، آنجا کانکشن جدا ساخته می‌شود.
//* این تابع ریل تایم جدید را به سرور اچ تی تی پی یا تی ال اس وصل می کند و همه لایه های فازهای قبلی را به هم متصل می کند.
export function attachRealtime({ server, tokenService, logger, path = "" } = {}) {
  if (!server) throw new Error("attachRealtime requires http or tls server");//قبلا در ایندکس اصلی این سرور اپ تی تی پی ساخته شده است و وبسوکت روی آن اجرا می شود

  const registry = new ClientsRegistry();
  const rooms = new RoomManager();
  const router = createRealtimeRouter({ logger });//رُتِر مشخص می‌کند هر پیام باید به کدام فایل برود.
  const floodProtection = makeFloodProtection({ logger });//این بخش جلوی پیام‌های بیش از حد را می‌گیرد.
  const ackTracker = createAckTracker({ logger });//اَک ترکِر برای پیام‌هایی است که نیاز به تأیید دارند.
  const gameServices = createGameServices({ rooms, registry, logger });//اینجا سرویس‌های گیم ساخته می‌شوند.--این سرویس‌ها به روم و رجستری نیاز دارند.به نوعی فراخوانی تابع اصلی برای راه اندازی این اسکریپت
  const roomDirectoryService = new RoomDirectoryService({ logger });
  const transport = new WebSocketRealtimeTransport({ server, path, logger });//این فقط سیستم وب سوکت را آماده می‌کند که بعداً کانکشن بگیرد.-اینجا ترنسپرت ساخته می‌شود.لایه ای که با وب سوکت خام کار می کند 
  //*ترنسپُرت پیام یا کانکشن خام میدهد و ریل تایم سرور کانتکست -اونولپ - اجرای هوک - صدا زدن روتر
  const realtimeServer = createRealtimeServer({//اینجا کُر اصلی ریل تایم ساخته می‌شود.پس ریل تایم سرور مرکز کنترل ران تایم است.
    transport,
    router,
    logger,
    tokenService,
    registry,
    rooms,
    hooks: {//در یک لحظه خاص، این تابع را هم اجرا کن
      //*پس هارت بیت برای هر کانکشن جدا فعال می‌شود، ولی خود تابع اتچ ریل تایم برای هر کانکشن اجرا نمی‌شود.
      onConnection: (ctx) => attachRealtimeHeartbeatToContext(ctx, logger),//این وقتی اجرا می‌شود که یک کانکشن جدید واقعاً وارد کر شده باشد. و هارت بیت برای کانتکست ایجاد شده فعال مشود
      beforeMessage: (ctx) => runRealtimeFloodProtection(ctx, floodProtection, logger),//قبل از پردازش پیام آن را چک میکند و اگر مجاز باشد اجازه ادامه می دهد- برای هر پیام اجرا می شود
      afterEnvelope: (ctx, envelope) => resolveRealtimeAckEnvelope(envelope, ackTracker),//آیا این پیام اَک است؟--اگر اَک است، کدام پِندینگ میسیج  را رِسلُو می‌کند؟
      onClose: (ctx, closeInfo) => cleanupRealtimeContext(ctx, closeInfo, gameServices, roomDirectoryService, logger),//این وقتی اجرا می‌شود که کانکشن بسته شود.
      onError: (ctx, error) => logger?.warn?.("Realtime connection error observed in bootstrap", { connectionId: ctx?.connectionId, error: error?.message ?? String(error) }),
      onStop: () => {//این وقتی اجرا می‌شود که کل ریل تایم سرور متوقف شود.
        ackTracker.clear();
        floodProtection.cleanup?.(0);
      }
    }
  });
  //اتصال ابزارها به ریل تایم سرور
  //این یعنی این ابزارها روی خود ریل تایم سرور هم ذخیره می‌شوند.
  //برای اینکه بعداً بتوانیم از بیرون یا داخل  به آن‌ها دسترسی داشته باشیم.
  realtimeServer.registry = registry;
  realtimeServer.rooms = rooms;
  realtimeServer.router = router;
  realtimeServer.gameServices = gameServices;
  realtimeServer.roomDirectoryService = roomDirectoryService;
  realtimeServer.floodProtection = floodProtection;
  realtimeServer.ackTracker = ackTracker;

  realtimeServer.start();//اینجا سیستم واقعاً شروع می‌شود.
  //*بعد از این مرحله، وب سوکت ترنسپرت آماده است کانکشن جدید بگیرد.
  //*ولی هنوز کانکشن واقعی نداریم تا زمانی که کلاینت وصل شود.
  logger?.info?.("Realtime bootstrap integration completed", {
    transport: "websocket",
    path: path || "default",
    routes: router.getSnapshot?.()?.routeCount ?? 0
  });

  return { realtimeServer, transport, registry, rooms, router, gameServices, floodProtection, ackTracker, roomDirectoryService, stop: () => realtimeServer.stop(), getStats: () => realtimeServer.getStats() };
}
/* این‌ها با اجرای اتچ ریل تایم یک بار ساخته می‌شوند:

ClientsRegistry
RoomManager
RealtimeRouter
FloodProtection
AckTracker
GameServices
WebSocketRealtimeTransport
 */

/* وقتی کلاینت واقعاً وصل شد، این‌ها برای همان کانکشن ساخته می‌شوند:

ws خام
connection
RealtimeContext
RealtimeConnection
Heartbeat مخصوص همان context
  */


/*
توضیح کلی اسکریپت:
این فایل نقطه اتصال ریل تایم به بوت استرپ سرور است.
در این فایل ترنسپورت وب سوکت، کُر ریل تایم، رُتِر، رجیستری کانکشن، روم مَنِیجِر، سرویس های بازی، فلاد پروتکشن، اَک ترَکِر، هارت بیت و کلیناپ دیسکانکت به هم وصل می شوند.
این فایل خودش لاجیک بازی، آث واقعی یا پَرس دستی پیام را انجام نمی دهد.
وظیفه این فایل فقط ساختن وابستگی ها و وصل کردن لایه های ساخته شده در فازهای قبلی است.
بعد از این فاز، فاز تست وب سوکت می تواند مسیر واقعی جدید را آزمایش کند.
*/

/* 
سطح ۱: یک بار هنگام روشن شدن سرور

attachRealtime()
→ registry
→ rooms
→ router
→ floodProtection
→ ackTracker
→ gameServices
→ transport
→ realtimeServer
→ realtimeServer.start()


سطح ۲: هر بار که کلاینت وصل می‌شود

WebSocket connection
→ ws خام
→ connection
→ context
→ realtimeConnection
→ heartbeat


سطح ۳: هر بار که پیام می‌آید

raw message
→ floodProtection
→ parseEnvelope
→ ackTracker
→ router
→ handler


 */
