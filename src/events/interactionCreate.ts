import { Events, Interaction, MessageFlags, ChatInputCommandInteraction, WebhookClient, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { Logger } from '../utils/logger';

export default {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        if (interaction.isChatInputCommand()) {
            // @ts-ignore
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`找不到符合 ${interaction.commandName} 的指令`);
                return;
            }

            try {
                await command.execute(interaction);
                await sendRunWebhook(interaction);

            } catch (error) {
                console.error(error);         
                await sendErrorWebhook(interaction, error as Error);

                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: '執行此指令時發生錯誤！', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: '執行此指令時發生錯誤！', flags: MessageFlags.Ephemeral });
                    }
                } catch (replyError: any) {
                    // Ignore "Unknown interaction" or "Interaction has already been acknowledged" errors
                    // as they mean we can't reply anyway.
                    if (replyError.code !== 10062 && replyError.code !== 40060) {
                         console.error('Failed to send error message to user:', replyError);
                    }
                }
            }
        } else if (interaction.isAutocomplete()) {
            // @ts-ignore
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`找不到符合 ${interaction.commandName} 的指令`);
                return;
            }

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.isChannelSelectMenu()) {
            if (interaction.customId === 'notification_channel') {
                if (!interaction.guildId) return;

                const selectedChannels = interaction.values;
                const { database } = await import('../utils/database');
                
                // Validate Permissions
                const validChannels: string[] = [];
                const invalidChannels: string[] = [];
                
                const guild = interaction.guild;
                if (!guild) return;

                // We need to fetch channels to check permissions
                for (const channelId of selectedChannels) {
                    try {
                        const channel = await guild.channels.fetch(channelId);
                        if (!channel) continue;

                        const permissions = channel.permissionsFor(interaction.client.user?.id!);
                        if (!permissions) {
                             invalidChannels.push(`<#${channelId}> (無法確認權限)`);
                             continue;
                        }

                        const hasView = permissions.has(PermissionFlagsBits.ViewChannel);
                        const hasSend = permissions.has(PermissionFlagsBits.SendMessages);
                        const hasEmbed = permissions.has(PermissionFlagsBits.EmbedLinks);

                        if (hasView && hasSend && hasEmbed) {
                            validChannels.push(channelId);
                        } else {
                            const missing: string[] = [];
                            if (!hasView) missing.push('檢視頻道');
                            if (!hasSend) missing.push('發送訊息');
                            if (!hasEmbed) missing.push('嵌入連結');
                            invalidChannels.push(`<#${channelId}> (缺少: ${missing.join(', ')})`);
                        }
                    } catch (e) {
                        console.error(`Error checking permissions for channel ${channelId}:`, e);
                        invalidChannels.push(`<#${channelId}> (檢查時發生錯誤)`);
                    }
                }

                database.setNewsChannels(interaction.guildId, validChannels);

                // Build Status Message
                const components: any[] = [];
                
                // Success Message
                if (validChannels.length > 0) {
                     components.push({
                        type: 10,
                        content: `✅ **設定已更新**\n已綁定以下頻道接收通知：\n${validChannels.map(id => `<#${id}>`).join('\n')}`
                    });
                } else if (selectedChannels.length > 0 && validChannels.length === 0) {
                     components.push({
                        type: 10,
                        content: `❌ **設定失敗**\n所有選擇的頻道皆無效，請檢查機器人權限。`
                    });
                } else {
                     components.push({
                        type: 10,
                        content: `✅ **設定已更新**\n已取消所有頻道綁定`
                    });
                }

                // Error Message (if any)
                if (invalidChannels.length > 0) {
                    components.push({
                        type: 14,
                        divider: true,
                        spacing: 1
                    });
                     components.push({
                        type: 10,
                        content: `⚠️ **以下頻道無法綁定** (權限不足)：\n${invalidChannels.join('\n')}\n請確保機器人擁有「檢視頻道」、「發送訊息」及「嵌入連結」權限。`
                    });
                }

                // Components V2 Confirmation
                const payload = {
                    content: '',
                    flags: (1 << 6) | (1 << 15), // Ephemeral + IS_COMPONENTS_V2
                    components: [
                        {
                            type: 17, // Container
                            components: components
                        }
                    ]
                };

                // @ts-ignore
                await interaction.update(payload);
            }
        }
    },
};

async function sendErrorWebhook(interaction: ChatInputCommandInteraction, error: Error) {
    if (!process.env.ERR_WEBHOOK) return;

    try {
        const webhook = new WebhookClient({ url: process.env.ERR_WEBHOOK });
        const iconUrl = interaction.guild?.iconURL({ extension: 'webp' });

        const embed = new EmbedBuilder()
            .setTitle('指令執行錯誤')
            .setThumbnail(iconUrl || null)
            .addFields(
                { name: '指令', value: `\`${interaction.commandName}\``, inline: true },
                { name: '使用者', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: '伺服器', value: `${interaction.guild?.name || 'DM'} (${interaction.guild?.id || 'DM'})`, inline: true },
                { name: '錯誤訊息', value: `\`\`\`${error.message}\`\`\`` }
            )
            .setColor(0xED4245) // Red
            .setTimestamp();

        await webhook.send({ embeds: [embed] });
    } catch (webhookError) {
        console.error('Failed to send command error webhook:', webhookError);
    }
}

async function sendRunWebhook(interaction: ChatInputCommandInteraction) {
    if (!process.env.CMD_WEBHOOK) return;

    try {
        const webhook = new WebhookClient({ url: process.env.CMD_WEBHOOK });
        const iconUrl = interaction.guild?.iconURL({ extension: 'webp' });

        const embed = new EmbedBuilder()
            .setTitle('指令執行')
            .setThumbnail(iconUrl || null)
            .addFields(
                { name: '指令', value: `\`${interaction.commandName}\``, inline: true },
                { name: '使用者', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: '伺服器', value: `${interaction.guild?.name || 'DM'} (${interaction.guild?.id || 'DM'})`, inline: true },
            )
            .setColor(0x999999) // Gray
            .setTimestamp();

        await webhook.send({ embeds: [embed] });
    } catch (webhookError) {
        console.error('Failed to send command error webhook:', webhookError);
    }
}
