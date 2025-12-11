import { Client, GatewayIntentBits } from 'discord.js';
import { NewsNotifier } from '../services/NewsNotifier';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    
    const notifier = new NewsNotifier(client);
    
    console.log('Triggering news check...');
    await notifier.checkNews();
    
    console.log('Done.');
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
