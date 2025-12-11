import { Client, ActivityType, TextChannel, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import { Logger } from '../utils/logger';
import { database } from '../utils/database';

const POLLING_INTERVAL = 60 * 1000; // 1 minute
const STATUS_URL = 'https://user.ffxiv.com.tw/api/login/launcherSession';

export class ServerStatusService {
    private client: Client;
    private logger: Logger;

    constructor(client: Client) {
        this.client = client;
        this.logger = new Logger('伺服器狀態');
    }

    start() {
        this.logger.info('開始伺服器狀態輪詢...');
        this.poll();
        setInterval(() => this.poll(), POLLING_INTERVAL);
    }

    async poll() {
        try {
            const response = await axios.get(STATUS_URL, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const data = response.data;
            let currentStatus = 'Online';
            let statusMessage = '';
            
            // Check for error field which indicates maintenance
            // Response example: { "error": "伺服器臨時維護中" }
            if (data && data.error) {
                currentStatus = 'Maintenance';
                statusMessage = data.error;
                this.setMaintenanceStatus(data.error);
            } else {
                this.setOnlineStatus();
            }

            this.checkAndNotify(currentStatus, statusMessage);

        } catch (error: any) {
            if (error.response && error.response.status === 400) {
                // 400 Bad Request indicates no session/maintenance error, so server is online
                this.setOnlineStatus();
                this.checkAndNotify('Online', '');
            } else {
                this.logger.error(`獲取伺服器狀態時發生錯誤：${error}`);
            }
        }
    }

    private async checkAndNotify(currentStatus: string, message: string) {
        const lastStatus = database.getLastServerStatus();

        if (!lastStatus) {
            // First run, just save
            database.setLastServerStatus(currentStatus);
            return;
        }

        if (currentStatus !== lastStatus) {
            this.logger.info(`伺服器狀態變更：${lastStatus} -> ${currentStatus}`);
            database.setLastServerStatus(currentStatus);
            await this.notifyChannels(currentStatus, message);
        }
    }

    private async notifyChannels(status: string, message: string) {
        const guildChannels = database.getAllNewsChannels();
        const isOnline = status === 'Online';
        
        const title = isOnline ? '🟢 FFXIV 伺服器已恢復連線' : '🔴 FFXIV 伺服器維護中';
        // const description = isOnline ? '伺服器現在可以正常登入' : `目前伺服器正在進行維護\n\n${message}`;

        // Components V2 Payload
        const payload = {
            content: '',
            flags: 1 << 15, // IS_COMPONENTS_V2
            components: [
                {
                    type: 17, // Container
                    components: [
                        {
                            type: 10, // Text Display
                            content: `# ${title}`
                        },
                        {
                            type: 14, // Separator
                            divider: true,
                            spacing: 2
                        },
                        {
                            type: 10, // Text Display
                            content: `**FFXIV 伺服器狀態** • ${new Date().toLocaleString()}`
                        }
                    ]
                }
            ]
        };

        for (const { guildId, channelIds } of guildChannels) {
            for (const channelId of channelIds) {
                try {
                    const channel = await this.client.channels.fetch(channelId) as TextChannel;
                    if (channel && channel.isTextBased()) {
                        // Use raw API to send components v2
                        // @ts-ignore - discord.js types might not support this yet
                        await this.client.rest.post(`/channels/${channelId}/messages`, {
                            body: payload
                        });
                        this.logger.success(`已發送狀態通知至頻道 ${channel.name}`);
                    }
                } catch (error) {
                    this.logger.error(`發送狀態通知至頻道 ${channelId} 失敗：${error}`);
                }
            }
        }
    }

    private setMaintenanceStatus(message: string) {
        this.client.user?.setPresence({
            status: 'dnd',
            activities: [{
                name: `🔴 ${message}`,
                type: ActivityType.Watching
            }]
        });
    }

    private setOnlineStatus() {
        this.client.user?.setPresence({
            status: 'online',
            activities: [{
                name: '🟢 FFXIV 伺服器上線中',
                type: ActivityType.Playing
            }]
        });
    }
}
