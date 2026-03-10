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

import { itemDictionary } from './services/ItemDictionaryService';
import { translationService } from './services/TranslationService';

// Determine token and clientId based on environment
const isDev = process.env.NODE_ENV === 'development';
const token = isDev ? process.env.TEST_DISCORD_TOKEN : process.env.DISCORD_TOKEN;
const clientId = isDev ? process.env.TEST_CLIENT_ID : process.env.CLIENT_ID;

if (!token || !clientId) {
    throw new Error('Missing DISCORD_TOKEN or CLIENT_ID (or TEST variants) in .env file');
}

// Initialize Services
itemDictionary.initialize().then(() => {
    // console.log("Item Dictionary ready.");
});
translationService.initialize().then(() => {
    // console.log("Translation Service ready.");
});

(async () => {
    // Pass token and clientId to loader
    await loader.load(token, clientId);
    
    console.log(`Starting Bot in ${process.env.NODE_ENV || 'production'} mode...`);
    client.login(token);

    // ====================================
    // 設置統計數據推送到 personalWeb
    // ====================================
    const STATS_API = process.env.STATS_API_URL;
    const STATS_API_TOKEN = process.env.STATS_API_TOKEN;

    if (!STATS_API) {
        console.log('[Stats] STATS_API_URL is not set, stats push is disabled');
    } else {
        setInterval(async () => {
            try {
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                };
                if (STATS_API_TOKEN) {
                    headers.Authorization = `Bearer ${STATS_API_TOKEN}`;
                }

                await fetch(STATS_API, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        botId: 'ff14',
                        botName: 'FF14',
                        timestamp: Date.now(),
                        stats: {
                            totalCommands24h: 0,
                            totalErrors24h: 0,
                            topCommands: [],
                            byCommand: [],
                        },
                    }),
                }).catch((err) => {
                    console.error(`[Stats] Failed to push stats: ${err.message}`);
                });
            } catch (error) {
                console.error(`[Stats] Error pushing stats: ${(error as Error).message}`);
            }
        }, 60_000); // 每 60 秒推送一次
    }
})();
