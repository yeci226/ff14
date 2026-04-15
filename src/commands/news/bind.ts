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

    // 取得所有可見的可發文頻道（文字+公告，最多 100 個）
    const selectableChannels =
      interaction.guild?.channels.cache
        .filter(
          (ch) =>
            (ch.type === 0 || ch.type === 5) &&
            ch.viewable &&
            typeof (ch as any).rawPosition === "number",
        )
        .sort((a, b) => (a as any).rawPosition - (b as any).rawPosition)
        .first(100) || [];

    const channelOptions = selectableChannels.map((ch) => {
      const categoryName = ch.parent?.name ? `${ch.parent.name} / ` : "";
      const label = `${categoryName}${ch.name}`.slice(0, 100);
      return {
        label,
        value: ch.id,
        default: currentChannels.includes(ch.id),
      };
    });

    // 分組，每 25 個頻道一組，最多 4 組
    const channelSelectRows = [];
    for (let i = 0; i < channelOptions.length; i += 25) {
      const chunk = channelOptions.slice(i, i + 25);
      channelSelectRows.push({
        type: 1, // Action Row
        components: [
          {
            type: 3, // String Select
            custom_id: `notification_channel_${i / 25 + 1}`,
            placeholder: `選擇頻道...（第 ${i / 25 + 1} 組）`,
            min_values: 0,
            max_values: chunk.length,
            options: chunk,
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
          custom_id: "notification_channel_confirm",
          label: "確定",
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
                    type: 3,
                    custom_id: "notification_channel_1",
                    options: channelOptions.slice(0, 25),
                    placeholder:
                      currentChannels.length > 0
                        ? `目前已綁定 ${currentChannels.length} 個頻道`
                        : "選擇頻道...",
                    min_values: 0,
                    max_values: Math.max(1, Math.min(25, channelOptions.length || 1)),
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
