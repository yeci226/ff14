import axios from 'axios';
import * as cheerio from 'cheerio';

interface LodestoneShop {
    name: string;
    location: string;
    price: string;
}

interface LodestoneData {
    url: string;
    itemLevel?: string;
    jobName?: string;
    jobLevel?: string;
    stats?: { name: string; value: string }[];
    bonuses?: string[];
    purchase?: LodestoneShop[];
    trades?: LodestoneShop[];
    drops?: string[]; // Drops are usually just names, sometimes location? keeping string for now
    masterRecipe?: string;
    effects?: string[];
    recast?: string;
    quests?: { name: string, area?: string, level?: string }[];
    recipes?: { name: string, level?: string }[];
    duties?: { name: string, requiredLevel?: string, itemLevel?: string }[]; 
    
    // New Fields
    repairLevel?: string;
    repairMaterial?: string;
    meldingLevel?: string;
    
    extractable?: string;
    projectable?: string;
    desynth?: string;
    dyeable?: string;
    
    materiaSlots?: number;
    
    unique?: boolean;
    untradable?: boolean;
    marketProhibited?: boolean;
}

export class LodestoneScraperService {
    private baseUrl = 'https://na.finalfantasyxiv.com';

    /**
     * Scrapes Lodestone for acquisition info.
     * @param englishName The exact English name of the item.
     */
    public async fetchItemDetails(englishName: string): Promise<LodestoneData | null> {
        try {
            // 1. Search for the item
            // Note: ?q={name} for search.
            const searchUrl = `${this.baseUrl}/lodestone/playguide/db/item/?q=${encodeURIComponent(englishName)}`;
            
            const searchRes = await axios.get(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const $search = cheerio.load(searchRes.data);
            
            // Find the best matching result
            // Selector: .db-table__txt--detail_link
            let resultLink = '';
            
            const results = $search('.db-table__txt--detail_link');
            if (results.length > 1) {
                // Iterate to find exact match
                results.each((_, el) => {
                    if (resultLink) return; // Found already
                    const text = $search(el).text().trim();
                    if (text.toLowerCase() === englishName.toLowerCase()) {
                        resultLink = $search(el).attr('href') || '';
                    }
                });
            }
            
            // Fallback to first if no exact match or only one result
            if (!resultLink && results.length > 0) {
                resultLink = results.first().attr('href') || '';
            }

            if (!resultLink) {
                return null;
            }

            const itemUrl = `${this.baseUrl}${resultLink}`;
            // console.log(`[Lodestone] Found item page: ${itemUrl}`);

            // 2. Fetch Item Page
            const itemRes = await axios.get(itemUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const $item = cheerio.load(itemRes.data);
            const data: LodestoneData = { url: itemUrl };

            // 3. Flags and Basic Info
            if ($item('.rare').length > 0) data.unique = true;
            if ($item('.db-view__market_notsell').length > 0) data.marketProhibited = true;

            // 4. Parse Sections
            // Lodestone layout: <div class="db-view__data"> ... <h3>Title</h3> ... </div>
            // We iterate through sections to find "Purchase", "Obtained From", etc.

            // Strategy: Look for Headers, then grab the following content.
            // "Purchase" usually indicates NPC shops.
            // "Obtained From : Duty"
            
            // Purchase Info
            // Look for h3 containing "Purchase"
            // Note: Sometimes it's inside tab blocks.
            
            // Let's look for specific blocks.
            
            // 3. Parse Sections
            // Helper to clean text
            const cleanText = (el: cheerio.Cheerio<any>) => el.text().replace(/\s+/g, ' ').trim();

            $item('h3').each((i, el) => {
                const title = cleanText($item(el));
                
                // --- Crafting & Repairs ---
                if (title === 'Crafting & Repairs') {
                    let contextNode = $item(el).next();
                    if (contextNode.is('hr')) contextNode = contextNode.next();

                    // Look for ul.db-view__item_repair
                    if (contextNode.hasClass('db-view__item_repair')) {
                        contextNode.find('li').each((_, li) => {
                            const liText = cleanText($item(li));
                            if (liText.startsWith('Repair Level')) {
                                data.repairLevel = liText.replace('Repair Level', '').trim();
                            } else if (liText.startsWith('Materials')) {
                                data.repairMaterial = liText.replace('Materials', '').trim();
                            } else if (liText.startsWith('Materia Melding')) {
                                data.meldingLevel = liText.replace('Materia Melding', '').trim();
                            }
                        });
                        contextNode = contextNode.next();
                    }

                    // Look for ul.db-view__item-info__list
                    while (contextNode.length > 0 && !contextNode.is('h3')) {
                        if (contextNode.hasClass('db-view__item-info__list')) {
                             contextNode.find('li').each((_, li) => {
                                 const liText = cleanText($item(li));
                                 if (liText.includes('Extractable:')) data.extractable = liText.split(':')[1].trim();
                                 if (liText.includes('Projectable:')) data.projectable = liText.split(':')[1].trim();
                                 if (liText.includes('Desynthesizable:')) data.desynth = liText.split(':')[1].trim();
                                 if (liText.includes('Dyeable:')) data.dyeable = liText.split(':')[1].trim();
                             });
                        }
                        contextNode = contextNode.next();
                    }
                }

                // --- Materia ---
                if (title === 'Materia') {
                     let contextNode = $item(el).next();
                     if (contextNode.is('hr')) contextNode = contextNode.next();
                     
                     if (contextNode.hasClass('db-view__materia_socket')) {
                         data.materiaSlots = contextNode.find('li').length;
                     }
                }

                
                // --- Obtained From (Shops, Drops, Quests, Duties) ---
                if (title === 'Purchase' || title === 'Obtained From' || title === 'Obtained From : Duty') {
                    // Traverse all siblings until next H3
                    let contextNode = $item(el).next();
                    while (contextNode.length > 0 && !contextNode.is('h3')) {
                        
                        // Check for Tables
                        const tables = contextNode.find('table');
                        tables.each((_, tbl) => {
                             const headers = $item(tbl).find('th').map((_, th) => $item(th).text().trim()).get();
                             // console.log(`Table Headers: ${headers.join(', ')}`);
                             
                             // Type 1: Shop (Selling NPC, Area, ...)
                             // Exclude "Required Items" tables as those are Trade Shops
                             if (headers.includes('Selling NPC') && !headers.includes('Required Items')) {
                                 const rows = $item(tbl).find('tr').not(':has(th)'); // Skip header row
                                 rows.each((_, tr) => {
                                     const tds = $item(tr).find('td');
                                     if (tds.length >= 2) {
                                         const shopName = cleanText(tds.eq(0));
                                         const location = cleanText(tds.eq(1));
                                         const price = tds.length > 2 ? cleanText(tds.eq(2)) : '-';
                                         
                                         if (!data.purchase) data.purchase = [];
                                         const exists = data.purchase.some(p => p.name === shopName && p.location === location && p.price === price);
                                         if (!exists) data.purchase.push({ name: shopName, location, price });
                                     }
                                 });
                             }

                             // Type 2: Duty (Duty, Required Level, ...)
                             if (headers.includes('Duty')) {
                                 const rows = $item(tbl).find('tr').not(':has(th)');
                                 rows.each((_, tr) => {
                                     const tds = $item(tr).find('td');
                                     if (tds.length >= 1) {
                                         const links = $item(tds.eq(0)).find('a');
                                         let dutyName = '';
                                         
                                         // Structure: Category > SubCategory > Duty Name (Link)
                                         let targetLink = links.filter((_, a) => {
                                             const href = $item(a).attr('href');
                                             return !!href && href.includes('/playguide/db/duty/') && !href.includes('?');
                                         }).last();

                                         if (targetLink.length === 0 && links.length > 0) targetLink = links.last();
                                         
                                         if (targetLink.length > 0) dutyName = cleanText(targetLink);
                                         else dutyName = cleanText(tds.eq(0));
                                         
                                         // Level Info
                                         let reqLevel = '-';
                                         let avgItemLevel = '-';
                                         
                                         if (tds.length >= 2) reqLevel = cleanText(tds.eq(1));
                                         if (tds.length >= 3) avgItemLevel = cleanText(tds.eq(2));

                                         if (dutyName) {
                                             if (!data.duties) data.duties = [];
                                             // Avoid duplicates based on name
                                             if (!data.duties.some(d => d.name === dutyName)) {
                                                 data.duties.push({ name: dutyName, requiredLevel: reqLevel, itemLevel: avgItemLevel });
                                             }
                                         }
                                     }
                                 });
                             }

                             // Type 3: Quests (Quest, Area, Level)
                             if (headers.includes('Quest')) {
                                 const rows = $item(tbl).find('tr').not(':has(th)');
                                 rows.each((_, tr) => {
                                     const tds = $item(tr).find('td');
                                     if (tds.length >= 1) {
                                          const links = $item(tds.eq(0)).find('a');
                                          let questName = '';

                                          // Try finding specific quest link
                                          // Quests also have categories with query parameters
                                          let targetLink = links.filter((_, a) => {
                                              const href = $item(a).attr('href');
                                              return !!href && href.includes('/playguide/db/quest/') && !href.includes('?');
                                          }).last();

                                          if (targetLink.length === 0 && links.length > 0) {
                                              targetLink = links.last();
                                          }
                                         
                                          if (targetLink.length > 0) {
                                              questName = cleanText(targetLink);
                                          } else {
                                              questName = cleanText(tds.eq(0));
                                          }

                                         let area: string | undefined = undefined;
                                         let level: string | undefined = undefined;
                                         if (tds.length >= 2) area = cleanText(tds.eq(1));
                                         if (tds.length >= 3) level = cleanText(tds.eq(2));
                                         
                                         if (questName) {
                                             if (!data.quests) data.quests = [];
                                             if (!data.quests.some(q => q.name === questName)) {
                                                 // Don't push undefined if not present, to keep it clean, or keep undefined?
                                                 // Interface allows undefined.
                                                 data.quests.push({ name: questName, area, level });
                                             }
                                         }
                                     }
                                 });
                             }

                             // Type 4: Trade Shop (Required Items, Selling NPC)
                             if (headers.includes('Required Items') && headers.includes('Selling NPC')) {
                                 const rows = $item(tbl).find('tr').not(':has(th)');
                                 rows.each((_, tr) => {
                                     const tds = $item(tr).find('td');
                                     if (tds.length >= 2) {
                                         // Required Items is Col 0. Selling NPC is Col 1.
                                         // "Omega Totem1" -> Name + Quantity. 
                                         // Usually we want the text. 
                                         let required = cleanText(tds.eq(0));
                                         const qtyEl = tds.eq(0).find('.db-view__data__number');
                                         if (qtyEl.length > 0) {
                                             const quantity = cleanText(qtyEl);
                                             
                                             // Try specific name class
                                             let nameEl = tds.eq(0).find('.db-view__item__text__name a').first();
                                             
                                             // If not found, look for any link with text
                                             if (nameEl.length === 0) {
                                                 nameEl = tds.eq(0).find('a').filter((_, el) => cleanText($item(el)).length > 0).first();
                                             }
                                             
                                             // Fallback to text string manipulation if no valid link found
                                             const name = nameEl.length > 0 ? cleanText(nameEl) : required.replace(quantity, '').trim();
                                             
                                             required = `${name} x${quantity}`;
                                         }
                                         
                                         const npcCell = tds.eq(1);
                                         
                                         // NPC Cell often contains: NPC Name \n Location (X:...)
                                         // Extract Shop Name
                                         let shopName = cleanText(npcCell.find('a').first()); 
                                         if (!shopName) shopName = cleanText(npcCell).split(' ')[0]; // Fallback

                                         // Extract Location. 
                                         // Structure: NesvaazRadz-at-Han (X: 10.5 Y: 10.1)
                                         // The HTML usually has line breaks or spans.
                                         // text() merges them.
                                         // Try to get raw text and split? 
                                         // Or look for Location link if exists.
                                         // Typically: <a>NPC</a> <br> <a>Location</a> (Coords)
                                         const locLink = npcCell.find('a[href*="/lodestone/playguide/db/placename/"]');
                                         let location = '';
                                         if (locLink.length > 0) {
                                              location = cleanText(locLink);
                                              // Coords?
                                              const fullText = cleanText(npcCell);
                                              const match = fullText.match(/\(X:.*?\)/);
                                              if (match) location += ` ${match[0]}`;
                                         } else {
                                              // Fallback: entire text minus shop name?
                                              // "NesvaazRadz-at-Han (X: 10.5 Y: 10.1)" -> This is ugly if merged.
                                              // Check debug output: "NesvaazRadz-at-Han (X: 10.5 Y: 10.1)"
                                              // It seems text() merges without space if they are blocks. 
                                              // We'll leave it as best effort or just cleanText(npcCell) as location if simple.
                                              // Better approach:
                                              location = cleanText(npcCell).replace(shopName, '').trim();
                                         }
                                         
                                         if (!data.trades) data.trades = [];
                                         // Check duplicates
                                         if (!data.trades.some(p => p.name === shopName && p.location === location && p.price === required)) {
                                             data.trades.push({ name: shopName, location, price: required });
                                         }
                                     }
                                 });
                             }
                        });

                        // Check for stand-alone Shop Links (No table)
                        const links = contextNode.find('a[href*="/shop/"]');
                        if (links.length > 0) {
                             links.each((_, a) => {
                                 if ($item(a).parents('table').length === 0) {
                                     const shopInfo = cleanText($item(a));
                                     if (!data.purchase) data.purchase = [];
                                     if (!data.purchase.some(p => p.name === shopInfo)) {
                                         data.purchase.push({ name: shopInfo, location: '-', price: '-' });
                                     }
                                 }
                             });
                        }

                        contextNode = contextNode.next();
                    }
                }
                
                // --- Crafting Log ---
                if (title === 'Crafting Log') {
                    let contextNode = $item(el).next();
                    while (contextNode.length > 0 && !contextNode.is('h3')) {
                        const tables = contextNode.find('table');
                        tables.each((_, tbl) => {
                            // Header: Title, Recipe Level, Item Level
                            const rows = $item(tbl).find('tr').not(':has(th)');
                            rows.each((_, tr) => {
                                const tds = $item(tr).find('td');
                                if (tds.length >= 2) {
                                    // Title = Class Name (e.g. Carpenter)
                                    const className = cleanText(tds.eq(0));
                                    const level = cleanText(tds.eq(1));
                                    
                                    if (className) {
                                        if (!data.recipes) data.recipes = [];
                                        if (!data.recipes.some(r => r.name === className)) {
                                            data.recipes.push({ name: className, level });
                                        }
                                    }
                                }
                            });
                        });
                        contextNode = contextNode.next();
                    }
                }
                
                // --- Effects / Bonuses ---
                if (title === 'Effects' || title === 'Bonuses') {
                     // Get next sibling that is an element (skip text nodes/br if Cheerio doesn't skip)
                     let contentNode = $item(el).next();
                     // Traverse until we find meaningful content or hit next header
                     while (contentNode.length > 0 && (contentNode.is('br') || contentNode.text().trim() === '')) {
                         contentNode = contentNode.next();
                         if (contentNode.is('h3')) break; // safety
                     }

                     if (contentNode.length > 0) {
                         const tagName = contentNode.prop('tagName')?.toLowerCase() || '';
                         const effectLines: string[] = [];

                         if (tagName === 'table') {
                             contentNode.find('tr').each((_, tr) => {
                                 effectLines.push(cleanText($item(tr)));
                             });
                         } else if (tagName === 'ul') {
                            contentNode.find('li').each((_, li) => {
                                effectLines.push(cleanText($item(li)));
                            });
                         } else {
                             // Check for list items first (e.g. NQ/HQ wrapped in div)
                             const listItems = contentNode.find('li');
                             if (listItems.length > 0) {
                                 listItems.each((_, li) => {
                                     // Skip HQ effects
                                     if ($item(li).parent().hasClass('sys_hq_element')) return;
                                     
                                     effectLines.push(cleanText($item(li)));
                                 });
                             } else {
                                 // Check for paragraphs or just text
                                 const paragraphs = contentNode.find('p');
                                 if (paragraphs.length > 0) {
                                     paragraphs.each((_, p) => {
                                         effectLines.push(cleanText($item(p)));
                                     });
                                 } else {
                                     // Just raw text or other container
                                     const raw = cleanText(contentNode);
                                     if (raw) effectLines.push(raw);
                                 }
                             }
                         }

                         if (effectLines.length > 0) {
                             if (!data.effects) data.effects = [];
                             // Filter duplicates (Lodestone sometimes duplicates text for mobile/desktop layouts hiddenly? or just NQ/HQ?)
                             // User saw: "Restores ... 10%. Restores ... 12%."
                             // If we want to show both, push all. But if they are just appended, maybe we want separate lines.
                             // Current output logic joins by newline in formattedRows.
                             // So pushing multiple entries to data.effects is correct.
                             
                             if (title === 'Bonuses') {
                                 if (!data.bonuses) data.bonuses = [];
                                 data.bonuses.push(...effectLines);
                             } else {
                                 data.effects.push(...effectLines);
                             }
                         }
                     }
                }

                // ... Quests ...

            });

            // 4. Parse Basic Data (Recast, Sell Price)
            // Try Recast from specific class if known, else regex the body? 
            // Lodestone structure is consistent.
            // Recast is often in .db-view__item_info or similar.
            // Let's iterate all 'li' that might contain it.
            // 4. Parse Recast
            // Look for specific structure: <div class="sys_nk_label">Recast</div> ... value
            // Or text search in divs
            const recastLabel = $item('.sys_nk_label, .db-view__item__name').filter((_, el) => cleanText($item(el)) === 'Recast');
            
            if (recastLabel.length > 0) {
                 const parent = recastLabel.first().parent();
                 
                 // Check for NQ element specifically (to avoid getting both NQ and HQ times)
                 const nqElement = parent.find('.sys_nq_element');
                 if (nqElement.length > 0) {
                     data.recast = cleanText(nqElement);
                 } else {
                     // Fallback: simple text extraction (mostly for non-HQ items)
                     const text = cleanText(parent);
                     let val = text.replace(/Recast/i, '').trim();
                     if (val) data.recast = val;
                 }
            } else {
                // Fallback scan
                $item('li, div').each((i, el) => {
                    const text = cleanText($item(el));
                    if (text.startsWith('Recast') && text.length < 30) {
                         let val = text.replace(/Recast/i, '').replace(/Time/i, '').trim();
                         val = val.replace(/^[:：]\s*/, '').trim();
                         // If multiple times found (e.g. "5m 4m30s"), take the first one
                         const parts = val.split(/\s+/);
                         if (parts.length > 0) val = parts[0];
                         
                         if (val && !data.recast) data.recast = val;
                    }
                });
            }

            // Return all data
            // Slicing should be handled by the view layer if needed.

            // Parse Basic Info (Item Level, Job, Stats)
            // Item Level
            const levelText = $item('.db-view__item_level').text().trim();
            const levelMatch = levelText.match(/\d+/);
            if (levelMatch) data.itemLevel = levelMatch[0];

            // Job & Level
            data.jobName = cleanText($item('.db-view__item_equipment__class'));
            data.jobLevel = cleanText($item('.db-view__item_equipment__level'));

            // Main Stats
            data.stats = [];
            $item('.db-view__item_spec').each((_, spec) => {
                const name = cleanText($item(spec).find('.db-view__item_spec__name'));
                const value = cleanText($item(spec).find('.db-view__item_spec__value'));
                if (name && value) {
                    if (!data.stats) data.stats = [];
                    data.stats.push({ name, value });
                }
            });

            return data;

        } catch (error) {
            console.error("[LodestoneScraper] Error:", error);
            return null;
        }
    }
}

export const lodestoneScraper = new LodestoneScraperService();
