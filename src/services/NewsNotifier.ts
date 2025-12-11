import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { getLatestNews, getNewsContent } from '../scraper';
import { database } from '../utils/database';
import { Logger } from '../utils/logger';
import crypto from 'crypto';

const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes

export class NewsNotifier {
    private client: Client;
    private logger: Logger;
    private interval: NodeJS.Timeout | null = null;

    constructor(client: Client) {
        this.client = client;
        this.logger = new Logger('NewsNotifier');
    }

    start() {
        this.logger.info('開始新聞輪詢服務...');
        this.checkNews();
        this.interval = setInterval(() => this.checkNews(), POLLING_INTERVAL);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    public async checkNews() {
        this.logger.info('檢查新聞中...');
        const newsList = await getLatestNews();

        if (newsList.length === 0) {
            this.logger.warn('未發現新聞');
            return;
        }

        // Process top 3 news items
        const recentNews = newsList.slice(0, 3).reverse();

        // Check if this is the very first run (no global news at all)
        // If so, we might want to skip notifications to avoid spamming everything
        const history = database.getRecentGlobalNews(1);
        const isFirstRun = history.length === 0;

        for (const item of recentNews) {
            await this.processNewsItem(item, isFirstRun);
        }
    }

    private async processNewsItem(item: any, isSystemFirstRun: boolean) {
        // 1. Get or Create Global State
        let globalNews = database.getGlobalNews(item.id);
        const isGloballyNew = !globalNews;

        // 2. Fetch Content
        const result = await getNewsContent(item.url);
        if (!result) return;
        
        const { blocks, timestamp } = result;
        const currentContentHash = crypto.createHash('md5').update(item.title + JSON.stringify(blocks)).digest('hex');

        // 3. Update Global News matching what we fetched
        // We only update if it's new, hash changed, OR if we are missing the raw_markdown (migration case)
        if (isGloballyNew || globalNews?.content_hash !== currentContentHash || !globalNews.raw_markdown) {
            
            // Log the reason for update
            if (globalNews?.content_hash !== currentContentHash) {
                this.logger.info(`Hash Changed for ${item.title}: ${globalNews?.content_hash} -> ${currentContentHash}`);
            }

             // Formatting for storage (optional, but good for debugging or future web view)
             // We'll store the raw text representation or just rely on re-fetching/re-formatting for now?
             // The requirement said "store markdown".
             // Let's generate the markdown representation to store.
            const { formatNewsContent } = await import('../utils/formatter');
            let rawMarkdown = '';
            for (const block of blocks) {
                if (block.type === 'text') {
                    rawMarkdown += formatNewsContent(block.content) + '\n\n';
                }
            }

            globalNews = {
                id: item.id,
                title: item.title,
                url: item.url,
                raw_markdown: rawMarkdown,
                content_hash: currentContentHash,
                published_at: timestamp || Date.now(),
                last_updated: Date.now()
            };
            
            if (isSystemFirstRun) {
                this.logger.info(`初始化新聞歷史 (不發送通知)：${item.title}`);
                database.upsertGlobalNews(globalNews);
                return; // Skip dispatching on first system initialization
            }

            database.upsertGlobalNews(globalNews);
            this.logger.info(`更新全球新聞狀態：${item.title}`);
        }

        if (!globalNews) return; // Should not happen

        // 4. Dispatch to Channels
        const guildChannels = database.getAllNewsChannels();
        
        for (const { guildId, channelIds } of guildChannels) {
            for (const channelId of channelIds) {
                await this.syncChannel(guildId, channelId, globalNews, blocks, item);
            }
        }
    }

    private async syncChannel(guildId: string, channelId: string, globalNews: any, blocks: any[], originalItem: any) {
        const dispatch = database.getDispatch(globalNews.id, channelId);
        
        // Prepare Payload
        const payload = await this.buildPayload(originalItem, blocks, globalNews.published_at);

        if (dispatch) {
            // Already sent, check if we need to edit
            if (dispatch.last_hash !== globalNews.content_hash) {
                try {
                    const channel = await this.client.channels.fetch(channelId) as TextChannel;
                    if (channel && channel.isTextBased()) {
                        const message = await channel.messages.fetch(dispatch.message_id);
                        if (message) {
                            // @ts-ignore
                            await message.edit(payload);
                            this.logger.success(`已更新新聞訊息 ${channel.name} (${globalNews.title})`);
                            
                            // Update dispatch record
                            database.saveDispatch({
                                news_id: globalNews.id,
                                guild_id: guildId,
                                channel_id: channelId,
                                message_id: dispatch.message_id,
                                last_hash: globalNews.content_hash
                            });
                        }
                    }
                } catch (error: any) {
                    if (error.code === 50001 || error.code === 10003 || error.code === 50013) {
                         this.logger.warn(`Removing invalid channel ${channelId} (Error: ${error.code}) from guild ${guildId}`);
                         database.removeChannel(guildId, channelId);
                    } else {
                        this.logger.warn(`更新訊息失敗 (可能已刪除): ${error}`);
                    }
                }
            }
        } else {
            // Not sent yet. 
            // Only send if the news item was published recently (e.g., within last 24 hours)
            // This prevents spamming old news on restart/migration if the valid dispatch record is missing
            // or if a new channel is added.
            
            const newsAge = Date.now() - globalNews.published_at;
            const isRecentNews = newsAge < 24 * 60 * 60 * 1000; // 24 hours

            if (isRecentNews) {
                try {
                    const channel = await this.client.channels.fetch(channelId) as TextChannel;
                    if (channel && channel.isTextBased()) {
                        // @ts-ignore
                        const message = await channel.send(payload);
                        this.logger.success(`已發送新聞至 ${channel.name} (${globalNews.title})`);
                        
                        database.saveDispatch({
                            news_id: globalNews.id,
                            guild_id: guildId,
                            channel_id: channelId,
                            message_id: message.id,
                            last_hash: globalNews.content_hash
                        });
                        
                        await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
                    }
                } catch (error: any) {
                    if (error.code === 50001 || error.code === 10003 || error.code === 50013) {
                        this.logger.warn(`Removing invalid channel ${channelId} (Error: ${error.code}) from guild ${guildId}`);
                        database.removeChannel(guildId, channelId);
                    } else {
                         this.logger.error(`發送通知至頻道 ${channelId} 失敗：${error}`);
                    }
                }
            } else {
                // Determine why we are skipping to log it (debug)
                // this.logger.debug(`Skipping old news for ${channelId}: ${globalNews.title} (Age: ${Math.floor(newsAge/1000/60)}m)`);
            }
        }
    }

    private async buildPayload(newsItem: any, blocks: any[], timestamp: number) {
        const { formatNewsContent } = await import('../utils/formatter');
        
        const components: any[] = [];
        
        // Header
        components.push({
            type: 10, // Text Display
            content: `## [${newsItem.title}](${newsItem.url})`
        });
        components.push({
            type: 10, // Text Display
            content: timestamp ? `<t:${Math.floor(timestamp / 1000)}:f>` : (newsItem.date || new Date().toLocaleDateString())
        });
        components.push({
            type: 14, // Separator
            divider: true,
            spacing: 1
        });

        // Content Blocks
        let currentTextBuffer = '';

        for (const block of blocks) {
            if (block.type === 'text') {
                currentTextBuffer += formatNewsContent(block.content) + '\n\n';
            } else if (block.type === 'image') {
                if (currentTextBuffer.trim()) {
                    components.push({ type: 10, content: currentTextBuffer.trim() });
                    currentTextBuffer = '';
                }
                
                const mediaItem: any = { media: { url: block.url } };
                if (block.description && block.description.trim().length > 0) {
                    mediaItem.description = block.description.substring(0, 1024);
                }

                components.push({ type: 12, items: [mediaItem] });
            }
        }
        
        if (currentTextBuffer.trim()) {
            components.push({ type: 10, content: currentTextBuffer.trim() });
        }

        return {
            content: '',
            flags: (1 << 15), // IS_COMPONENTS_V2
            components: [{ type: 17, components: components }]
        };
    }
}
