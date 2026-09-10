import { VoiceNpcPublisherAuthorizationService } from "../npc/voiceNpcPublisherAuthorizationService.js";
import { VoiceNpcPublisherService } from "../npc/voiceNpcPublisherService.js";
import { VoiceNpcSessionRegistry } from "../npc/voiceNpcSessionRegistry.js";
import { registerVoiceNpcGrpcPublisher } from "../npc/registerVoiceNpcGrpcPublisher.js";

//* این تابع سرویس‌های Auth، Session و Publisher مستقل NPC را می‌سازد.
function createVoiceV8RuntimeServices({ serviceTokenVerifier, gateway, recordingService = null, muteRegistry = null, now = () => Date.now() } = {}) {
    const authorizationService = new VoiceNpcPublisherAuthorizationService({ serviceTokenVerifier, now });
    const sessionRegistry = new VoiceNpcSessionRegistry();
    const publisherService = new VoiceNpcPublisherService({ authorizationService, sessionRegistry, gateway, recordingService, muteRegistry });

    function registerGrpc({ grpcServer, logger = null } = {}) {
        return registerVoiceNpcGrpcPublisher({ grpcServer, publisherService, logger });
    }

    //* این تابع Session دوعضوی NPC را برای ضبط رضایت‌محور V5 آماده می‌کند.
    function registerRecordingSession(sessionId) {
        if (!recordingService) return null;
        const session = sessionRegistry.get(sessionId);
        if (!session) throw new Error("NPC Voice session was not found.");
        if (session.listeners.length !== 1) {
            throw new Error("NPC recording requires exactly one listener per authorized session.");
        }

        return recordingService.registerSession({
            sessionId: session.sessionId,
            roomId: session.roomId,
            serverId: session.serverId,
            participants: [
                {
                    userId: session.npcUserId,
                    connectionId: session.publisherConnectionId
                },
                session.listeners[0]
            ]
        });
    }

    //* این تابع Session NPC را می‌بندد و ضبط فعال آن را نیز نهایی می‌کند.
    async function closeSession(input) {
        return publisherService.closeSession(input);
    }

    return Object.freeze({
        authorizationService,
        sessionRegistry,
        publisherService,
        registerGrpc,
        registerRecordingSession,
        closeSession,
        getStats: () => publisherService.getStats()
    });
}

export { createVoiceV8RuntimeServices };

/*
توضیح فایل:
این فایل Runtime V8 را با Service Token Verifier تزریق‌شده و Gateway مشترک می‌سازد و ثبت gRPC را تا beforeBind سرور اصلی به تعویق می‌اندازد.
*/
