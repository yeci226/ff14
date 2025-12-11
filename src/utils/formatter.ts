export function formatNewsContent(text: string): string {
    if (!text) return '';

    // 1. Normalize line endings
    let formatted = text.replace(/\r\n/g, '\n');

    // 2. Remove excessive whitespace at start/end of lines
    formatted = formatted.split('\n').map(line => line.trim()).join('\n');

    // 3. Ensure paragraphs are separated by empty lines (Markdown standard)
    // Replace single newlines with double newlines if they look like paragraph breaks
    // But we need to be careful not to break lists or tight groups.
    // The user example shows they want to preserve some grouping but add spacing.
    
    // Strategy: 
    // - Collapse 3+ newlines to 2 (max one empty line between blocks)
    // - Ensure headings or specific sections have spacing
    
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    // 4. Add Markdown styling
    // Bold "維護時間"
    formatted = formatted.replace(/^(維護時間)$/gm, '**$1**');
    
    // Bold date lines like "2025/12/10（三） 08:00~12:00（GMT+8）"
    formatted = formatted.replace(/^(\d{4}\/\d{1,2}\/\d{1,2}.*GMT\+8.*)$/gm, '`$1`');

    // Bold "親愛的光之戰士，您好！"
    formatted = formatted.replace(/^(親愛的光之戰士，您好！)$/gm, '# $1');

    // 5. Convert URLs to Markdown links
    // Avoid re-linking already formatted Markdown links: [text](url)
    // Also avoid matching trailing parentheses which might be part of surrounding text
    formatted = formatted.replace(/(?<!\]\()(https?:\/\/[^\s\)]+)/g, '[$1]($1)');

    return formatted;
}
