import { Events, WebhookClient, EmbedBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { client } from '../index';

export default {
    name: Events.Error,
    once: false,
    async execute(error: Error) {
        new Logger('系統').error(`發生錯誤：${error.message}`);

        if (!process.env.ERR_WEBHOOK) return;

        try {
            const webhook = new WebhookClient({ url: process.env.ERR_WEBHOOK });
            const iconUrl = client.user?.displayAvatarURL({ extension: 'webp' });

            const embed = new EmbedBuilder()
                .setTitle('系統錯誤')
                .setThumbnail(iconUrl || null)
                .addFields(
                    { name: '錯誤訊息', value: `\`\`\`${error.message}\`\`\`` },
                    { name: 'Stack Trace', value: `\`\`\`${error.stack ? error.stack.substring(0, 1000) : 'No stack trace'}\`\`\`` }
                )
                .setColor(0xED4245) // Red
                .setTimestamp();

            await webhook.send({ embeds: [embed] });

        } catch (webhookError) {
            console.error('Failed to send error webhook:', webhookError);
        }
    },
};
