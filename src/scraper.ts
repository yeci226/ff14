import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsItem } from './types';

const URL = 'https://www.ffxiv.com.tw/web/news/news_list.aspx';

export async function getLatestNews(): Promise<NewsItem[]> {
    try {
        const response = await axios.get(URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        const items: NewsItem[] = [];

        // Select news items
        const newsItems = $('.item');
        console.log(`[Scraper] Found ${newsItems.length} items`);

        newsItems.each((_, el) => {
            const element = $(el);
            
            // Extract ID from .news_id (e.g., "74")
            const id = element.find('.news_id').text().trim();
            
            // Extract Date from .publish_date (e.g., "2025/12/02")
            const date = element.find('.publish_date').text().trim();
            
            // Extract Title and URL from 'a' tag
            const link = element.find('.title a');
            const title = link.text().trim();
            const href = link.attr('href');

            if (id && href) {
                // Construct full URL
                let fullUrl = href;
                if (!href.startsWith('http')) {
                    if (href.startsWith('/')) {
                        fullUrl = `https://www.ffxiv.com.tw${href}`;
                    } else {
                        fullUrl = `https://www.ffxiv.com.tw/web/news/${href}`;
                    }
                }

                items.push({
                    id,
                    title,
                    url: fullUrl,
                    date
                });
            }
        });

        // Sort items by ID descending to ensure the latest news is first
        items.sort((a, b) => {
            const idA = parseInt(a.id, 10);
            const idB = parseInt(b.id, 10);
            return idB - idA;
        });

        return items;

    } catch (error) {
        console.error('獲取新聞時發生錯誤：', error);
        return [];
    }
}

export type ContentBlock = 
    | { type: 'text', content: string }
    | { type: 'image', url: string, description?: string };

export async function getNewsContent(url: string): Promise<{ blocks: ContentBlock[], timestamp?: number } | null> {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        const article = $('.article');
        
        // Pre-process HTML to Markdown
        article.find('br').replaceWith('\n');
        article.find('strong, b').each((_, el) => {
            const text = $(el).text();
            $(el).replaceWith(`**${text}**`);
        });

        // Convert headings to markdown
        const processHeading = (level: number, mdPrefix: string) => {
             const headings = article.find(`h${level}`);
             if (headings.length > 0) {
                 console.log(`[Scraper] Found ${headings.length} h${level} tags to convert.`);
             }
             headings.each((_, el) => {
                const text = $(el).text().trim();
                console.log(`[Scraper] Converting h${level}: "${text}" -> "${mdPrefix}${text}"`);
                // Ensure we have newlines around headers
                $(el).replaceWith(`\n${mdPrefix}${text}\n`);
            });
        };

        processHeading(1, '# ');
        processHeading(2, '## ');
        processHeading(3, '### '); // Most common section header in this site
        processHeading(4, '### '); // Sub-section
        processHeading(5, '**');   // Treat smaller headers as bold
        processHeading(6, '**');

        // Handle specific styles if they are spans (fallback)
        article.find('span[style*="font-weight: bold"]').each((_, el) => {
             const text = $(el).text();
             $(el).replaceWith(`**${text}**`);
        });

        // Convert links to markdown
        article.find('a').each((_, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            const href = $el.attr('href');
            if (text && href) {
                let fullUrl = href;
                if (!href.startsWith('http')) {
                    if (href.startsWith('/')) {
                        fullUrl = `https://www.ffxiv.com.tw${href}`;
                    } else {
                        fullUrl = `https://www.ffxiv.com.tw/web/news/${href}`;
                    }
                }
                $el.replaceWith(`[${text}](${fullUrl})`);
            }
        });
        
        const blocks: ContentBlock[] = [];

        // Recursive function to extract blocks
        const extractBlocks = (element: any) => {
            // If it's a cheerio object, get the underlying element
            const el = element[0] || element;
            
            if (el.type === 'tag') {
                if (el.name === 'img') {
                    const src = $(el).attr('src');
                    const alt = $(el).attr('alt');
                    if (src) {
                        const fullUrl = src.startsWith('http') ? src : `https://www.ffxiv.com.tw${src.startsWith('/') ? '' : '/'}${src}`;
                        blocks.push({ type: 'image', url: fullUrl, description: alt });
                    }
                    return;
                }
                
                // For other tags, check if they contain images
                const $el = $(el);
                const hasImages = $el.find('img').length > 0;
                
                if (hasImages) {
                    // Recurse
                    $el.contents().each((_, child) => {
                        extractBlocks(child);
                    });
                } else {
                     // No images, treat as text
                    const rawText = $el.text();
                    const clean = cleanText(rawText);
                    if (clean) {
                        blocks.push({ type: 'text', content: clean });
                    }
                }
            } else if (el.type === 'text') {
                const rawText = $(el).text();
                const clean = cleanText(rawText);
                if (clean) {
                    blocks.push({ type: 'text', content: clean });
                }
            }
        };

        // Start extraction
        article.contents().each((_, el) => extractBlocks(el));

        // Extract timestamp
        let timestamp: number | undefined;
        const dateEl = $('.Date');
        let dateStr = dateEl.length > 0 ? dateEl.text().trim() : '';
        
        if (!dateStr) {
            const bodyText = $('body').text();
            const match = bodyText.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
            if (match) {
                dateStr = match[0];
            }
        }

        if (dateStr) {
            const isoStr = dateStr.replace(' ', 'T') + ':00+08:00';
            timestamp = new Date(isoStr).getTime();
            if (isNaN(timestamp)) {
                timestamp = new Date(dateStr).getTime();
            }
        }

        return { blocks, timestamp };
    } catch (error) {
        console.error(`[Scraper] Error fetching news content: ${error}`);
        return null;
    }
}

function cleanText(text: string): string {
    if (!text) return '';
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
}
