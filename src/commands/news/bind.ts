import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { database } from '../../utils/database';

export default {
    data: new SlashCommandBuilder()
        .setName('bind')
        .setDescription('綁定當前頻道以接收 FFXIV 最新消息通知')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: '此指令只能在伺服器中使用', flags: MessageFlags.Ephemeral });
            return;
        }

        // Get currently bound channels to show in placeholder or message (optional, but good UX)
        const currentChannels = database.getNewsChannels(interaction.guildId);
        
        // Components V2 Payload with Channel Select
        const payload = {
            content: '請選擇要接收 FFXIV 最新消息通知的頻道（可多選）：',
            flags: MessageFlags.Ephemeral,
            components: [
                {
                    type: 1, // Action Row
                    components: [
                        {
                            type: 8, // Channel Select
                            custom_id: 'notification_channel',
                            channel_types: [0], // Text Channels
                            placeholder: currentChannels.length > 0 ? `目前已綁定 ${currentChannels.length} 個頻道` : '選擇文字頻道...',
                            min_values: 0,
                            max_values: 25 // Discord limit
                        }
                    ]
                }
            ]
        };

        // @ts-ignore
        await interaction.reply(payload);
    },
};
