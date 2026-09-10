import "dotenv/config";
import http from "http";

import cfg from "./config/env.js";
import { validateConfig } from "./config/validation.js";
import { setupGracefulShutdown } from "./shutdown.js";
import logger from "./utils/logger.js";
import { connectDatabase } from "./infra/mongo/connection.js";
import startGrpcServer from "./transport/grpc/server.js";
import { attachRealtime } from "./realTime/index.js";
import { registerGrpcRealtimeOnMainServer } from "./realTime/transport/grpcStreaming/registerGrpcRealtimeOnMainServer.js";
import { attachGameServerControl } from "./gameServerControl/attachGameServerControl.js";
import { createGameServerControlRawHttpAdapter } from "./gameServerControl/http/gameServerControlRawHttpAdapter.js";
import { createGameServerControlAuthResolver } from "./gameServerControl/auth/gameServerControlAuthResolver.js";
import { readBearerAccessToken } from "./gameServerControl/auth/gameServerControlAuthResolver.js";
import { handleJwksRequest } from "./http/jwks.js";
import { tokenService } from "./core/auth/auth.instance.js";
import { UserModel } from "./infra/mongo/models/user.model.js";
import { createVoiceRuntimeServices } from "./voice/bootstrap/createVoiceRuntimeServices.js";
import { createVoiceDedicatedSessionDeltaRuntime } from "./voice/dedicated/createVoiceDedicatedSessionDeltaRuntime.js";
import { createVoiceTransportRuntimeWrapper } from "./voice/bootstrap/voiceTransportRuntimeWrapper.js";
import { createVoiceV4RuntimeServices } from "./voice/bootstrap/createVoiceV4RuntimeServices.js";
import { createVoiceV5RuntimeServices } from "./voice/bootstrap/createVoiceV5RuntimeServices.js";
import { createVoiceV7RuntimeServices } from "./voice/bootstrap/createVoiceV7RuntimeServices.js";
import { createVoiceV8RuntimeServices } from "./voice/bootstrap/createVoiceV8RuntimeServices.js";
import { createGameServerNpcServiceTokenVerifier } from "./voice/npc/createGameServerNpcServiceTokenVerifier.js";

//* این تابع Feature Flagهای صریح صوت را از Environment می‌خواند.
function readEnabledEnvironmentFlag(name) {
  return ["1", "true", "yes", "on"].includes(
    String(process.env[name] ?? "").trim().toLowerCase()
  );
}

//* این تابع دسترسی Metrics صوت را فقط به Access Token دارای نقش یا Scope عملیاتی می‌دهد.
async function authorizeVoiceMetricsRequest(request) {
  const accessToken = readBearerAccessToken(request);
  if (!accessToken) return false;

  try {
    const claims = tokenService.verifyAccessToken(accessToken);
    const roles = Array.isArray(claims?.roles) ? claims.roles : [claims?.role];
    const scopes = Array.isArray(claims?.scopes)
      ? claims.scopes
      : String(claims?.scope ?? "").split(/\s+/).filter(Boolean);

    return roles.includes("admin") ||
      roles.includes("operations") ||
      scopes.includes("voice:metrics:read");
  } catch {
    return false;
  }
}

//#region Phase 7.L - Public 3D Lobby

import { ensurePublicLobbyRoomReady } from "./realTime/lobby/publicLobbyStartupService.js";
import { createPublicLobbyDedicatedReconciler } from "./realTime/lobby/publicLobbyDedicatedReconciler.js";

//#endregion Phase 7.L - Public 3D Lobby

//* این تابع سرور اچ‌تی‌تی‌پی اصلی را برای مسیر کلید عمومی، کنترل گیم سرور و مسیر وب‌سوکت می‌سازد.
function createHttpServer({
  voiceDedicatedSessionDeltaHttpHandler = null,
  voiceRecordingHttpHandler = null,
  voiceOperationalHttpHandler = null,
  gameServerControlRawHttpAdapter = null
} = {}) {
  return http.createServer(async (req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      const handled = handleJwksRequest(req, res);

      if (handled) {
        return;
      }
    }

    if (voiceDedicatedSessionDeltaHttpHandler) {
      const handled =
        await voiceDedicatedSessionDeltaHttpHandler(
          req,
          res
        );

      if (handled) {
        return;
      }
    }

    if (voiceRecordingHttpHandler) {
      const handled = await voiceRecordingHttpHandler(req, res);
      if (handled) return;
    }

    if (voiceOperationalHttpHandler) {
      const handled = await voiceOperationalHttpHandler(req, res);
      if (handled) return;
    }

    if (gameServerControlRawHttpAdapter) {
      const handled =
        await gameServerControlRawHttpAdapter(
          req,
          res
        );

      if (handled) {
        return;
      }
    }

    res.writeHead(
      404,
      {
        "Content-Type": "application/json"
      }
    );

    res.end(
      JSON.stringify({
        error: "not_found"
      })
    );
  });
}

//* این تابع رانتایم وب‌سوکت و رانتایم جی‌آر‌پی‌سی و کنترل گیم سرور را برای خاموش شدن امن کنار هم نگه می‌دارد.
function createCombinedRealtimeRuntime({
  websocketRealtimeRuntime = null,
  getGrpcRealtimeRuntime = null,
  gameServerControlRuntime = null,
  publicLobbyDedicatedRuntime = null,
  voiceDedicatedSessionDeltaRuntime = null,
  voiceRuntimeServices = null,
  voiceTransportRuntime = null,
  voiceV4RuntimeServices = null,
  voiceV5RuntimeServices = null,
  voiceV7RuntimeServices = null,
  voiceV8RuntimeServices = null
} = {}) {
  return {
    stop: () => {
      const grpcRealtimeRuntime =
        getGrpcRealtimeRuntime?.();

      voiceDedicatedSessionDeltaRuntime?.stop?.();
      void voiceV5RuntimeServices?.stop?.();
      voiceV4RuntimeServices?.stop?.();
      void voiceTransportRuntime?.stop?.();
      if (!voiceTransportRuntime) voiceRuntimeServices?.stop?.();
      publicLobbyDedicatedRuntime?.stop?.();
      grpcRealtimeRuntime?.stop?.();
      websocketRealtimeRuntime?.stop?.();
      gameServerControlRuntime?.stop?.();
    },

    getStats: () => {
      const grpcRealtimeRuntime =
        getGrpcRealtimeRuntime?.();

      return {
        websocket:
          websocketRealtimeRuntime
            ?.getStats?.() ??
          null,

        grpcStreaming:
          grpcRealtimeRuntime
            ?.getStats?.() ??
          null,

        gameServerControl:
          gameServerControlRuntime
            ?.getStatus?.() ??
          null,

        voiceDedicatedSessionDelta:
          voiceDedicatedSessionDeltaRuntime
            ?.getStats?.() ??
          null,

        voiceTransport: voiceTransportRuntime?.getStats?.() ?? null,
        voiceRouting: voiceV4RuntimeServices?.getStats?.() ?? null,
        voiceRecording: voiceV5RuntimeServices?.getStats?.() ?? null,
        voiceOperations: voiceV7RuntimeServices?.getStats?.() ?? null,
        voiceNpc: voiceV8RuntimeServices?.getStats?.() ?? null
      };
    }
  };
}

//* این تابع تعداد کل کاربران را از دیتابیس می‌خواند.
async function readTotalUsersCount() {
  try {
    return await UserModel.countDocuments({});
  } catch (err) {
    logger.error(
      "Failed to read total users count",
      {
        error:
          String(
            err?.stack ||
            err
          )
      }
    );

    return -1;
  }
}

//* این تابع آمار ساده سرور را در لاگ ثبت می‌کند.
async function logServerStats() {
  const totalUsers =
    await readTotalUsersCount();

  logger.info(
    "📊 Server stats",
    {
      totalUsers,
      uptimeSeconds:
        Math.floor(
          process.uptime()
        )
    }
  );
}

//* این تابع تایمر ثبت آمار سرور را فعال می‌کند.
function startServerStatsTimer() {
  const serverStatsTimer =
    setInterval(
      () => {
        logServerStats();
      },
      30000
    );

  serverStatsTimer.unref?.();

  return serverStatsTimer;
}

//* این تابع سرور اچ‌تی‌تی‌پی را برای مسیر وب‌سوکت روی پورت تنظیم‌شده اجرا می‌کند.
function listenHttpServer(
  httpServer
) {
  httpServer.listen(
    cfg.ws.port,
    () => {
      logger.info(
        `🚀🚀🚀🚀🚀🚀🚀🚀🚀 Real-time WebSocket server is running on port ${cfg.ws.port}`
      );
    }
  );
}

//* این تابع نقطه شروع اجرای سرور متاورس است.
async function main() {
  validateConfig();

  logger.info(
    "Starting metaverse backend...",
    {
      nodeEnv:
        cfg.app.nodeEnv,

      grpcHost:
        cfg.grpc.host,

      grpcPort:
        cfg.grpc.port,

      wsPort:
        cfg.ws.port,

      envoyTlsPort:
        cfg.envoy.tlsPort
    }
  );

  await connectDatabase();

  //#region Phase 7.L - Public 3D Lobby Database Startup

  //* این بخش بعد از اتصال موفق دیتابیس، روم عمومی سه بعدی لابی را ایجاد یا بازیابی می‌کند.
  const publicLobbyRoom =
    await ensurePublicLobbyRoomReady({
      logger
    });

  logger.info(
    "[PublicLobbyStartup] Startup registration completed.",
    {
      roomId:
        publicLobbyRoom.roomId,

      roomName:
        publicLobbyRoom.roomName,

      roomType:
        publicLobbyRoom
          .metadata
          ?.roomType ??
        "",

      isPermanent:
        publicLobbyRoom
          .metadata
          ?.isPermanent ===
        true,

      dedicatedRequired:
        publicLobbyRoom
          .metadata
          ?.dedicatedRequired ===
        true
    }
  );

  //#endregion Phase 7.L - Public 3D Lobby Database Startup

  await logServerStats();

  startServerStatsTimer();

  const gameServerControlBox = {
    control: null
  };

  const gameServerControlAuthResolver =
    createGameServerControlAuthResolver({
      tokenService,
      logger
    });

  const gameServerControlRawHttpAdapter =
    createGameServerControlRawHttpAdapter({
      getControl:
        () =>
          gameServerControlBox
            .control,

      resolveUserFromRequest:
        gameServerControlAuthResolver
    });

  const voiceDedicatedSessionDeltaRuntime =
    createVoiceDedicatedSessionDeltaRuntime({
      logger
    });

  const voiceExtendedRuntimeEnabled =
    readEnabledEnvironmentFlag("METAVERSE_VOICE_RUNTIME_ENABLED");

  let voiceTransportRuntime = null;
  let voiceV4RuntimeServices = null;
  let voiceV5RuntimeServices = null;
  let voiceV7RuntimeServices = null;
  let voiceV8RuntimeServices = null;

  const httpServer =
    createHttpServer({
      voiceDedicatedSessionDeltaHttpHandler:
        voiceDedicatedSessionDeltaRuntime
          .handleHttpRequest,

      voiceRecordingHttpHandler:
        async (request, response) => {
          const handler = voiceV5RuntimeServices?.recordingHttpHandler;
          return handler ? handler(request, response) : false;
        },

      voiceOperationalHttpHandler:
        async (request, response) => {
          const handler = voiceV7RuntimeServices?.operationalHttpHandler;
          return handler ? handler(request, response) : false;
        },

      gameServerControlRawHttpAdapter
    });

  const gameServerControlAttachResult =
    attachGameServerControl({
      app: httpServer,
      logger
    });

  if (
    !gameServerControlAttachResult
      .success
  ) {
    throw new Error(
      `[GameServerControl] attach failed: ${gameServerControlAttachResult.reason}`
    );
  }

  const gameServerControlRuntime =
    gameServerControlAttachResult
      .control;

  gameServerControlBox.control =
    gameServerControlRuntime;

  logger.info(
    "[GameServerControl] startup attach result",
    {
      reason:
        gameServerControlAttachResult
          .reason,

      started:
        gameServerControlAttachResult
          .data
          ?.started ===
        true
    }
  );

  //#region Phase 7.L - Public 3D Lobby Dedicated Reconcile

  //* این سرویس پس از آماده شدن Warm Dedicated، لابی عمومی را به آن اختصاص می دهد و Session دائمی را بازیابی می کند.
  const publicLobbyDedicatedRuntime =
    createPublicLobbyDedicatedReconciler({
      gameServerControl:
        gameServerControlRuntime,

      publicLobbyRoom,
      logger,
      intervalMs: 2000
    });

  publicLobbyDedicatedRuntime.start();

  logger.info(
    "[PublicLobbyDedicated] Reconcile service started.",
    {
      roomId:
        publicLobbyRoom.roomId,

      roomName:
        publicLobbyRoom.roomName,

      intervalMs: 2000
    }
  );

  //#endregion Phase 7.L - Public 3D Lobby Dedicated Reconcile

  const websocketRealtimeRuntime =
    attachRealtime({
      server: httpServer,
      logger,
      tokenService
    });

  //#region Phase 7.L - Public 3D Lobby Realtime Registration

  //* این بخش روم عمومی دیتابیس را داخل روم منیجر زنده مشترک WebSocket و gRPC ثبت می‌کند.
  const publicLobbyRealtimeDefinition =
    websocketRealtimeRuntime
      .rooms
      ?.registerPermanentRoom?.(
        publicLobbyRoom.roomId,
        {
          roomName:
            publicLobbyRoom
              .roomName,

          roomType:
            publicLobbyRoom
              .metadata
              ?.roomType ??
            "public_lobby",

          isPublic:
            publicLobbyRoom
              .metadata
              ?.isPublic ===
            true,

          maxPlayers:
            publicLobbyRoom
              .maxPlayers,

          metadata: {
            ...(
              publicLobbyRoom
                .metadata ??
              {}
            )
          }
        }
      );

  if (
    !publicLobbyRealtimeDefinition
      ?.roomId
  ) {
    throw new Error(
      "[PublicLobbyStartup] Public lobby could not be registered in Realtime RoomManager."
    );
  }

  if (
    !websocketRealtimeRuntime
      .rooms
      ?.hasRoom?.(
        publicLobbyRoom.roomId
      )
  ) {
    throw new Error(
      "[PublicLobbyStartup] Public lobby is missing from Realtime RoomManager."
    );
  }

  if (
    !websocketRealtimeRuntime
      .rooms
      ?.isPermanentRoom?.(
        publicLobbyRoom.roomId
      )
  ) {
    throw new Error(
      "[PublicLobbyStartup] Public lobby was not registered as a permanent Realtime room."
    );
  }

  logger.info(
    "[PublicLobbyStartup] Realtime memory registration completed.",
    {
      roomId:
        publicLobbyRealtimeDefinition
          .roomId,

      roomName:
        publicLobbyRealtimeDefinition
          .roomName,

      roomType:
        publicLobbyRealtimeDefinition
          .roomType,

      isPublic:
        publicLobbyRealtimeDefinition
          .isPublic ===
        true,

      isPermanent:
        publicLobbyRealtimeDefinition
          .isPermanent ===
        true,

      autoCleanup:
        publicLobbyRealtimeDefinition
          .autoCleanup !==
        false,

      maxPlayers:
        publicLobbyRealtimeDefinition
          .maxPlayers,

      registeredRoomCount:
        websocketRealtimeRuntime
          .rooms
          ?.getSnapshot?.()
          ?.registeredRoomCount ??
        0,

      activeRoomCount:
        websocketRealtimeRuntime
          .rooms
          ?.getSnapshot?.()
          ?.roomCount ??
        0
    }
  );

  //#endregion Phase 7.L - Public 3D Lobby Realtime Registration

  //#region فاز F - زیر‌فاز V2.6 اتصال رانتایم صوت

  //* این بخش سرویس‌های صوت را فقط به نمونه‌های زنده ریل‌تایم و سرور اختصاصی متصل می‌کند و هیچ درگاه یا انتقال صوتی را شروع نمی‌کند.
  const voiceRuntimeServices =
    createVoiceRuntimeServices({
      realtimeRuntime:
        websocketRealtimeRuntime,

      gameServerControlRuntime
    });

  voiceDedicatedSessionDeltaRuntime.attach({
    gameServerControlRuntime,

    voiceConnectionRegistry:
      voiceRuntimeServices
        .voiceConnectionRegistry
  });

  if (voiceExtendedRuntimeEnabled) {
    const recordingStorageRoot =
      String(process.env.METAVERSE_VOICE_RECORDING_STORAGE_ROOT ?? "").trim();

    if (!recordingStorageRoot) {
      throw new Error(
        "METAVERSE_VOICE_RECORDING_STORAGE_ROOT is required when METAVERSE_VOICE_RUNTIME_ENABLED is enabled."
      );
    }

    voiceV5RuntimeServices =
      createVoiceV5RuntimeServices({
        storageRoot: recordingStorageRoot,
        resolveUserFromRequest: gameServerControlAuthResolver,
        logger
      });

    const storageInitialization =
      await voiceV5RuntimeServices.initializeStorage();

    voiceV7RuntimeServices =
      createVoiceV7RuntimeServices({
        authorizeMetricsRequest: authorizeVoiceMetricsRequest,
        logger,
        getRuntimeStats: async () => {
          const connectionStats =
            voiceRuntimeServices.voiceConnectionRegistry.getStats();
          const sessionStats =
            voiceDedicatedSessionDeltaRuntime.voiceSessionRegistry?.getStats?.() ?? {};
          const recordingStats =
            voiceV5RuntimeServices?.getStats?.() ?? {};

          voiceV7RuntimeServices?.metrics?.setGauge?.(
            "active_connections",
            connectionStats.active ?? 0
          );
          voiceV7RuntimeServices?.metrics?.setGauge?.(
            "active_sessions",
            sessionStats.active ?? 0
          );
          voiceV7RuntimeServices?.metrics?.setGauge?.(
            "active_recordings",
            recordingStats.byState?.[2] ?? 0
          );

          return Object.freeze({
            stopped: false,
            transportStarted: voiceTransportRuntime !== null,
            connections: connectionStats.active ?? 0,
            sessions: sessionStats.active ?? 0,
            recordings: recordingStats.byState?.[2] ?? 0,
            routing: voiceV4RuntimeServices?.getStats?.() ?? null,
            npc: voiceV8RuntimeServices?.getStats?.() ?? null
          });
        }
      });

    voiceV4RuntimeServices =
      createVoiceV4RuntimeServices({
        voiceRuntimeServices,
        voiceSessionRegistry:
          voiceDedicatedSessionDeltaRuntime.voiceSessionRegistry,
        recordingService:
          voiceV5RuntimeServices.recordingService,
        capacityController:
          voiceV7RuntimeServices.capacityController,
        operationalMetrics:
          voiceV7RuntimeServices.metrics,
        auditLogger:
          voiceV7RuntimeServices.auditLogger
      });

    voiceTransportRuntime =
      createVoiceTransportRuntimeWrapper({
        voiceRuntimeServices,
        websocketRealtimeRuntime,
        gateway:
          voiceV4RuntimeServices.voiceTransportGateway,
        logger
      });

    voiceV8RuntimeServices =
      createVoiceV8RuntimeServices({
        serviceTokenVerifier:
          createGameServerNpcServiceTokenVerifier({
            serviceTokenService:
              gameServerControlRuntime.serviceTokenService
          }),
        gateway:
          voiceV4RuntimeServices.voiceTransportGateway,
        recordingService:
          voiceV5RuntimeServices.recordingService,
        muteRegistry:
          voiceV4RuntimeServices.muteRegistry
      });

    voiceV4RuntimeServices.routingApplication.setExternalSessionProvider(
      (query) => voiceV8RuntimeServices.sessionRegistry.findVoiceSession(query)
    );

    voiceDedicatedSessionDeltaRuntime.setEventObserver(
      async (input) => {
        const results = await Promise.allSettled([
          voiceV4RuntimeServices.handleDedicatedSessionEvent(input),
          voiceV5RuntimeServices.handleDedicatedSessionEvent(input)
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }
    );

    voiceV7RuntimeServices.auditLogger.write({
      event: "voice_runtime_start",
      success: true,
      count: storageInitialization.quarantinedInterruptedRecordings
    });

    logger.info("[VoiceRuntime] V4-V8 services attached.", {
      recordingStorageRoot,
      recoveredCompletedRecordings:
        storageInitialization.recoveredCompletedRecordings,
      quarantinedInterruptedRecordings:
        storageInitialization.quarantinedInterruptedRecordings,
      fixedPortOpened: false,
      nginxChanged: false
    });
  }

  logger.info(
    "[VoiceRuntime] Core services attached to live server runtimes.",
    {
      realtimeRegistryAttached:
        voiceRuntimeServices
          .realtimeRegistry ===
        websocketRealtimeRuntime
          .registry,

      realtimeRoomsAttached:
        voiceRuntimeServices
          .realtimeRooms ===
        websocketRealtimeRuntime
          .rooms,

      gameSessionRegistryAttached:
        voiceRuntimeServices
          .gameSessionRegistry ===
        gameServerControlRuntime
          .sessionRegistry,

      registeredConnections:
        voiceRuntimeServices
          .voiceConnectionRegistry
          .getStats()
          .total,

      dedicatedSessionDeltaAttached:
        voiceDedicatedSessionDeltaRuntime
          .getStats()
          .attached,

      transportStarted: voiceTransportRuntime !== null,
      portOpened: false
    }
  );

  //#endregion فاز F - زیر‌فاز V2.6 اتصال رانتایم صوت

  let grpcRealtimeRuntime = null;

  const grpcServer =
    await startGrpcServer({
      beforeBind:
        ({
          server
        }) => {
          grpcRealtimeRuntime =
            registerGrpcRealtimeOnMainServer({
              grpcServer:
                server,

              websocketRealtimeRuntime,
              logger
            });

          voiceTransportRuntime?.registerGrpc?.({
            grpcServer: server
          });

          voiceV8RuntimeServices?.registerGrpc?.({
            grpcServer: server,
            logger
          });

          return grpcRealtimeRuntime;
        }
    });

  const realtimeRuntime =
    createCombinedRealtimeRuntime({
      websocketRealtimeRuntime,

      getGrpcRealtimeRuntime:
        () =>
          grpcRealtimeRuntime,

      gameServerControlRuntime,
      publicLobbyDedicatedRuntime,
      voiceDedicatedSessionDeltaRuntime,
      voiceRuntimeServices,
      voiceTransportRuntime,
      voiceV4RuntimeServices,
      voiceV5RuntimeServices,
      voiceV7RuntimeServices,
      voiceV8RuntimeServices
    });

  listenHttpServer(
    httpServer
  );

  setupGracefulShutdown({
    grpcServer,
    httpServer,
    realtimeRuntime
  });

  logger.info(
    `🌐 WebGL endpoint via Envoy: https://localhost:${cfg.envoy.tlsPort}`
  );

  logger.info(
    `🔌 Realtime endpoint: ws://localhost:${cfg.ws.port}`
  );

  logger.info(
    "🔌 Native realtime gRPC stream endpoint is registered on the main gRPC server."
  );
}

main().catch(
  (err) => {
    logger.error(
      "❌ Fatal error during startup",
      {
        error:
          String(
            err.stack ||
            err
          )
      }
    );

    process.exit(1);
  }
);

//* توضیح کلی فایل:
//* این فایل نقطه شروع اجرای سرور متاورس است.
//* ابتدا تنظیمات و دیتابیس آماده می‌شوند.
//* سپس روم عمومی سه بعدی دائمی لابی در دیتابیس ایجاد یا بازیابی می‌شود.
//* بعد سرور اچ‌تی‌تی‌پی ساخته می‌شود و ماژول کنترل گیم سرور به صورت داخلی وصل می‌شود.
//* پس از ساخت ریل‌تایم وب‌سوکت، لابی عمومی داخل همان روم منیجر مشترک WebSocket و gRPC ثبت می‌شود.
//* سپس هسته صوت بدون بازکردن درگاه یا شروع انتقال، به رجیستری زنده ریل‌تایم و نشست‌های زنده سرور اختصاصی متصل می‌شود.
//* بعد سرور جی‌آر‌پی‌سی ساخته می‌شود و از رجیستری، روم منیجر، رُتِر و سرویس‌های مشترک وب‌سوکت استفاده می‌کند.
//* در پایان خاموش شدن امن برای سرورها، رانتایم‌های ریل‌تایم و کنترل گیم سرور ثبت می‌شود.
