import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { database } from '../../utils/database';

export default {
    data: new SlashCommandBuilder()
        .setName('unbind')
        .setDescription('解除 FFXIV 最新消息通知頻道的綁定')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: '此指令只能在伺服器中使用', flags: MessageFlags.Ephemeral });
            return;
        }

        const currentChannels = database.getNewsChannels(interaction.guildId);
        
        // Clear bindings
        database.setNewsChannels(interaction.guildId, []);
        
        // Components V2 Payload
        const payload = {
            content: '',
            flags: (1 << 6) | (1 << 15), // Ephemeral + IS_COMPONENTS_V2
            components: [
                {
                    type: 17, // Container
                    components: [
                        {
                            type: 10, // Text Display
                            content: `✅ **成功解除綁定**`
                        },
                        {
                            type: 14, // Separator
                            divider: true,
                            spacing: 1
                        },
                        {
                            type: 10, // Text Display
                            content: currentChannels.length > 0
                                ? `已解除以下頻道的綁定：\n${currentChannels.map(id => `<#${id}>`).join('\n')}`
                                : '目前沒有綁定任何頻道'
                        }
                    ]
                }
            ]
        };

        // @ts-ignore
        await interaction.reply(payload);
    },
};
