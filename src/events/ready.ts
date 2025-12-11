import { Events, Client } from 'discord.js';
import { Logger } from '../utils/logger';
import { NewsNotifier } from '../services/NewsNotifier';
import { ServerStatusService } from '../services/ServerStatusService';

export default {
    name: Events.ClientReady,
    once: true,
    execute(client: Client) {
        new Logger('系統').success(`準備就緒！以 ${client.user?.tag} 身分登入`);
        
        // Start the news notifier service
        const notifier = new NewsNotifier(client);
        notifier.start();

        // Start the server status service
        const statusService = new ServerStatusService(client);
        statusService.start();
    },
};
