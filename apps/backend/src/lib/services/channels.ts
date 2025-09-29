import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import {
  type ChannelCapability,
  type ChannelPlatform,
  type CreateChannelRequest,
  TelegramConfigSchema,
  type UpdateChannelRequest,
} from "@/schemas/channels-params";
import type {
  ChannelResponse,
  CreateChannelResponse,
  DeleteChannelResponse,
  ListChannelsResponse,
  UpdateChannelResponse,
} from "@/schemas/channels-responses";
import { formatToISO8601 } from "../db-helpers";
import { decrypt, encrypt } from "../encryption";
import { createChildLogger } from "../logger";
import { recordHistory } from "./history";
import { startTelegramBot, stopTelegramBot } from "./telegram";

const logger = createChildLogger("channels");

/**
 * Validates and encrypts platform-specific config
 */
function validateAndEncryptConfig(
  platform: ChannelPlatform,
  config: any,
): any | null {
  try {
    let validatedConfig: any;

    switch (platform) {
      case "telegram":
        validatedConfig = TelegramConfigSchema.parse(config);
        // Encrypt the bot token
        validatedConfig.bot_token = encrypt(validatedConfig.bot_token);
        break;

      case "slack":
      case "whatsapp":
      case "email":
        // TODO: Implement validation schemas for other platforms
        validatedConfig = config;
        break;

      default:
        logger.error({ platform }, "Unsupported platform");
        return null;
    }

    return validatedConfig;
  } catch (error) {
    logger.error(
      {
        platform,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Failed to validate/encrypt config",
    );
    return null;
  }
}

/**
 * Formats a channel for API response (excludes sensitive config)
 */
function formatChannelForResponse(channel: any): ChannelResponse {
  return {
    id: channel.id,
    userId: channel.userId,
    name: channel.name,
    platform: channel.platform,
    capability: channel.capability,
    isActive: channel.isActive,
    createdAt: formatToISO8601(channel.createdAt),
    updatedAt: formatToISO8601(channel.updatedAt),
  };
}

/**
 * Get all channels for a user
 */
export async function getUserChannels(
  userId: string,
): Promise<ListChannelsResponse> {
  try {
    const userChannels = await db.query.channels.findMany({
      where: eq(channels.userId, userId),
      orderBy: (channels, { desc }) => [desc(channels.createdAt)],
    });

    const formattedChannels = userChannels.map(formatChannelForResponse);

    return {
      channels: formattedChannels,
      total: formattedChannels.length,
    };
  } catch (error) {
    logger.error(
      {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Error fetching user channels",
    );
    throw new Error("Failed to fetch channels");
  }
}

/**
 * Create a new channel
 */
export async function createChannel(
  userId: string,
  channelData: CreateChannelRequest,
): Promise<CreateChannelResponse> {
  try {
    // Validate and encrypt the platform-specific config
    const encryptedConfig = validateAndEncryptConfig(
      channelData.platform,
      channelData.config,
    );
    if (!encryptedConfig) {
      throw new Error("Invalid configuration for platform");
    }

    // Create the channel
    const [newChannel] = await db
      .insert(channels)
      .values({
        userId,
        name: channelData.name,
        platform: channelData.platform,
        capability: channelData.capability,
        config: encryptedConfig,
        isActive: true,
      })
      .returning();

    if (!newChannel) {
      throw new Error("Failed to create channel");
    }

    // Record history
    await recordHistory({
      action: "create",
      itemType: "channel",
      itemId: newChannel.id,
      itemName: channelData.name,
      afterData: {
        ...formatChannelForResponse(newChannel),
        platform: channelData.platform,
        capability: channelData.capability,
      },
      actor: "user",
      userId: userId,
    });

    // Start the bot if it's a Telegram channel
    if (channelData.platform === "telegram") {
      const started = await startTelegramBot(newChannel.id);
      if (!started) {
        logger.warn(
          { channelId: newChannel.id },
          "Failed to start Telegram bot after channel creation",
        );
      }
    }

    logger.info(
      {
        channelId: newChannel.id,
        userId,
        platform: channelData.platform,
      },
      "Channel created successfully",
    );

    return {
      channel: formatChannelForResponse(newChannel),
      message: "Channel created successfully",
    };
  } catch (error) {
    logger.error(
      {
        userId,
        channelData,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Error creating channel",
    );

    if (
      error instanceof Error &&
      error.message === "Invalid configuration for platform"
    ) {
      throw error;
    }

    throw new Error("Failed to create channel");
  }
}

/**
 * Update an existing channel
 */
export async function updateChannel(
  channelId: string,
  userId: string,
  updateData: UpdateChannelRequest,
): Promise<UpdateChannelResponse> {
  try {
    // Get existing channel
    const existingChannel = await db.query.channels.findFirst({
      where: and(eq(channels.id, channelId), eq(channels.userId, userId)),
    });

    if (!existingChannel) {
      throw new Error("Channel not found");
    }

    // Prepare update object
    const updateValues: any = {
      updatedAt: new Date(),
    };

    if (updateData.name !== undefined) {
      updateValues.name = updateData.name;
    }

    if (updateData.capability !== undefined) {
      updateValues.capability = updateData.capability;
    }

    if (updateData.isActive !== undefined) {
      updateValues.isActive = updateData.isActive;
    }

    if (updateData.config !== undefined) {
      // Validate and encrypt the new config
      const encryptedConfig = validateAndEncryptConfig(
        existingChannel.platform,
        updateData.config,
      );
      if (!encryptedConfig) {
        throw new Error("Invalid configuration for platform");
      }
      updateValues.config = encryptedConfig;
    }

    // Update the channel
    const [updatedChannel] = await db
      .update(channels)
      .set(updateValues)
      .where(and(eq(channels.id, channelId), eq(channels.userId, userId)))
      .returning();

    if (!updatedChannel) {
      throw new Error("Channel not found");
    }

    // Record history
    await recordHistory({
      action: "update",
      itemType: "channel",
      itemId: channelId,
      itemName: updatedChannel.name,
      beforeData: formatChannelForResponse(existingChannel),
      afterData: formatChannelForResponse(updatedChannel),
      actor: "user",
      userId: userId,
    });

    // Handle Telegram bot restart if config or active status changed
    if (existingChannel.platform === "telegram") {
      if (
        updateData.config !== undefined ||
        updateData.isActive !== undefined
      ) {
        // Stop existing bot
        await stopTelegramBot(channelId);

        // Start new bot if channel is active
        if (updatedChannel.isActive) {
          const started = await startTelegramBot(channelId);
          if (!started) {
            logger.warn(
              { channelId },
              "Failed to restart Telegram bot after channel update",
            );
          }
        }
      }
    }

    logger.info(
      {
        channelId,
        userId,
      },
      "Channel updated successfully",
    );

    return {
      channel: formatChannelForResponse(updatedChannel),
      message: "Channel updated successfully",
    };
  } catch (error) {
    logger.error(
      {
        channelId,
        userId,
        updateData,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Error updating channel",
    );

    if (
      error instanceof Error &&
      (error.message === "Channel not found" ||
        error.message === "Invalid configuration for platform")
    ) {
      throw error;
    }

    throw new Error("Failed to update channel");
  }
}

/**
 * Delete a channel
 */
export async function deleteChannel(
  channelId: string,
  userId: string,
): Promise<DeleteChannelResponse> {
  try {
    // Get existing channel for history
    const existingChannel = await db.query.channels.findFirst({
      where: and(eq(channels.id, channelId), eq(channels.userId, userId)),
    });

    if (!existingChannel) {
      throw new Error("Channel not found");
    }

    // Stop Telegram bot if it exists
    if (existingChannel.platform === "telegram") {
      await stopTelegramBot(channelId);
    }

    // Delete the channel
    const deletedRows = await db
      .delete(channels)
      .where(and(eq(channels.id, channelId), eq(channels.userId, userId)))
      .returning();

    if (!deletedRows.length) {
      throw new Error("Channel not found");
    }

    // Record history
    await recordHistory({
      action: "delete",
      itemType: "channel",
      itemId: channelId,
      itemName: existingChannel.name,
      beforeData: formatChannelForResponse(existingChannel),
      actor: "user",
      userId: userId,
    });

    logger.info(
      {
        channelId,
        userId,
        platform: existingChannel.platform,
      },
      "Channel deleted successfully",
    );

    return {
      success: true,
      message: "Channel deleted successfully",
    };
  } catch (error) {
    logger.error(
      {
        channelId,
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Error deleting channel",
    );

    if (error instanceof Error && error.message === "Channel not found") {
      throw error;
    }

    throw new Error("Failed to delete channel");
  }
}

/**
 * Get channels by capability for sending notifications
 */
export async function getNotificationChannels(
  userId: string,
  targetChannelIds?: string[],
): Promise<any[]> {
  try {
    const { inArray, or } = await import("drizzle-orm");

    const whereConditions: any[] = [
      eq(channels.userId, userId),
      eq(channels.isActive, true),
    ];

    // If specific channels are requested
    if (targetChannelIds && targetChannelIds.length > 0) {
      whereConditions.push(inArray(channels.id, targetChannelIds));
    } else {
      // Get all notification-capable channels
      whereConditions.push(
        or(
          eq(channels.capability, "notification"),
          eq(channels.capability, "bidirectional"),
        ),
      );
    }

    const notificationChannels = await db.query.channels.findMany({
      where: and(...whereConditions),
    });

    return notificationChannels;
  } catch (error) {
    logger.error(
      {
        userId,
        targetChannelIds,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Error fetching notification channels",
    );
    throw new Error("Failed to fetch notification channels");
  }
}
