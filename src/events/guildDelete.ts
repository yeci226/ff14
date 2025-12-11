import { Events, Guild, WebhookClient, EmbedBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { database } from '../utils/database';
import moment from 'moment';

export default {
    name: Events.GuildDelete,
    once: false,
    async execute(guild: Guild) {
        new Logger('系統').info(`離開伺服器：${guild.name} (ID: ${guild.id})`);

        // Clean up database for this guild
        try {
            database.removeGuild(guild.id);
            new Logger('Database').success(`已清除伺服器 ${guild.name} (${guild.id}) 的相關設定與資料`);
        } catch (error) {
            new Logger('Database').error(`清除伺服器資料失敗：${error}`);
        }

        if (!process.env.JL_WEBHOOK) return;

        try {
            const webhook = new WebhookClient({ url: process.env.JL_WEBHOOK });
            const totalGuilds = guild.client.guilds.cache.size;
            const iconUrl = guild.iconURL({ extension: 'webp' });

            const embed = new EmbedBuilder()
                .setTitle('已離開伺服器')
                .setThumbnail(iconUrl || null)
                .addFields(
                    { name: '名稱', value: `\`${guild.name}\``, inline: true },
                    { name: 'ID', value: `\`${guild.id}\``, inline: true },
                    { name: '擁有者', value: `<@${guild.ownerId}>`, inline: true },
                    { name: '人數', value: `\`${guild.memberCount}\` 個成員`, inline: true },
                    { name: '建立時間', value: `<t:${moment(guild.createdAt).unix()}:F>`, inline: true },
                    { name: '伺服器數量', value: `\`${totalGuilds}\` 個伺服器`, inline: true }
                )
                .setColor(0xED4245) // Red
                .setTimestamp();

            await webhook.send({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to send guildDelete webhook:', error);
        }
    },
};
