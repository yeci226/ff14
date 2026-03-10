import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ChatInputCommandInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ComponentType,
    AutocompleteInteraction,
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction
} from 'discord.js';
import axios from 'axios';
import { itemDictionary } from '../services/ItemDictionaryService';
import { lodestoneScraper } from '../services/LodestoneScraperService';
import { translationService } from '../services/TranslationService';

export default {
    data: new SlashCommandBuilder()
        .setName('item')
        .setDescription('查詢物品資料 (Search Item)')
        .addStringOption(option => 
            option.setName('name')
                .setDescription('物品名稱 (可輸入繁體/簡體中文)')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    
    async autocomplete(interaction: AutocompleteInteraction) {
        const focusedValue = interaction.options.getFocused();
        
        if (!focusedValue || focusedValue.length < 1) {
            await interaction.respond([]);
            return;
        }

        const results = itemDictionary.search(focusedValue, 25);
        
        await interaction.respond(
            results.map(choice => ({
                name: `${choice.name} (ID: ${choice.id})`,
                value: choice.id.toString() 
            }))
        );
    },

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        let query = interaction.options.getString('name', true);
        
        const potentialId = parseInt(query);
        let directMatchInfo: {id: number, name: string} | null = null;

        if (!isNaN(potentialId)) {
            const name = itemDictionary.getName(potentialId);
            if (name) {
                directMatchInfo = { id: potentialId, name: name };
            }
        }

        let results: {id: number, name: string}[] = [];
        
        if (directMatchInfo) {
            results = [directMatchInfo];
        } else {
            results = itemDictionary.search(query);
        }

        if (results.length === 0) {
            await interaction.editReply(`❌ 找不到關於 "${query}" 的物品。請嘗試其他關鍵字。`);
            return;
        }

        if (results.length > 1) {
            const select = new StringSelectMenuBuilder()
                .setCustomId('item_select')
                .setPlaceholder('請選擇物品...')
                .addOptions(
                    results.map(r => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(r.name)
                            .setDescription(`ID: ${r.id}`)
                            .setValue(r.id.toString())
                    )
                );

            const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(select);

            const initialResponse = await interaction.editReply({
                content: `🔍 找到 ${results.length} 個相關物品，請選擇：`,
                components: [row]
            });

            try {
                const confirmation = await initialResponse.awaitMessageComponent({ 
                    componentType: ComponentType.StringSelect, 
                    time: 30000,
                    filter: i => i.user.id === interaction.user.id
                });
                
                const selectedId = parseInt(confirmation.values[0]);
                const selectedName = results.find(r => r.id === selectedId)?.name || 'Unknown';
                
                await confirmation.update({ content: `正在查詢 ${selectedName}...`, components: [] });
                await this.fetchAndShowItem(interaction, selectedId); // Updated call

            } catch (e) {
                await interaction.editReply({ content: '❌ 選擇已逾時。', components: [] });
            }

        } else {
            const item = results[0];
            await this.fetchAndShowItem(interaction, item.id); // Updated call
        }
    },

    async fetchAndShowItem(interaction: ChatInputCommandInteraction | ButtonInteraction, id: number, messageId?: string) {
        if (!messageId && !interaction.deferred && !interaction.replied) await interaction.deferReply();

        try {
            // Fetch Data
            const apiResponse = await axios.get(`https://v2.xivapi.com/api/sheet/Item/${id}?language=en`);
            const data = apiResponse.data;
            const fields = data.fields; // XIVAPI v2 structure (lowercase 'fields' in actual response typically, but let's check safety. Previous code used data.fields)
            
            if (!fields) {
                 const errEmbed = new EmbedBuilder().setColor('Red').setDescription('❌ 無法從 API 獲取資料。');
                 if (!messageId) await interaction.editReply({ embeds: [errEmbed] });
                 else await interaction.editReply({ embeds: [errEmbed] });
                 return;
            }

            // Basic Info
             // Helper to calculate visual length (CJK = 2, Ascii = 1)
             const getVisualLength = (str: string) => {
                 let len = 0;
                 for (let i = 0; i < str.length; i++) {
                     len += (str.charCodeAt(i) > 255) ? 2 : 1;
                 }
                 return len;
             };

             // Helper to pad string to correct visual length
             const padTo = (str: string, targetLen: number) => {
                 const currentLen = getVisualLength(str);
                 const padding = Math.max(0, targetLen - currentLen);
                 return str + ' '.repeat(padding);
             };

            const name = fields.Name;
            const description = fields.Description || '';
            const iconUrl = fields.Icon ? `https://xivapi.com/${fields.Icon.path.replace('.tex', '.png')}` : '';

            // Fetch Lodestone Data
            let lodestoneData: any = {};
            try {
                // Use the combined fetch method from service
                const scraped = await lodestoneScraper.fetchItemDetails(name);
                if (scraped) {
                    lodestoneData = scraped;
                }
            } catch (e) {
                console.error('[ItemCommand] Lodestone error:', e);
            }

            // Translation (CN Name from local dictionary)
            const cnName = itemDictionary.getName(id);
            const displayName = cnName ? `${cnName}` : name;
            
            // Try to fetch CN Description from local dictionary (Item.csv)
            const cnDescription = itemDictionary.getDescription(id);
            const displayDescription = cnDescription || description;

            // Build V2 Component Payload
            // Structure: Type 9 (Section) with Accessory (Thumbnail)
             
            // Icon URL Correction: ui/icon/020000/020601.tex -> https://xivapi.com/i/020000/020601.png
            let finalIconUrl = iconUrl;
            if (fields.Icon && fields.Icon.path) {
                 finalIconUrl = `https://xivapi.com/${fields.Icon.path.replace('ui/icon/', 'i/').replace('.tex', '.png')}`;
            }

            // 1. Header (Title + Link)
             const itemUrl = lodestoneData.url || `https://na.finalfantasyxiv.com/lodestone/playguide/db/item/?q=${encodeURIComponent(name)}`;
             
             let block1Content = `## [${displayName}](${itemUrl})`;

             // --- Section: Stats Table ---
             if (lodestoneData.stats && lodestoneData.stats.length > 0) {
                 const headers = lodestoneData.stats.map((s: any) => translationService.translate(s.name, 'auto'));
                 const values = lodestoneData.stats.map((s: any) => s.value);
                 
                 // Build Table
                 const colWidth = 14;
                 const headerRow = headers.map((h: string) => padTo(h, colWidth)).join('  ');
                 const valueRow = values.map((v: string) => padTo(v, colWidth)).join('  ');
                 
                 block1Content += '\n```text\n';
                 block1Content += headerRow + '\n';
                 block1Content += valueRow + '\n';
                 block1Content += '```';
             } else if (lodestoneData.itemLevel) {
                 block1Content += `\n**Item Level** ${lodestoneData.itemLevel}`;
             }

             // --- Section: Class/Job ---
             if (lodestoneData.jobName) {
                 const jobs = lodestoneData.jobName.split(' '); // "GLA PLD" or "Gladiator Paladin"
                 const translatedJobs = jobs.map((j: string) => translationService.translate(j, 'class')).join(' ');
                 
                 const lvl = lodestoneData.jobLevel ? ` ${lodestoneData.jobLevel}級以上` : '';
                 block1Content += `\n${translatedJobs}${lvl}`;
             }

             // --- Section: Bonuses (Special) ---
             if (lodestoneData.bonuses && lodestoneData.bonuses.length > 0) {
                 block1Content += `\n**特殊**\n`;
                 // Group 2 per line
                 for (let i = 0; i < lodestoneData.bonuses.length; i += 2) {
                     const b1 = lodestoneData.bonuses[i];
                     const b2 = lodestoneData.bonuses[i+1];
                     
                     const formatBonus = (str: string) => {
                         // match "Name +Value" or "Name Value%"
                         // Lodestone bonus: "Strength +107" or "Direct Hit Rate +105"
                         // Regex to capture Name and Rest
                         const match = str.match(/^([a-zA-Z\s]+)(.*)$/);
                         if (match) {
                             const name = match[1].trim();
                             const val = match[2].trim();
                             const translatedName = translationService.translate(name, 'auto');
                             return `${translatedName} ${val}`;
                         }
                         return translationService.translate(str, 'auto');
                     };
                     
                     if (b2) block1Content += `${formatBonus(b1)}   ${formatBonus(b2)}\n`;
                     else block1Content += `${formatBonus(b1)}\n`;
                 }
             }

             // --- Section: Materia ---
             if (lodestoneData.materiaSlots) {
                 block1Content += `\n**魔晶石工藝**\n`;
                 for(let i=0; i<lodestoneData.materiaSlots; i++) {
                     block1Content += `【】`; // No newline for tight packing? User sample had newlines.
                 }
                 if (getVisualLength(block1Content.split('\n').pop() || '') > 0) block1Content += '\n'; // Ensure newline
             }

             // --- Section: Crafting & Repairs ---
             // Only show if we have data
             // --- Section: Crafting & Repairs ---
             if (lodestoneData.repairLevel || lodestoneData.repairMaterial || lodestoneData.meldingLevel) {
                 block1Content += `\n**製作&修理**\n`;
                 
                 if (lodestoneData.repairLevel) {
                    // "Repair LevelGoldsmith Lv. 60" or "Blacksmith Lv . 60"
                    // Parsing: Class + Level
                    const parts = lodestoneData.repairLevel.match(/^([a-zA-Z\s]+?)\s*Lv\s*[.]?\s*(\d.*)$/i);
                    let repStr = lodestoneData.repairLevel;
                    if (parts) {
                         const cls = translationService.translate(parts[1].trim(), 'class');
                         repStr = `${cls} ${parts[2].trim()}級以上`;
                    }
                    block1Content += `修理等級          ${repStr}\n`;
                 }
                 
                 if (lodestoneData.repairMaterial) {
                     // "Grade 7 Dark Matter" -> "七級暗物質"
                     // This is an Item.
                     const matName = translationService.translate(lodestoneData.repairMaterial, 'item');
                     block1Content += `修理材料           ${matName}\n`;
                 }
                 
                 if (lodestoneData.meldingLevel) {
                     // "Disciples of the Hand Lv. 70"
                     const parts = lodestoneData.meldingLevel.match(/^([a-zA-Z\s]+?)\s*Lv\s*[.]?\s*(\d.*)$/i);
                     let meldStr = lodestoneData.meldingLevel;
                     if (parts) {
                         // "Disciples of the Hand" -> "能工巧匠" (mapped via manualMap or class)
                         const cls = translationService.translate(parts[1].trim(), 'class'); 
                         meldStr = `${cls} ${parts[2].trim()}級以上`;
                     }
                     block1Content += `鑲嵌魔晶石等級  ${meldStr}\n`;
                 }
             }

             // --- Section: Capabilities (Flags) ---
             const formatFlag = (val?: string) => {
                 if (!val) return 'X';
                 if (val === 'Yes') return 'O';
                 if (val === 'No') return 'X';
                 return val; // e.g. "635.00"
             };

             const flags = [
                 `魔晶石化: ${formatFlag(lodestoneData.extractable)}`,
                 `武具投影: ${formatFlag(lodestoneData.projectable)}`,
                 `分解技能: ${formatFlag(lodestoneData.desynth)}`,
                 `染色: ${ (lodestoneData.dyeable === 'No' || lodestoneData.dyeable === '不可染色') ? '不可染色' : (lodestoneData.dyeable === 'Yes' ? '可染色' : lodestoneData.dyeable) }`
             ];
             
             // 2x2 Grid or lines
             block1Content += `\n${flags[0]}  ${flags[1]}`;
             block1Content += `\n${flags[2]}  ${flags[3]}`;
            

             if (displayDescription) {
                 block1Content += `\n\n> ${displayDescription}`;
             }

             // Add Effects if exists (Moved from Code Block)
             if (lodestoneData.effects && lodestoneData.effects.length > 0) {
                 lodestoneData.effects.forEach((e: string) => {
                     const translated = translationService.translate(e, 'auto');
                     block1Content += `\n> ${translated}`;
                 });
             }
             
             // Defines Row Content (Footer Stats)
             const buyPrice = fields.PriceMid ? `${fields.PriceMid} Gil` : '不可購買';
             const sellPrice = fields.PriceLow ? `${fields.PriceLow} Gil` : '不可販賣';
             
             const levelItem = lodestoneData.itemLevel || fields.LevelItem?.value || fields.LevelItem || '-'; // Prefer Lodestone Data
             const levelEquip = fields.LevelEquip || '-';
             const rawCategory = fields.ItemSearchCategory?.fields?.Name || fields.ItemUICategory?.fields?.Name || '-';
             const category = translationService.translate(rawCategory, 'category');
             const stackSize = fields.StackSize || '-';



             const COL1_WIDTH = 24; 

             const rows = [
                 `物品等級: ${levelItem}`,   `裝備等級: ${levelEquip}`,
                 `物品種類: ${category}`,    `堆疊數量: ${stackSize}`,
                 `商店購買: ${buyPrice}`,    `商店販賣: ${sellPrice}`
             ];

             const formattedRows: string[] = [];
             for (let i = 0; i < rows.length; i += 2) {
                 const col1 = rows[i];
                 const col2 = rows[i+1];
                 formattedRows.push(`${padTo(col1, COL1_WIDTH)}${col2}`);
             }

             // Wrap in Code Block for Monospace Alignment
             let block2ContentArray = [
                 '```text',
                 ...formattedRows,
                 '```'
             ];

             // Block 3: Footer (Default)
             const block3Content = `\n_ID: ${id} | 資料來源 XIVAPI v2 & Lodestone_`;

             // Initial Components State
             const SECTION_HEADER_DESC = {
                 type: 10,
                 content: block1Content
             };
             
             // Dynamic Footer / Extra Content Builder
             const buildSection = (extraContent?: string) => {
                 let finalBlock2AndExtra = block2ContentArray.join('\n');
                 
                 // Append extra content (Description/Effects) 
                 if (extraContent) {
                     finalBlock2AndExtra += `\n\n${extraContent}`;
                 }

                 const SECTION_PROPS = {
                     type: 10,
                     content: finalBlock2AndExtra
                 };

                 const SECTION_FOOTER = {
                     type: 10,
                     content: block3Content,
                     spacing: 2
                 };

                 const comps = [SECTION_HEADER_DESC, SECTION_PROPS, SECTION_FOOTER];
                 
                 const section: any = {
                     type: 9, 
                     components: comps
                 };
                 if (finalIconUrl) {
                     section.accessory = {
                         type: 11, 
                         media: { url: finalIconUrl }
                     };
                 }
                 return section;
             };

             // Build Initial Section
             const mainSection = buildSection();

            // Construct Select Menu
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`item_detail_${id}_${Date.now()}`)
                .setPlaceholder('選擇詳細資訊...');

            const options: StringSelectMenuOptionBuilder[] = [];

            // Option: Purchase
            if (lodestoneData.purchase && lodestoneData.purchase.length > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('販賣位置')
                    .setDescription(`查看 ${lodestoneData.purchase.length} 個販賣位置`)
                    .setValue('details_purchase')
                    .setEmoji('🛒'));
            }

            // Option: Trades
            if (lodestoneData.trades && lodestoneData.trades.length > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('兌換位置')
                    .setDescription(`查看 ${lodestoneData.trades.length} 個兌換位置`)
                    .setValue('details_trades')
                    .setEmoji('🔁'));
            }

            // Option: Drops
            if (lodestoneData.drops && lodestoneData.drops.length > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('掉落來源')
                    .setDescription(`查看 ${lodestoneData.drops.length} 個掉落來源`)
                    .setValue('details_drops')
                    .setEmoji('⚔️'));
            }

            // Option: Quests
            if (lodestoneData.quests && lodestoneData.quests.length > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('相關任務')
                    .setDescription(`查看 ${lodestoneData.quests.length} 個相關任務`)
                    .setValue('details_quests')
                    .setEmoji('📜'));
            }

            // Option: Recipes
            if (lodestoneData.recipes && lodestoneData.recipes.length > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('製作配方')
                    .setDescription(`查看 ${lodestoneData.recipes.length} 個相關配方`)
                    .setValue('details_recipes')
                    .setEmoji('🔨'));
            }

            // Option: Duties
            if (lodestoneData.duties && lodestoneData.duties.length > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('副本掉落')
                    .setDescription(`查看 ${lodestoneData.duties.length} 個相關副本`)
                    .setValue('details_duties')
                    .setEmoji('🏰'));
            }

            // Add Options if any
            let actionRow: ActionRowBuilder<StringSelectMenuBuilder> | undefined;
            if (options.length > 0) {
                selectMenu.addOptions(options);
                actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
            }

            const payload: any = {
                content: '',
                flags: (1 << 15), // IS_COMPONENTS_V2
                components: [
                    { type: 17, components: [mainSection] }
                ]
            };

            if (actionRow) {
                payload.components.push(actionRow.toJSON());
            }

            const replyMessage = await interaction.editReply(payload);

            // Collector for Interaction (Select Menu + Buttons)
            if (actionRow) {
                const collector = replyMessage.createMessageComponentCollector({ 
                    time: 300_000 // 5 Minutes
                });

                // State
                let currentMode: 'none' | 'purchase' | 'trades' | 'drops' | 'quests' | 'recipes' | 'duties' = 'none';
                let currentPage = 0;
                const itemsPerPage = 10;
                
                // Raw Data State
                let currentRawData: any[] = []; // Stores raw object or string
                let locationFilter: string | null = null;

                collector.on('collect', async (i: any) => {
                    if (i.user.id !== interaction.user.id) {
                        await i.reply({ content: '這不是你的查詢，請自己執行 /item 指令！', ephemeral: true });
                        return;
                    }

                    // Handle Main Menu Selection
                    if (i.isStringSelectMenu() && i.customId.startsWith('item_detail_')) {
                        const selection = i.values[0];
                        currentPage = 0;
                        locationFilter = null; // Reset filter

                        if (selection === 'details_purchase') {
                            currentMode = 'purchase';
                            if (lodestoneData.purchase) {
                                // Prepare Data for Dynamic Clustering
                                const rawItems = lodestoneData.purchase.map((p: any) => {
                                    const npc = translationService.translate(p.name, 'npc');
                                    const fullLocation = translationService.translate(p.location, 'place'); 
                                    const cleanLocation = fullLocation.replace(/\s*\(X:.*?\)/g, '').trim();
                                    return { npc, fullLocation, cleanLocation, original: p };
                                });

                                // Dynamic Clustering Algorithm
                                // Input: cleanLocations. Output: Map<cleanLocation, regionName>
                                const regionMap = new Map<string, string>();
                                const allLocs = Array.from(new Set(rawItems.map((i: any) => i.cleanLocation))) as string[];
                                
                                // 1. Identify Frequent Substrings
                                const substringCounts = new Map<string, number>();
                                allLocs.forEach(loc => {
                                    for (let len = 2; len <= loc.length; len++) {
                                        for (let i = 0; i <= loc.length - len; i++) {
                                            const sub = loc.substring(i, i + len);
                                            // Optional: Skip if pure numbers or extremely common stopwords? 
                                            // For Chinese game locations, "Zhong" (Middle) or "Di" (Land) might be common but "Zhong Sa Na Lan" is better.
                                            substringCounts.set(sub, (substringCounts.get(sub) || 0) + 1);
                                        }
                                    }
                                });

                                // 2. Filter Candidates (Appearing in > 1 unique distinct locations)
                                const candidates: { sub: string, score: number, count: number }[] = [];
                                for (const [sub, count] of substringCounts.entries()) {
                                    if (count > 1) {
                                        // Score: Prioritize Length.
                                        // If "Sa Na Lan" (3 chars, 5 items) vs "Sa Na" (2 chars, 5 items), score 3*5 > 2*5.
                                        // If "Thanalan" (8 chars, 5 items) vs "Western Thanalan" (16 chars, 1 item).
                                        // Count must be > 1.
                                        candidates.push({ sub, score: sub.length * Math.pow(count, 1.5), count });
                                    }
                                }
                                // Sort by Score DESC
                                candidates.sort((a, b) => b.score - a.score);

                                // 3. Greedy Assignment
                                const assigned = new Set<string>();
                                
                                // First pass: Assign to best clusters
                                for (const cand of candidates) {
                                    // Find unassigned locs containing this substring
                                    const matchingLocs = allLocs.filter(loc => !assigned.has(loc) && loc.includes(cand.sub));
                                    
                                    // If this candidate can group at least 2 *unassigned* items, use it.
                                    // Or if it groups 1 unassigned and some assigned? No, simplistic: group unassigned.
                                    if (matchingLocs.length > 1) {
                                        matchingLocs.forEach(loc => {
                                            regionMap.set(loc, cand.sub);
                                            assigned.add(loc);
                                        });
                                    } 
                                    // Else: maybe valid group but items already snatched by stronger group (e.g. "Western Thanalan" snatched by "Thanalan"?)
                                    // Wait, if "Western Thanalan" is only 1 item, it won't form a group alone.
                                }

                                // 4. Fallback: Assign remaining locs to themselves
                                allLocs.forEach(loc => {
                                    if (!assigned.has(loc)) {
                                        regionMap.set(loc, loc);
                                    }
                                });

                                // Map back to state
                                currentRawData = rawItems.map((item: any) => ({
                                    ...item,
                                    region: regionMap.get(item.cleanLocation) || item.cleanLocation
                                }));

                                // Sort
                                currentRawData.sort((a, b) => {
                                    if (a.region !== b.region) {
                                        return a.region.localeCompare(b.region, 'zh-TW');
                                    }
                                    return a.cleanLocation.localeCompare(b.cleanLocation, 'zh-TW');
                                });

                            } else { currentRawData = []; }
                        } else if (selection === 'details_trades') {
                            currentMode = 'trades';
                            if (lodestoneData.trades) {
                                // Prepare Data for Dynamic Clustering
                                const rawItems = lodestoneData.trades.map((p: any) => {
                                    const npc = translationService.translate(p.name, 'npc');
                                    const fullLocation = translationService.translate(p.location, 'place'); 
                                    const cleanLocation = fullLocation.replace(/\s*\(X:.*?\)/g, '').trim();
                                    return { npc, fullLocation, cleanLocation, original: p };
                                });

                                // Dynamic Clustering Algorithm
                                // Input: cleanLocations. Output: Map<cleanLocation, regionName>
                                const regionMap = new Map<string, string>();
                                const allLocs = Array.from(new Set(rawItems.map((i: any) => i.cleanLocation))) as string[];
                                
                                // 1. Identify Frequent Substrings
                                const substringCounts = new Map<string, number>();
                                allLocs.forEach(loc => {
                                    for (let len = 2; len <= loc.length; len++) {
                                        for (let i = 0; i <= loc.length - len; i++) {
                                            const sub = loc.substring(i, i + len);
                                            substringCounts.set(sub, (substringCounts.get(sub) || 0) + 1);
                                        }
                                    }
                                });

                                // 2. Filter Candidates (Appearing in > 1 unique distinct locations)
                                const candidates: { sub: string, score: number, count: number }[] = [];
                                for (const [sub, count] of substringCounts.entries()) {
                                    if (count > 1) {
                                        candidates.push({ sub, score: sub.length * Math.pow(count, 1.5), count });
                                    }
                                }
                                // Sort by Score DESC
                                candidates.sort((a, b) => b.score - a.score);

                                // 3. Greedy Assignment
                                const assigned = new Set<string>();
                                
                                // First pass: Assign to best clusters
                                for (const cand of candidates) {
                                    const matchingLocs = allLocs.filter(loc => !assigned.has(loc) && loc.includes(cand.sub));
                                    if (matchingLocs.length > 1) {
                                         matchingLocs.forEach(loc => {
                                             regionMap.set(loc, cand.sub);
                                             assigned.add(loc);
                                         });
                                    }
                                }

                                // 4. Fallback: Assign remaining locs to themselves
                                allLocs.forEach(loc => {
                                    if (!assigned.has(loc)) {
                                        regionMap.set(loc, loc);
                                    }
                                });

                                // Map back to state
                                currentRawData = rawItems.map((item: any) => ({
                                    ...item,
                                    region: regionMap.get(item.cleanLocation) || item.cleanLocation
                                }));

                                // Sort
                                currentRawData.sort((a, b) => {
                                    if (a.region !== b.region) {
                                        return a.region.localeCompare(b.region, 'zh-TW');
                                    }
                                    return a.cleanLocation.localeCompare(b.cleanLocation, 'zh-TW');
                                });

                            } else { currentRawData = []; }
                        } else if (selection === 'details_drops') {
                            currentMode = 'drops';
                            if (lodestoneData.drops) {
                                currentRawData = lodestoneData.drops.map((d: any) => `- ${translationService.translate(d, 'auto')}`);
                            } else { currentRawData = []; }
                        } else if (selection === 'details_quests') {
                            currentMode = 'quests';
                            if (lodestoneData.quests) {
                                // Quests: { name, area, level }
                                currentRawData = lodestoneData.quests.map((q: any) => {
                                    const translatedName = translationService.translate(q.name, 'quest');
                                    // Use translatePlace for Area if possible, otherwise use Area name
                                    const translatedArea = translationService.translate(q.area, 'place');
                                    
                                    // Format: **QuestName** (Area - Lv. XX)
                                    let extra = '';
                                    if (q.area && q.level) extra = ` (${translatedArea} - Lv.${q.level})`;
                                    else if (q.area) extra = ` (${translatedArea})`;

                                    return `- **${translatedName}**${extra}`;
                                });
                            } else { currentRawData = []; }
                        } else if (selection === 'details_recipes') {
                            currentMode = 'recipes';
                            if (lodestoneData.recipes) {
                                // Try 'class' first (recipes are usually Class Name)
                                // If recipes structure is ever updated to object, change here. Currently string.
                                currentRawData = lodestoneData.recipes.map((r: any) => {
                                    const name = translationService.translate(r.name, 'class');
                                    const level = r.level && r.level !== '-' ? ` (${r.level})` : '';
                                    return `- **${name}**${level}`;
                                });
                            } else { currentRawData = []; }
                        } else if (selection === 'details_duties') {
                            currentMode = 'duties';
                            if (lodestoneData.duties) {
                                // Duties: { name, requiredLevel, itemLevel }
                                currentRawData = lodestoneData.duties.map((d: any) => {
                                    const translatedName = translationService.translate(d.name, 'duty');
                                    
                                    // Format: **Name** (需 Lv. 50 / 平均 iLv. 70)
                                    const req = d.requiredLevel && d.requiredLevel !== '-' ? `需 Lv.${d.requiredLevel}` : '';
                                    const avg = d.itemLevel && d.itemLevel !== '-' ? `平均 iLv.${d.itemLevel}` : '';
                                    
                                    let extra = '';
                                    if (req && avg) extra = ` (${req} / ${avg})`;
                                    else if (req || avg) extra = ` (${req}${avg})`;

                                    return `- **${translatedName}**${extra}`;
                                });
                            } else { currentRawData = []; }
                        }
                    }

                    // Handle Filter Selection
                    if (i.isStringSelectMenu() && i.customId === 'filter_location') {
                        locationFilter = i.values[0] === 'all' ? null : i.values[0];
                        currentPage = 0;
                    }

                    // Handle Pagination Buttons
                    if (i.isButton()) {
                         // Process logic first
                    }

                    // --- Process Data List based on Filter ---
                    let currentDataList: string[] = [];
                    let availableRegions: Set<string> = new Set();

                    if (currentMode === 'purchase' || currentMode === 'trades') {
                        // Collect all Regions
                        currentRawData.forEach(item => availableRegions.add(item.region));
                        
                        // Filter by Region
                        const filtered = locationFilter 
                            ? currentRawData.filter(item => item.region === locationFilter)
                            : currentRawData;

                        if (currentMode === 'purchase') {
                            const maxNpcLen = filtered.reduce((max, item) => Math.max(max, getVisualLength(item.npc)), 0);
                            currentDataList = filtered.map((item: any) => {
                                return `${padTo(item.npc, maxNpcLen + 4)}${item.fullLocation}`;
                            });
                        } else {

                            // Trades: Cost NPC Location
                            const maxNpcLen = filtered.reduce((max, item) => Math.max(max, getVisualLength(item.npc)), 0);
                            
                            // Map to intermediate to handle translation
                            const mappedList = filtered.map((item: any) => {
                                let priceName = item.original.price;
                                let qtySuffix = '';
                                
                                // Split "Item x5"
                                const match = item.original.price.match(/^(.*?) (x\d+)$/);
                                if (match) {
                                    priceName = match[1];
                                    qtySuffix = ' ' + match[2];
                                }
                                
                                const translatedName = translationService.translate(priceName, 'item');
                                const fullPrice = `${translatedName}${qtySuffix}`;
                                return { ...item, fullPrice };
                            });

                            const maxCostLen = mappedList.reduce((max, item) => Math.max(max, getVisualLength(item.fullPrice)), 0);

                            currentDataList = mappedList.map((item: any) => {
                                return `${padTo(item.fullPrice, maxCostLen + 2)} ${padTo(item.npc, maxNpcLen + 4)}${item.fullLocation}`;
                            });
                        }
                    } else if (currentMode === 'drops' || currentMode === 'quests' || currentMode === 'recipes' || currentMode === 'duties') {
                        currentDataList = currentRawData; // currentRawData is already mapped to translated strings
                    }

                    // Handle Pagination (Now we have the correct list)
                    if (i.isButton()) {
                        const maxPage = Math.max(0, Math.ceil(currentDataList.length / itemsPerPage) - 1);
                        if (i.customId === 'page_prev') {
                            currentPage = Math.max(0, currentPage - 1);
                        } else if (i.customId === 'page_next') {
                            currentPage = Math.min(maxPage, currentPage + 1);
                        }
                    }

                    // Build Content
                    let detailsText = '';
                    if (currentMode !== 'none' && currentDataList.length > 0) {
                        const total = currentDataList.length;
                        const start = currentPage * itemsPerPage;
                        const end = start + itemsPerPage;
                        const pageItems = currentDataList.slice(start, end);
                        
                        const titleMap: Record<string, string> = {
                            'purchase': '🛒 販賣位置',
                            'trades': '🔁 兌換位置',
                            'drops': '⚔️ 掉落來源',
                            'quests': '📜 相關任務',
                            'recipes': '🔨 製作配方',
                            'duties': '🏰 副本掉落'
                        };
                        const title = titleMap[currentMode] || '詳細資訊';
                        let filterInfo = locationFilter ? ` [區域: ${locationFilter}]` : '';
                        detailsText = `### ${title}${filterInfo} (${start + 1} - ${Math.min(end, total)} / ${total} 筆)\n`;
                        
                        if (currentMode === 'purchase' || currentMode === 'trades') {
                           detailsText += '```text\n';
                           detailsText += pageItems.join('\n');
                           detailsText += '\n```';
                        } else {
                           // Simple list for others
                           detailsText += pageItems.join('\n');
                        }
                    } else if (currentMode !== 'none' && currentDataList.length === 0) {
                        detailsText = `### 查無資料`;
                    }

                    // Rebuild Section
                    const newSection = buildSection(detailsText);
                    
                    // Build Components
                    const components: any[] = [
                        { type: 17, components: [newSection] } // Main Content
                    ];

                    // 1. Main Select Menu (Always present)
                    components.push(actionRow!.toJSON());

                    // 2. Filter Menu (Only if Purchase mode and > 1 region)
                    if (currentMode === 'purchase' && availableRegions.size > 1) {
                         const locOptions = [
                             new StringSelectMenuOptionBuilder()
                                .setLabel('全部區域')
                                .setValue('all')
                                .setEmoji('🌍')
                                .setDefault(locationFilter === null)
                         ];
                         
                         // Add Regions (sorted)
                         const sortedRegs = Array.from(availableRegions).sort((a, b) => a.localeCompare(b, 'zh-TW'));
                         
                         // Discord Max Options 25.
                         sortedRegs.slice(0, 24).forEach(reg => {
                             locOptions.push(new StringSelectMenuOptionBuilder()
                                .setLabel(reg)
                                .setValue(reg)
                                .setDefault(locationFilter === reg)
                             );
                         });

                         const filterMenu = new StringSelectMenuBuilder()
                            .setCustomId('filter_location')
                            .setPlaceholder('篩選區域...')
                            .addOptions(locOptions);
                        
                         components.push(new ActionRowBuilder().addComponents(filterMenu).toJSON());
                    }

                    // 3. Pagination Buttons
                    if (currentDataList.length > itemsPerPage) {
                        const maxPage = Math.ceil(currentDataList.length / itemsPerPage) - 1;
                        const btnRow = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('page_prev')
                                    .setLabel('上一頁')
                                    .setStyle(ButtonStyle.Secondary)
                                    .setDisabled(currentPage === 0),
                                new ButtonBuilder()
                                    .setCustomId('page_indicator')
                                    .setLabel(`${currentPage + 1} / ${maxPage + 1}`)
                                    .setStyle(ButtonStyle.Secondary)
                                    .setDisabled(true),
                                new ButtonBuilder()
                                    .setCustomId('page_next')
                                    .setLabel('下一頁')
                                    .setStyle(ButtonStyle.Secondary)
                                    .setDisabled(currentPage === maxPage)
                            );
                        components.push(btnRow.toJSON());
                    }

                    await i.update({
                        content: '',
                        flags: (1 << 15),
                        components: components
                    });
                });
            }

        } catch (error) {
            console.error(error);
            // Handle reply check
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '發生錯誤，請稍後再試。', ephemeral: true });
            } else {
                await interaction.editReply({ content: '發生錯誤，請稍後再試。' });
            }
        }
    }
};
