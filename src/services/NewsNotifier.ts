import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { getLatestNews, getNewsContent } from "../scraper";
import { database } from "../utils/database";
import { Logger } from "../utils/logger";
import crypto from "crypto";

const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes

export class NewsNotifier {
  private client: Client;
  private logger: Logger;
  private interval: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor(client: Client) {
    this.client = client;
    this.logger = new Logger("NewsNotifier");
  }

  start() {
    if (this.interval) {
      this.logger.warn("新聞輪詢服務已在執行中，略過重複啟動");
      return;
    }

    this.logger.info("開始新聞輪詢服務...");
    void this.checkNews();
    this.interval = setInterval(() => this.checkNews(), POLLING_INTERVAL);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  public async checkNews() {
    if (this.isChecking) {
      this.logger.warn("上一輪新聞檢查尚未完成，略過本次輪詢");
      return;
    }

    this.isChecking = true;

    this.logger.info("檢查新聞中...");
    try {
      const newsList = await getLatestNews();

      if (newsList.length === 0) {
        this.logger.warn("未發現新聞");
        return;
      }

      // Process top 3 news items
      const recentNews = newsList.slice(0, 3).reverse();

      // Check if this is the very first run (no global news at all)
      // If so, we might want to skip notifications to avoid spamming everything
      const history = database.getRecentGlobalNews(1);
      const isFirstRun = history.length === 0;

      for (const item of recentNews) {
        await this.processNewsItem(item, isFirstRun);
      }
    } catch (error) {
      this.logger.error(`新聞檢查失敗：${error}`);
    } finally {
      this.isChecking = false;
    }
  }

  private async processNewsItem(item: any, isSystemFirstRun: boolean) {
    // 1. Get or Create Global State
    let globalNews = database.getGlobalNews(item.id);
    const isGloballyNew = !globalNews;

    // 2. Fetch Content
    const result = await getNewsContent(item.url);
    if (!result) return;

    const { blocks, timestamp, avatarUrl, publisher } = result;
    const currentContentHash = crypto
      .createHash("md5")
      .update(item.title + JSON.stringify(blocks))
      .digest("hex");

    // 3. Update Global News matching what we fetched
    // We only update if it's new, hash changed, OR if we are missing the raw_markdown (migration case)
    if (
      isGloballyNew ||
      globalNews?.content_hash !== currentContentHash ||
      !globalNews.raw_markdown
    ) {
      // Log the reason for update
      if (globalNews?.content_hash !== currentContentHash) {
        this.logger.info(
          `Hash Changed for ${item.title}: ${globalNews?.content_hash} -> ${currentContentHash}`,
        );
      }

      // Formatting for storage (optional, but good for debugging or future web view)
      // We'll store the raw text representation or just rely on re-fetching/re-formatting for now?
      // The requirement said "store markdown".
      // Let's generate the markdown representation to store.
      const { formatNewsContent } = await import("../utils/formatter");
      let rawMarkdown = "";
      for (const block of blocks) {
        if (block.type === "text") {
          rawMarkdown += formatNewsContent(block.content) + "\n\n";
        }
      }

      globalNews = {
        id: item.id,
        title: item.title,
        url: item.url,
        raw_markdown: rawMarkdown,
        content_hash: currentContentHash,
        published_at: timestamp || Date.now(),
        last_updated: Date.now(),
      };

      if (isSystemFirstRun) {
        this.logger.info(`初始化新聞歷史 (不發送通知)：${item.title}`);
        database.upsertGlobalNews(globalNews);
        return; // Skip dispatching on first system initialization
      }

      database.upsertGlobalNews(globalNews);
      this.logger.info(`更新全球新聞狀態：${item.title}`);
    }

    if (!globalNews) return; // Should not happen

    // 4. Dispatch to Channels
    // 4. Dispatch to Channels
    const subscriptions = database.getAllSubscriptions();

    for (const sub of subscriptions) {
      await this.syncChannel(
        sub.guildId,
        sub.channelId,
        globalNews,
        blocks,
        item,
        sub.boundAt,
        avatarUrl,
        publisher,
      );
    }
  }

  private async syncChannel(
    guildId: string,
    channelId: string,
    globalNews: any,
    blocks: any[],
    originalItem: any,
    boundAt: number,
    avatarUrl?: string,
    publisher?: string,
  ) {
    const dispatch = database.getDispatch(globalNews.id, channelId);

    // Prepare Payload
    const payload = await this.buildPayload(
      originalItem,
      blocks,
      globalNews.published_at,
      avatarUrl,
      publisher,
    );

    if (dispatch) {
      // Already sent, check if we need to edit
      if (dispatch.last_hash !== globalNews.content_hash) {
        try {
          const channel = (await this.client.channels.fetch(
            channelId,
          )) as TextChannel;
          if (channel && channel.isTextBased()) {
            const message = await channel.messages.fetch(dispatch.message_id);
            if (message) {
              // @ts-ignore
              await message.edit(payload);
              this.logger.success(
                `已更新新聞訊息 ${channel.name} (${globalNews.title})`,
              );

              // Update dispatch record
              database.saveDispatch({
                news_id: globalNews.id,
                guild_id: guildId,
                channel_id: channelId,
                message_id: dispatch.message_id,
                last_hash: globalNews.content_hash,
              });
            }
          }
        } catch (error: any) {
          if (
            error.code === 50001 ||
            error.code === 10003 ||
            error.code === 50013
          ) {
            this.logger.warn(
              `Removing invalid channel ${channelId} (Error: ${error.code}) from guild ${guildId}`,
            );
            database.removeChannel(guildId, channelId);
          } else {
            this.logger.warn(`更新訊息失敗 (可能已刪除): ${error}`);
          }
        }
      }
    } else {
      // Not sent yet.
      // 1. Check if the news is older than the channel binding time
      // If the channel was bound AFTER the news was published, we skip it.
      // (Unless boundAt is 0, which means legacy/migrated channel)
      if (boundAt > 0 && globalNews.published_at < boundAt) {
        return; // Skip: News is older than channel subscription
      }

      // 2. Secondary safety check: Only send recent news (e.g. last 48 hours)
      // This handles cases where boundAt wasn't tracked properly or to prevent super old news re-surfacing
      const newsAge = Date.now() - globalNews.published_at;
      const isRecentNews = newsAge < 48 * 60 * 60 * 1000; // 48 hours

      if (isRecentNews) {
        const claimed = database.tryClaimDispatchSend(globalNews.id, channelId);
        if (!claimed) {
          this.logger.info(
            `跳過重複發送（已有其他實例處理中）：${channelId} (${globalNews.title})`,
          );
          return;
        }

        try {
          const channel = (await this.client.channels.fetch(
            channelId,
          )) as TextChannel;
          if (channel && channel.isTextBased()) {
            // @ts-ignore
            const message = await channel.send(payload);
            this.logger.success(
              `已發送新聞至 ${channel.name} (${globalNews.title})`,
            );

            database.saveDispatch({
              news_id: globalNews.id,
              guild_id: guildId,
              channel_id: channelId,
              message_id: message.id,
              last_hash: globalNews.content_hash,
            });

            await new Promise((resolve) => setTimeout(resolve, 500)); // Rate limit
          }
        } catch (error: any) {
          if (
            error.code === 50001 ||
            error.code === 10003 ||
            error.code === 50013
          ) {
            this.logger.warn(
              `Removing invalid channel ${channelId} (Error: ${error.code}) from guild ${guildId}`,
            );
            database.removeChannel(guildId, channelId);
          } else {
            this.logger.error(`發送通知至頻道 ${channelId} 失敗：${error}`);
          }
        } finally {
          database.releaseDispatchSendClaim(globalNews.id, channelId);
        }
      } else {
        // Determine why we are skipping to log it (debug)
        // this.logger.debug(`Skipping old news for ${channelId}: ${globalNews.title} (Age: ${Math.floor(newsAge/1000/60)}m)`);
      }
    }
  }

  public async buildPayload(
    newsItem: any,
    blocks: any[],
    timestamp: number,
    avatarUrl?: string,
    publisher?: string,
  ) {
    const { formatNewsContent } = await import("../utils/formatter");

    // Main Container Components List
    const mainContainerComponents: any[] = [];

    // 1. Header Components (Title + Date) -> Goes into inner Section (Type 9)
    const headerTextComponents: any[] = [];
    headerTextComponents.push({
      type: 10, // Text Display
      content: `## [${newsItem.title}](${newsItem.url})`,
    });
    let dateString = "";
    if (timestamp) {
      const date = new Date(timestamp);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const min = String(date.getMinutes()).padStart(2, "0");
      dateString = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    } else {
      dateString =
        newsItem.date ||
        new Date().toISOString().slice(0, 16).replace("T", " ");
    }

    const signature = publisher || "FINAL FANTASY XIV 繁體中文版官方";
    headerTextComponents.push({
      type: 10, // Text Display
      content: `-# ${signature}\n<t:${Math.floor(timestamp / 1000)}:f>`,
    });

    const isValidAvatar =
      typeof avatarUrl === "string" &&
      avatarUrl.trim().length > 0 &&
      avatarUrl.length <= 2048 &&
      /^https?:\/\//.test(avatarUrl);

    if (isValidAvatar) {
      mainContainerComponents.push({
        type: 9,
        components: headerTextComponents,
        accessory: {
          type: 11,
          media: {
            url: avatarUrl,
          },
        },
      });
    } else {
      // ⚠️ fallback：不用 section
      mainContainerComponents.push(...headerTextComponents);
    }

    // Add Separator immediately after Header Section
    mainContainerComponents.push({
      type: 14, // Separator
      divider: true,
      spacing: 2,
    });

    // Content Blocks
    let currentTextBuffer = "";
    let pendingImages: any[] = [];
    const files: any[] = [];
    let imageCounter = 0;

    const flushImages = () => {
      if (pendingImages.length > 0) {
        const mediaItems = pendingImages
          .map((img) => {
            if (!img.url) return null;

            // 1. Handle Data URI (Base64)
            if (img.url.startsWith("data:")) {
              const match = img.url.match(/^data:(image\/(\w+));base64,(.+)$/);
              if (match) {
                const ext = match[2] === "jpeg" ? "jpg" : match[2];
                const base64Data = match[3];
                const filename = `img_${Date.now()}_${imageCounter++}.${ext}`;

                files.push({
                  attachment: Buffer.from(base64Data, "base64"),
                  name: filename,
                });

                const item: any = {
                  media: { url: `attachment://${filename}` },
                };
                if (img.description && img.description.trim().length > 0) {
                  item.description = img.description.substring(0, 1024);
                }
                return item;
              }
              return null; // Invalid data URI
            }

            // 2. Handle Normal URL
            if (img.url.length <= 2048) {
              const item: any = { media: { url: img.url } };
              if (img.description && img.description.trim().length > 0) {
                item.description = img.description.substring(0, 1024);
              }
              return item;
            }
            return null; // URL too long
          })
          .filter((item) => item !== null);

        if (mediaItems.length > 0) {
          mainContainerComponents.push({ type: 12, items: mediaItems });
        }
        pendingImages = [];
      }
    };

    const flushText = () => {
      if (currentTextBuffer.trim()) {
        mainContainerComponents.push({
          type: 10,
          content: currentTextBuffer.trim(),
        });
        currentTextBuffer = "";
      }
    };

    for (const block of blocks) {
      if (block.type === "image") {
        flushText();
        pendingImages.push(block);
      } else if (block.type === "text") {
        flushImages();

        let formattedText = formatNewsContent(block.content);

        // Format the specific greeting as H1
        if (formattedText.includes("親愛的光之戰士，您好：")) {
          formattedText = formattedText.replace(
            "親愛的光之戰士，您好：",
            "# 親愛的光之戰士，您好：",
          );
        }

        if (formattedText.includes("FINAL FANTASY XIV 繁體中文版行銷團隊")) {
          if (currentTextBuffer.trim()) {
            mainContainerComponents.push({
              type: 10,
              content: currentTextBuffer.trim(),
            });
            currentTextBuffer = "";
          }

          mainContainerComponents.push({
            type: 14, // Separator
            divider: true,
            spacing: 2,
          });
        }

        currentTextBuffer += formattedText + "\n";
      }
    }

    // Final flush
    flushText();
    flushImages();

    // Create the single Top-Level Container
    const mainContainer: any = {
      type: 17, // ComponentType.CONTAINER
      components: mainContainerComponents,
    };

    // Combine
    const payload: any = {
      content: "",
      flags: 1 << 15, // IS_COMPONENTS_V2
      components: [mainContainer],
      files: files,
    };

    return payload;
  }
}
