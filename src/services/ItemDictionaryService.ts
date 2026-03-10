import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parse } from 'csv-parse';
const OpenCC = require('opencc-js');

export interface ItemResult {
    id: number;
    name: string;
}

export class ItemDictionaryService {
    private itemMap: Map<string, number> = new Map();
    private descriptionMap: Map<number, string> = new Map(); // New map for ID -> Description
    private isInitialized: boolean = false;
    private dataDir: string;
    private csvPath: string;
    private converter: any; // tw -> cn (search)
    private converterOutput: any; // cn -> tw (display)

    constructor() {
        this.dataDir = path.join(process.cwd(), 'data');
        this.csvPath = path.join(this.dataDir, 'Item.csv');
        // Traditional (tw) to Simplified (cn) for search normalization
        this.converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
        // Simplified (cn) to Traditional (tw) for output display
        this.converterOutput = OpenCC.Converter({ from: 'cn', to: 'tw' });
    }

    public async initialize() {
        if (this.isInitialized) return;

        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        if (!fs.existsSync(this.csvPath)) {
            console.log("Item dictionary not found. Downloading...");
            await this.downloadDictionary();
        }

        await this.loadDictionary();
        this.isInitialized = true;
        console.log(`Item Dictionary initialized. Loaded ${this.itemMap.size} items and ${this.descriptionMap.size} descriptions.`);
    }

    // ... (downloadDictionary and loadDictionary remain same)

    private async downloadDictionary() {
        const url = 'https://raw.githubusercontent.com/thewakingsands/ffxiv-datamining-cn/master/Item.csv';
        const writer = fs.createWriteStream(this.csvPath);

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise<void>((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    private async loadDictionary() {
        return new Promise<void>((resolve, reject) => {
            const parser = fs.createReadStream(this.csvPath).pipe(parse({
                relax_column_count: true,
                skip_empty_lines: true
            }));

            let nameIndex = -1;
            let descIndex = -1;
            let keyIndex = 0; // Default to 0
            
            parser.on('readable', () => {
                let record;
                while ((record = parser.read()) !== null) {
                    
                    if (nameIndex === -1) {
                        const nIdx = record.indexOf('Name');
                        if (nIdx !== -1) nameIndex = nIdx;
                        
                        const dIdx = record.indexOf('Description');
                        if (dIdx !== -1) descIndex = dIdx;
                        
                        continue;
                    }

                    const name = record[nameIndex];
                    const key = record[keyIndex];

                    if (!name || name === "" || name === "str" || name === "Name") continue;
                    
                    const id = parseInt(key);
                    if (isNaN(id)) continue;

                    this.itemMap.set(name, id);
                    
                    if (descIndex !== -1 && record[descIndex]) {
                        this.descriptionMap.set(id, record[descIndex]);
                    }
                }
            });

            parser.on('error', (err: any) => {
                console.error("Error parsing CSV:", err);
                reject(err);
            });

            parser.on('end', () => {
                if (nameIndex === -1) {
                    console.warn("Could not find 'Name' column in Item.csv. Dictionary will be empty.");
                }
                resolve();
            });
        });
    }

    public search(query: string, limit: number = 5): ItemResult[] {
        if (!this.isInitialized) {
            // Return empty instead of throwing to avoid crashing autocomplete during startup
            return [];
        }

        const simplifiedQuery = this.converter(query).trim();

        const results: ItemResult[] = [];
        
        if (this.itemMap.has(simplifiedQuery)) {
            // Convert back to TW for display is hard if we only store CN keys.
            // But we can just return the input query or the stored CN name converted to TW.
            const id = this.itemMap.get(simplifiedQuery)!;
            results.push({ id, name: this.converterOutput(simplifiedQuery) }); // Try converting the query itself or fetch generic? 
            // Actually, best is to display what we found.
            // Since map keys are CN, we convert them to TW for display.
            if (results.length >= limit) return results;
        }

        for (const [name, id] of this.itemMap.entries()) {
            if (results.some(r => r.id === id)) continue; 

            if (name.includes(simplifiedQuery)) {
                results.push({ id, name: this.converterOutput(name) });
                if (results.length >= limit) break;
            }
        }

        return results;
    }

    public getName(id: number): string | undefined {
        for (const [name, itemId] of this.itemMap.entries()) {
            if (itemId === id) return this.converterOutput(name);
        }
        return undefined;
    }

    public getDescription(id: number): string | undefined {
        const desc = this.descriptionMap.get(id);
        return desc ? this.converterOutput(desc) : undefined;
    }
}

export const itemDictionary = new ItemDictionaryService();
