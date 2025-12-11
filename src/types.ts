import { CommandInteraction, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export interface NewsItem {
    id: string;
    title: string;
    url: string;
    date?: string;
}

export interface Command {
    data: SlashCommandBuilder | any; // using any for compatibility with mixed builder types
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
