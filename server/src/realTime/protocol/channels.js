// File => src/realTime/protocol/channels.js

const Channels = Object.freeze({
    system: "system",
    presence: "presence",
    world: "world",
    game: "game",
    lobby: "lobby",
    chat: "chat",
    voice: "voice",
    npc: "npc"
});

const ChannelValues = Object.freeze(Object.values(Channels));

function isValidChannel(channel) {
    return typeof channel === "string" && ChannelValues.includes(channel);
}

export { Channels, ChannelValues, isValidChannel };