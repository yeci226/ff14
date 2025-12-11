import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, AutocompleteInteraction, MessageFlags } from 'discord.js';
import axios from 'axios';
import { Logger } from '../../utils/logger';

export default {
    data: new SlashCommandBuilder()
        .setName('wiki')
        .setDescription('搜尋 FFXIV 中文維基 (灰機wiki)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('搜尋關鍵字')
                .setRequired(true)
                .setAutocomplete(true)),
    async autocomplete(interaction: AutocompleteInteraction) {
        const focusedValue = interaction.options.getFocused();
        if (!focusedValue) return;

        try {
            const searchUrl = `https://ff14.huijiwiki.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(focusedValue)}&format=json`;
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://ff14.huijiwiki.com/',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                },
                timeout: 3000
            });

            const data = response.data;
            if (data.query && data.query.search) {
                const choices = data.query.search.map((result: any) => ({
                    name: result.title,
                    value: result.title
                })).slice(0, 25); // Discord limit is 25

                await interaction.respond(choices);
            } else {
                await interaction.respond([]);
            }
        } catch (error) {
            console.error(error);
            // Silent fail for autocomplete to avoid spamming logs
            // console.error('Wiki Autocomplete Error:', error);
            await interaction.respond([]);
        }
    },
    async execute(interaction: ChatInputCommandInteraction) {
        const query = interaction.options.getString('query', true);
        const logger = new Logger('WikiSearch');

        await interaction.deferReply();

        try {
            // Try to search via API
            const searchUrl = `https://ff14.huijiwiki.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
            
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://ff14.huijiwiki.com/',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                },
                timeout: 5000
            });

            const data = response.data;

            if (data.query && data.query.search && data.query.search.length > 0) {
                const firstResult = data.query.search[0];
                const title = firstResult.title;
                const snippet = firstResult.snippet.replace(/<[^>]+>/g, ''); // Remove HTML tags
                const pageUrl = `https://ff14.huijiwiki.com/wiki/${encodeURIComponent(title)}`;

                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setURL(pageUrl)
                    .setDescription(snippet)
                    .setColor(0x0099ff)
                    .setFooter({ text: 'FFXIV 灰機wiki', iconURL: 'https://ff14.huijiwiki.com/favicon.ico' });

                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply({ content: `找不到關於「${query}」的結果` });
            }

        } catch (error) {
            logger.warn(`Wiki API request failed (likely Cloudflare): ${error}`);
            
            // Fallback to direct link
            const fallbackUrl = `https://ff14.huijiwiki.com/wiki/${encodeURIComponent(query)}`;
            
            const embed = new EmbedBuilder()
                .setTitle(`搜尋：${query}`)
                .setURL(fallbackUrl)
                .setDescription('無法直接預覽內容 (可能受 Cloudflare 保護)\n請點擊標題直接前往維基頁面')
                .setColor(0xffaa00)
                .setFooter({ text: 'FFXIV 灰機wiki' });

            await interaction.editReply({ embeds: [embed] });
        }
    },
};
