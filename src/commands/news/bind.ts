import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { database } from "../../utils/database";

export default {
  data: new SlashCommandBuilder()
    .setName("bind")
    .setDescription("綁定當前頻道以接收 FFXIV 最新消息通知")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "此指令只能在伺服器中使用",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get currently bound channels to show in placeholder or message (optional, but good UX)
    const currentChannels = database.getNewsChannels(interaction.guildId);

    // 取得所有可見的文字頻道（最多 100 個）
    const allTextChannels =
      interaction.guild?.channels.cache
        .filter(
          (ch) =>
            ch.type === 0 &&
            ch.viewable &&
            typeof (ch as any).position === "number",
        )
        .sort((a, b) => (a as any).position - (b as any).position)
        .first(100) || [];

    // 分組，每 25 個頻道一組，最多 4 組
    const channelSelectRows = [];
    for (let i = 0; i < allTextChannels.length; i += 25) {
      channelSelectRows.push({
        type: 1, // Action Row
        components: [
          {
            type: 8, // Channel Select
            custom_id: `notification_channel_${i / 25 + 1}`,
            channel_types: [0], // Text Channels
            placeholder: `選擇文字頻道...（第 ${i / 25 + 1} 組）`,
            min_values: 0,
            max_values: Math.min(25, allTextChannels.length - i),
          },
        ],
      });
    }

    // 新增一個「確定」按鈕 action row
    const confirmRow = {
      type: 1,
      components: [
        {
          type: 2, // Button
          style: 1, // Primary
          custom_id: 'notification_channel_confirm',
          label: '確定',
        },
      ],
    };

    const payload = {
      content: "請選擇要接收 FFXIV 最新消息通知的頻道（可多選，最多 100 個）：",
      flags: MessageFlags.Ephemeral,
      components:
        channelSelectRows.length > 0
          ? [...channelSelectRows, confirmRow]
          : [
              {
                type: 1,
                components: [
                  {
                    type: 8,
                    custom_id: "notification_channel_1",
                    channel_types: [0],
                    placeholder:
                      currentChannels.length > 0
                        ? `目前已綁定 ${currentChannels.length} 個頻道`
                        : "選擇文字頻道...",
                    min_values: 0,
                    max_values: 25,
                  },
                ],
              },
              confirmRow,
            ],
    };

    // @ts-ignore
    await interaction.reply(payload);
  },
};
