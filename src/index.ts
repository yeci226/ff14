import { Client, GatewayIntentBits, Collection } from 'discord.js';
import dotenv from 'dotenv';
import { Loader } from './core/Loader';

dotenv.config();

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

// Attach commands collection to client
// @ts-ignore
client.commands = new Collection();

const loader = new Loader(client);

(async () => {
    await loader.load();
    client.login(process.env.DISCORD_TOKEN);
})();
