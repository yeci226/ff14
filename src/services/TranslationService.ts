import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as csv from 'csv-parse';
const OpenCC = require('opencc-js'); // Use require to bypass TS7016

interface TranslationMap {
    [english: string]: string;
}

export class TranslationService {
    private dataDir = path.join(process.cwd(), 'data');
    private npcMap: TranslationMap = {};
    private placeMap: TranslationMap = {};
    private itemCategoryMap: TranslationMap = {};
    private itemMap: TranslationMap = {};
    private questMap: TranslationMap = {};
    private dutyMap: TranslationMap = {};

    private classMap: TranslationMap = {};
    private statsMap: TranslationMap = {};
    private addonMap: TranslationMap = {};
    
    // Manual Map for terms not in CSVs or UI specific
    private manualMap: TranslationMap = {

        'Materia': '魔晶石',
        'Crafting & Repairs': '製作與修理',
        'Repair Level': '修理等級',
        'Materials': '修理材料',
        'Materia Melding': '鑲嵌魔晶石等級',
        'Advanced Melding Forbidden': '禁止禁斷鑲嵌',
        'Bonuses': '特殊',
        'Unique': '獨佔',
        'Untradable': '不可交易',
        'Market Prohibited': '不可在市場交易',
        'Extractable': '魔晶石化',
        'Projectable': '武具投影',
        'Desynthesizable': '分解技能',
        'Dyeable': '染色',
        'Yes': 'O',
        'No': 'X',
        // Stats Failsafes
        'Physical Damage': '物理基本性能',
        'Auto-attack': '物理自動攻擊', 
        'Delay': '攻擊間隔',
        'Block Rate': '格擋發動力',
        'Block Strength': '格擋性能',
        'Magic Damage': '魔法基本性能',
        'Magic Defense': '魔法防禦',
        'Defense': '防禦力',
        'Strength': '力量', 
        'Vitality': '耐力', 
        'Dexterity': '靈巧', 
        'Intelligence': '智力', 
        'Mind': '精神', 
        'Critical Hit': '暴擊', 
        'Determination': '信念', 
        'Direct Hit Rate': '直擊', 
        'Skill Speed': '技能速度', 
        'Spell Speed': '詠唱速度', 
        'Tenacity': '堅韌', 
        'Piety': '信仰', 
        'GP': '採集力', 
        'CP': '製作力', 
        'Gathering': '獲得力', 
        'Perception': '鑑別力',
        // Classes Failsafes
        'Blacksmith': '鍛鐵匠',
        'Goldsmith': '雕金匠',
        'Weaver': '裁衣匠',
        'Alchemist': '煉金術士',
        'Culinarian': '烹調師', 
        'Miner': '採礦工', 
        'Botanist': '園藝工', 
        'Fisher': '捕魚人',
        'Carpenter': '刻木匠',
        'Armorer': '鑄甲匠',
        'Leatherworker': '製革匠',
        // Categories
        'Disciples of the Hand': '能工巧匠',
        'Disciples of the Land': '大地使者'
    };
    private isInitialized = false;
    private converter: any; // Type as any since we use require

    constructor() {
        // Init OpenCC for Simplified -> Traditional
        this.converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
    }

    public async initialize() {
        if (this.isInitialized) return;

        // Ensure data dir
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir);

        // Files to download
        // 1. ENpcResident (NPCs) - Default (Singular/0)
        await this.loadOrDownload('ENpcResident', this.npcMap);
        // 2. PlaceName (Locations) - Default (Name/0)
        await this.loadOrDownload('PlaceName', this.placeMap);
        // 3. ItemSearchCategory (Item Categories)
        await this.loadOrDownload('ItemSearchCategory', this.itemCategoryMap);
        // 4. Item (Items) - Default (Name)
        await this.loadOrDownload('Item', this.itemMap);
        // 5. Quest (Quests) - EN: Index 1 (Header '0')
        await this.loadOrDownload('Quest', this.questMap);
        // 6. ContentFinderCondition (Duties) - EN: Index 44 (Header '43')
        await this.loadOrDownload('ContentFinderCondition', this.dutyMap, '43');
        // 7. ClassJob (Classes/Jobs) - EN: Index 1 (Header '0')
        // 7. ClassJob (Classes/Jobs) - EN: Index 1 (Header '0')
        // Header: key,0,1,2...  1=Name, 2=Abbreviation
        await this.loadOrDownload('ClassJob', this.classMap, '1', '2');
        // 8. BaseParam (Stats) - Default (Name)
        // Header: key,0,1,2... 1=Name
        await this.loadOrDownload('BaseParam', this.statsMap, '1');
        // 9. Addon (UI Strings) - Header: key,0,1... 0=Text
        await this.loadOrDownload('Addon', this.addonMap, '0');

        this.isInitialized = true;
        console.log(`[TranslationService] Initialized. Loaded ${Object.keys(this.npcMap).length} NPCs, ${Object.keys(this.placeMap).length} Places, ${Object.keys(this.itemCategoryMap).length} Categories, ${Object.keys(this.itemMap).length} Items, ${Object.keys(this.questMap).length} Quests, ${Object.keys(this.dutyMap).length} Duties, ${Object.keys(this.statsMap).length} Stats, ${Object.keys(this.addonMap).length} UI Strings.`);
    }

    private async loadOrDownload(sheetName: string, targetMap: TranslationMap, enKey?: string, enKey2?: string) {
        const enFile = path.join(this.dataDir, `${sheetName}.en.csv`);
        const cnFile = path.join(this.dataDir, `${sheetName}.cn.csv`);

        // Check if files exist and are not empty
        this.verifyFile(enFile);
        this.verifyFile(cnFile);

        // Download if missing
        if (!fs.existsSync(enFile)) {
            console.log(`[TranslationService] Downloading ${sheetName}.en.csv...`);
            await this.download(`https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/${sheetName}.csv`, enFile);
        }
        if (!fs.existsSync(cnFile)) {
            console.log(`[TranslationService] Downloading ${sheetName}.cn.csv...`);
            await this.download(`https://raw.githubusercontent.com/thewakingsands/ffxiv-datamining-cn/master/${sheetName}.csv`, cnFile);
        }

        // Check again after download
        if (!this.verifyFile(enFile) || !this.verifyFile(cnFile)) {
             console.error(`[TranslationService] Failed to download or verify ${sheetName} CSVs. Skipping.`);
             return;
        }

        // Parse and Link
        // We need a temporary ID -> English map
        const idToEn: { [id: string]: string } = {};
        const idToEn2: { [id: string]: string } = {}; // For second key (Abbreviation)

        // Parse English
        await this.parseCsv(enFile, (row) => {
            // EN Logic: Use explicit key if provided, otherwise fallback
            let name = '';
            if (enKey && row[enKey]) {
                name = row[enKey];
            } else {
                name = row['Name'] || row['0'] || row['Singular'];
            }
            
            if (row.key && name) idToEn[row.key] = name.toLowerCase();
            
            // Secondary Key (e.g. Abbreviation)
            if (enKey2 && row[enKey2]) {
                const abbr = row[enKey2];
                if (row.key && abbr) idToEn2[row.key] = abbr.toLowerCase();
            }
        });

        // Parse Chinese and Link
        await this.parseCsv(cnFile, (row) => {
            // CN Logic: Use explicit key if provided, fallback to standard names
            let cn = '';
            if (enKey && row[enKey]) {
                cn = row[enKey];
            } else {
                cn = row['Name'] || row['0'] || row['Singular'];
            }

            if (row.key) {
                // Link Primary Key
                if (idToEn[row.key]) {
                    const en = idToEn[row.key];
                    if (en && cn) targetMap[en] = cn;
                }
                // Link Secondary Key (Map Abbr -> CN Name)
                if (idToEn2[row.key]) {
                    const en2 = idToEn2[row.key];
                    if (en2 && cn) targetMap[en2] = cn;
                }
            }
        });
    }

    private async download(url: string, dest: string) {
        const writer = fs.createWriteStream(dest);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });
        response.data.pipe(writer);
        return new Promise<void>((resolve, reject) => {
            writer.on('finish', () => resolve());
            writer.on('error', reject);
        });
    }

    private parseCsv(filePath: string, onRow: (row: any) => void): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv.parse({ columns: true, skip_empty_lines: true, bom: true }))
                .on('data', onRow)
                .on('end', () => resolve())
                .on('error', reject);
        });
    }

    private verifyFile(filePath: string): boolean {
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size === 0) {
                console.warn(`[TranslationService] File ${path.basename(filePath)} is 0 bytes. Deleting.`);
                fs.unlinkSync(filePath);
                return false;
            }
            return true;
        }
        return false;
    }

    public translate(text: string, type: 'npc' | 'place' | 'category' | 'quest' | 'duty' | 'class' | 'item' | 'auto'): string {
        if (!text) return text || '';
        let query = text.trim();
        let suffix = '';

        if (type === 'place' || type === 'auto') {
            // Check for coord pattern
            const match = text.match(/^(.*?)(\s*\(X:.*?\))?$/);
            if (match) {
                query = match[1].trim();
                suffix = match[2] || '';
            }
        }
        
        const key = query.toLowerCase();

        let cn = '';
        
        // Specific Lookups
        if (type === 'npc' && this.npcMap[key]) cn = this.npcMap[key];
        if (type === 'place' && this.placeMap[key]) cn = this.placeMap[key];
        if (type === 'category' && this.itemCategoryMap[key]) cn = this.itemCategoryMap[key];
        if (type === 'item' && this.itemMap[key]) cn = this.itemMap[key];
        if (type === 'quest' && this.questMap[key]) cn = this.questMap[key];
        if (type === 'duty' && this.dutyMap[key]) cn = this.dutyMap[key];
        if (type === 'class' && this.classMap[key]) cn = this.classMap[key];

        // Auto Lookup (Priority Order)
        if (type === 'auto') {
             if (this.npcMap[key]) cn = this.npcMap[key];
             else if (this.placeMap[key]) cn = this.placeMap[key];
             else if (this.itemMap[key]) cn = this.itemMap[key];
             else if (this.itemCategoryMap[key]) cn = this.itemCategoryMap[key];
             else if (this.questMap[key]) cn = this.questMap[key];
             else if (this.dutyMap[key]) cn = this.dutyMap[key];
             else if (this.addonMap[key]) cn = this.addonMap[key];

             else if (this.classMap[key]) cn = this.classMap[key];
             else if (this.statsMap[key]) cn = this.statsMap[key];
             else if (this.manualMap[query] || this.manualMap[key]) cn = this.manualMap[query] || this.manualMap[key]; // Check manual
        }

        if (cn) {
            return this.converter(cn) + (suffix ? ` ${suffix}` : ''); // Convert to Traditional and re-append Coords
        }
        return text; // Fallback
    }
}

export const translationService = new TranslationService();
