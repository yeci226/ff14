import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { getNewsContent } from "../scraper";
import { NewsNotifier } from "../services/NewsNotifier";
import * as dotenv from "dotenv";
import path from "path";

// Load env from root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Error: DISCORD_TOKEN not found in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(
    "Usage: ts-node src/scripts/send_test_news.ts <NEWS_ID> <CHANNEL_ID> [OPTIONAL_TITLE]"
  );
  console.log(
    "Example: ts-node src/scripts/send_test_news.ts b7DgXXwRqqQ1 1234567890"
  );
  process.exit(1);
}

const newsId = args[0];
const channelId = args[1];
const mockTitle = args[2] || `Test News ID: ${newsId}`;

async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  try {
    await client.login(token);
    console.log(`Logged in as ${client.user?.tag}`);

    const url = `https://www.ffxiv.com.tw/web/news/news_content.aspx?id=${newsId}`;
    console.log(`Fetching news from: ${url}`);

    const result = await getNewsContent(url);
    if (!result) {
      console.error("Failed to fetch news content. Check ID or network.");
      process.exit(1);
    }

    const { blocks, timestamp, avatarUrl } = result;
    console.log(
      `Fetched ${blocks.length} blocks. Avatar: ${avatarUrl || "None"}`
    );

    const notifier = new NewsNotifier(client);

    // Mock Item
    const item = {
      id: newsId,
      title: mockTitle,
      url: url,
      date: new Date(timestamp || Date.now()).toISOString(),
    };

    console.log("Building payload...");
    const payload = await notifier.buildPayload(
      item,
      blocks,
      timestamp || Date.now(),
      avatarUrl
    );

    console.log("--- PAYLOAD JSON ---");
    // console.log(JSON.stringify(payload, null, 2));
    console.log("Payload constructed. Sending...");
    console.log("--------------------");

    console.log("Sending to channel...");
    const channel = (await client.channels.fetch(channelId)) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      console.error("Invalid channel or not a text channel.");
      process.exit(1);
    }

    // @ts-ignore
    await channel.send(payload);
    console.log("Successfully sent test news!");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.destroy();
  }
}

main();
