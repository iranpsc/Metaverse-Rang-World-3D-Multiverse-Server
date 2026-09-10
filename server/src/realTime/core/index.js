// File => src/realTime/core/index.js

export { RealtimeServer, createRealtimeServer } from "./realtimeServer.js";
export { RealtimeConnection, createRealtimeConnection } from "./realtimeConnection.js";
export {
    RealtimeContextState,
    createConnectionId,
    createRealtimeContext,
    isRealtimeContextOpen,
    isRealtimeContextAuthenticated,
    markRealtimeContextAuthenticated,
    setRealtimeContextRoom,
    touchRealtimeContextMessage,
    touchRealtimeContextError,
    markRealtimeContextClosing,
    markRealtimeContextClosed,
    getRealtimeContextSnapshot
} from "./realtimeContext.js";

/*
توضیح کلی اسکریپت:
این فایل خروجی مرکزی لایه Core است.
فایل های دیگر می توانند RealtimeServer، RealtimeConnection و ابزارهای Context را از این مسیر دریافت کنند.
این فایل فقط export انجام می دهد و نباید منطق اجرایی، Auth، Router، Transport یا Game Logic داشته باشد.
*/
