// File => src/realTime/modules/game/index.js

import { createGameRoomService, GameRoomService } from "./gameRoomService.js";
import { createGamePresenceService, GamePresenceService } from "./gamePresenceService.js";
import { createGameStateService, GameStateService } from "./gameStateService.js";

//* این تابع سرویس های ماژول بازی را یکجا می سازد تا رُت ها و بوت استرپ به شکل یکدست از آن ها استفاده کنند.
function createGameServices(options = {}) {
    return {
        roomService: createGameRoomService(options),
        presenceService: createGamePresenceService(options),
        stateService: createGameStateService(options)
    };
}

/*
توضیح کلی اسکریپت:
این فایل خروجی مرکزی ماژول بازی است.
هدف این فایل این است که سرویس های روم، پرزنس و وضعیت بازی از یک مسیر واحد ایمپورت شوند.
این فایل نباید ترنسپورت خام، آث واقعی، رُتِر یا لاجیک بازی اجرا کند.
وظیفه این فایل فقط جمع کردن اکسپورت های ماژول بازی است.
*/

export {
    GameRoomService,
    GamePresenceService,
    GameStateService,
    createGameRoomService,
    createGamePresenceService,
    createGameStateService,
    createGameServices
};
