import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(process.cwd(), 'data.sqlite');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT PRIMARY KEY,
        news_channels TEXT -- JSON array of channel IDs (Deprecated)
    );

    CREATE TABLE IF NOT EXISTS news_subscribers (
        guild_id TEXT,
        channel_id TEXT,
        bound_at INTEGER,
        PRIMARY KEY (guild_id, channel_id)
    );
    
    -- New Normalized Schema
    CREATE TABLE IF NOT EXISTS global_news (
        id TEXT PRIMARY KEY,
        title TEXT,
        url TEXT,
        raw_markdown TEXT,
        content_hash TEXT,
        published_at INTEGER,
        last_updated INTEGER
    );

    CREATE TABLE IF NOT EXISTS news_dispatches (
        news_id TEXT,
        guild_id TEXT,
        channel_id TEXT,
        message_id TEXT,
        last_hash TEXT,
        PRIMARY KEY (news_id, channel_id),
        FOREIGN KEY(news_id) REFERENCES global_news(id)
    );

    CREATE TABLE IF NOT EXISTS news_state (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

// Migration 1: Schema Normalization (tracked_news -> global_news + news_dispatches)
try {
    const tableInfo = db.prepare("PRAGMA table_info(tracked_news)").all();
    if (tableInfo.length > 0) {
        console.log('Migrating tracked_news to new normalized schema...');
        const oldNews = db.prepare('SELECT * FROM tracked_news').all() as any[];

        const insertNews = db.prepare(`
            INSERT OR IGNORE INTO global_news (id, title, raw_markdown, content_hash, published_at, last_updated, url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        const insertDispatch = db.prepare(`
            INSERT OR IGNORE INTO news_dispatches (news_id, guild_id, channel_id, message_id, last_hash)
            VALUES (?, ?, ?, ?, ?)
        `);

        db.transaction(() => {
            for (const item of oldNews) {
                // Migrate News Item
                // Note: We don't have URL or raw_markdown yet, those will be filled on next fetch
                insertNews.run(
                    item.id, 
                    item.title, 
                    '', // raw_markdown (unknown)
                    item.content_hash, 
                    item.timestamp, // published_at
                    Date.now(), // last_updated
                    '' // url (unknown)
                );

                // Migrate Dispatches
                if (item.posted_messages) {
                    try {
                        const postedMap = JSON.parse(item.posted_messages);
                        for (const [key, val] of Object.entries(postedMap)) {
                            // key is "guildId:channelId"
                            const [guildId, channelId] = key.split(':');
                            
                            let messageId = '';
                            let lastHash = '';

                            if (typeof val === 'string') {
                                messageId = val;
                            } else if (typeof val === 'object' && val !== null) {
                                messageId = (val as any).messageId;
                                lastHash = (val as any).contentHash || item.content_hash;
                            }

                            if (guildId && channelId && messageId) {
                                insertDispatch.run(item.id, guildId, channelId, messageId, lastHash);
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to parse posted_messages for item ${item.id}`, e);
                    }
                }
            }
            
            // Rename old table to avoid re-migration
            db.exec('ALTER TABLE tracked_news RENAME TO tracked_news_backup_migrated');
        })();

        console.log('Migration to normalized schema complete.');
    } // End of Migration 1

    // Migration 2: Guild Config -> News Subscribers
    const subscriberCheck = db.prepare("SELECT count(*) as count FROM news_subscribers").get() as { count: number };
    const guildConfigCheck = db.prepare("SELECT count(*) as count FROM guild_config").get() as { count: number };
    
    // Only run if subscribers table is empty but we have legacy config
    if (subscriberCheck.count === 0 && guildConfigCheck.count > 0) {
        console.log('Migrating guild_config to news_subscribers...');
        const legacyConfigs = db.prepare("SELECT * FROM guild_config").all() as { guild_id: string, news_channels: string }[];
        const insertSub = db.prepare("INSERT OR IGNORE INTO news_subscribers (guild_id, channel_id, bound_at) VALUES (?, ?, ?)");

        db.transaction(() => {
            for (const config of legacyConfigs) {
                try {
                    const channels = JSON.parse(config.news_channels);
                    if (Array.isArray(channels)) {
                        for (const channelId of channels) {
                            // Set bound_at to 0 for existing channels so they receive messages as generic 'old' channels
                            insertSub.run(config.guild_id, channelId, 0);
                        }
                    }
                } catch (e) {
                    console.error(`Failed to parse legacy config for guild ${config.guild_id}`, e);
                }
            }
            // Optional: db.exec("DROP TABLE guild_config"); // Keep for safety for now
        })();
        console.log('Migration to news_subscribers complete.');
    }

} catch (e: any) {
    if (!e.message.includes('no such table')) {
        console.error('Migration failed:', e);
    }
}

// Previous Migration Loop (Legacy, kept just in case but likely handled)
// ... (omitted to cleaner file)

export interface GlobalNewsItem {
    id: string;
    title: string;
    url: string;
    raw_markdown: string;
    content_hash: string;
    published_at: number;
    last_updated: number;
}

export interface NewsDispatch {
    news_id: string;
    guild_id: string;
    channel_id: string;
    message_id: string;
    last_hash: string;
}

export const database = {
    // Guild Config / Subscriptions
    setNewsChannels: (guildId: string, channelIds: string[]) => {
        // Legacy: Update guild_config (keep for backup for a while)
        const stmtLegacy = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, news_channels) VALUES (?, ?)');
        stmtLegacy.run(guildId, JSON.stringify(channelIds));

        // New Schema: Update news_subscribers
        const getExisting = db.prepare('SELECT channel_id FROM news_subscribers WHERE guild_id = ?');
        const insertSub = db.prepare('INSERT OR IGNORE INTO news_subscribers (guild_id, channel_id, bound_at) VALUES (?, ?, ?)');
        const deleteSub = db.prepare('DELETE FROM news_subscribers WHERE guild_id = ? AND channel_id = ?');
        // Cleaning up dispatches for removed channels
        const deleteDispatches = db.prepare('DELETE FROM news_dispatches WHERE channel_id = ?');

        db.transaction(() => {
            const existingRows = getExisting.all(guildId) as { channel_id: string }[];
            const existingSet = new Set(existingRows.map(r => r.channel_id));
            const newSet = new Set(channelIds);

            // Add new channels (not in existing)
            for (const cid of channelIds) {
                if (!existingSet.has(cid)) {
                    insertSub.run(guildId, cid, Date.now());
                }
            }

            // Remove old channels (in existing but not in new list)
            for (const cid of existingSet) {
                if (!newSet.has(cid)) {
                    deleteSub.run(guildId, cid);
                    deleteDispatches.run(cid);
                }
            }
        })();
    },

    getNewsChannels: (guildId: string): string[] => {
        // Read from new table
        const stmt = db.prepare('SELECT channel_id FROM news_subscribers WHERE guild_id = ?');
        const results = stmt.all(guildId) as { channel_id: string }[];
        return results.map(r => r.channel_id);
    },

    getAllSubscriptions: (): { guildId: string, channelId: string, boundAt: number }[] => {
        const stmt = db.prepare('SELECT guild_id, channel_id, bound_at FROM news_subscribers');
        const results = stmt.all() as { guild_id: string, channel_id: string, bound_at: number }[];
        return results.map(r => ({
            guildId: r.guild_id,
            channelId: r.channel_id,
            boundAt: r.bound_at || 0
        }));
    },

    // Deprecated but kept for compatibility if needed elsewhere
    getAllNewsChannels: (): { guildId: string, channelIds: string[] }[] => {
        // Synthesize from news_subscribers
        const stmt = db.prepare('SELECT guild_id, channel_id FROM news_subscribers');
        const results = stmt.all() as { guild_id: string, channel_id: string }[];
        
        const map = new Map<string, string[]>();
        for (const r of results) {
             if (!map.has(r.guild_id)) map.set(r.guild_id, []);
             map.get(r.guild_id)?.push(r.channel_id);
        }

        return Array.from(map.entries()).map(([guildId, channelIds]) => ({ guildId, channelIds }));
    },

    removeChannel: (guildId: string, channelId: string) => {
        const stmtSub = db.prepare('DELETE FROM news_subscribers WHERE guild_id = ? AND channel_id = ?');
        const stmtDispatch = db.prepare('DELETE FROM news_dispatches WHERE channel_id = ?');
        
        // Also update legacy config to keep in sync
        const channels = database.getNewsChannels(guildId).filter(id => id !== channelId);
        const stmtLegacy = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, news_channels) VALUES (?, ?)');

        db.transaction(() => {
            stmtSub.run(guildId, channelId);
            stmtDispatch.run(channelId);
            stmtLegacy.run(guildId, JSON.stringify(channels));
        })();
    },

    removeGuild: (guildId: string) => {
        const stmtLegacy = db.prepare('DELETE FROM guild_config WHERE guild_id = ?');
        const stmtSub = db.prepare('DELETE FROM news_subscribers WHERE guild_id = ?');
        const stmtDispatch = db.prepare('DELETE FROM news_dispatches WHERE guild_id = ?');
        
        db.transaction(() => {
            stmtLegacy.run(guildId);
            stmtSub.run(guildId);
            stmtDispatch.run(guildId);
        })();
    },

    // Global News Methods
    upsertGlobalNews: (item: GlobalNewsItem) => {
        const stmt = db.prepare(`
            INSERT INTO global_news (id, title, url, raw_markdown, content_hash, published_at, last_updated)
            VALUES (@id, @title, @url, @raw_markdown, @content_hash, @published_at, @last_updated)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                url = excluded.url,
                raw_markdown = excluded.raw_markdown,
                content_hash = excluded.content_hash,
                last_updated = excluded.last_updated
        `);
        stmt.run(item);
    },

    getGlobalNews: (id: string): GlobalNewsItem | undefined => {
        const stmt = db.prepare('SELECT * FROM global_news WHERE id = ?');
        return stmt.get(id) as GlobalNewsItem | undefined;
    },

    getRecentGlobalNews: (limit: number = 3): GlobalNewsItem[] => {
        const stmt = db.prepare('SELECT * FROM global_news ORDER BY id DESC LIMIT ?');
        return stmt.all(limit) as GlobalNewsItem[];
    },

    // Dispatch Methods
    getDispatch: (newsId: string, channelId: string): NewsDispatch | undefined => {
        const stmt = db.prepare('SELECT * FROM news_dispatches WHERE news_id = ? AND channel_id = ?');
        return stmt.get(newsId, channelId) as NewsDispatch | undefined;
    },

    saveDispatch: (dispatch: NewsDispatch) => {
        const stmt = db.prepare(`
            INSERT INTO news_dispatches (news_id, guild_id, channel_id, message_id, last_hash)
            VALUES (@news_id, @guild_id, @channel_id, @message_id, @last_hash)
            ON CONFLICT(news_id, channel_id) DO UPDATE SET
                message_id = excluded.message_id,
                last_hash = excluded.last_hash
        `);
        stmt.run(dispatch);
    },

    // Legacy support / General State
    setLastServerStatus: (status: string) => {
        const stmt = db.prepare('INSERT OR REPLACE INTO news_state (key, value) VALUES (?, ?)');
        stmt.run('last_server_status', status);
    },

    getLastServerStatus: (): string | undefined => {
        const stmt = db.prepare('SELECT value FROM news_state WHERE key = ?');
        const result = stmt.get('last_server_status') as { value: string } | undefined;
        return result?.value;
    }
};
