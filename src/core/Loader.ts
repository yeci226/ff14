import { glob } from 'glob';
import { Client, Collection, REST, Routes } from 'discord.js';
import { Logger } from '../utils/logger';
import path from 'path';

export class Loader {
    private client: Client;
    private logger: Logger;

    constructor(client: Client) {
        this.client = client;
        this.logger = new Logger('Loader');
    }

    async load(token: string, clientId: string) {
        // Load Events
        const eventsPath = path.join(process.cwd(), 'src', 'events', '*.ts').replace(/\\/g, '/');
        const eventFiles = await glob(eventsPath);

        for (const file of eventFiles) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const event = require(file).default;
            if (event.once) {
                this.client.once(event.name, (...args) => event.execute(...args));
            } else {
                this.client.on(event.name, (...args) => event.execute(...args));
            }
        }
        this.logger.success(`已載入 ${eventFiles.length} 個事件`);

        // Load Commands
        const commandsPath = path.join(process.cwd(), 'src', 'commands', '**', '*.ts').replace(/\\/g, '/');
        const commandFiles = await glob(commandsPath);
        const commands = [];

        for (const file of commandFiles) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const command = require(file).default;
            if ('data' in command && 'execute' in command) {
                // @ts-ignore - attaching commands to client
                this.client.commands.set(command.data.name, command);
                commands.push(command.data.toJSON());
            } else {
                this.logger.warn(`位於 ${file} 的指令缺少必要的 "data" 或 "execute" 屬性`);
            }
        }
        this.logger.success(`已載入 ${commands.length} 個指令`);

        // Register Commands
        const rest = new REST().setToken(token);

        try {
            this.logger.info('開始重新整理應用程式 (/) 指令');

            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );

            this.logger.success('成功重新載入應用程式 (/) 指令');
        } catch (error) {
            this.logger.error(`重新載入指令失敗：${error}`);
        }
    }
}
