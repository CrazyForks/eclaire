import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import z from "zod/v4";
import { getAuthenticatedUserId } from "@/lib/auth-utils";
import { isValidConversationId } from "@/lib/id-generator";
import { createChildLogger } from "@/lib/logger";
import {
  createConversation,
  deleteConversation,
  getConversationWithMessages,
  listConversations,
  updateConversation,
} from "@/lib/services/conversations";
import { recordHistory } from "@/lib/services/history";
import {
  CreateConversationSchema,
  ListConversationsSchema,
  UpdateConversationSchema,
} from "@/schemas/conversation-params";
import {
  deleteConversationRouteDescription,
  getConversationRouteDescription,
  getConversationsRouteDescription,
  postConversationRouteDescription,
  putConversationRouteDescription,
} from "@/schemas/conversation-routes";
import type { RouteVariables } from "@/types/route-variables";

const logger = createChildLogger("conversations");

export const conversationsRoutes = new Hono<{ Variables: RouteVariables }>();

// Schemas are now imported from dedicated schema files

// POST /api/conversations - Create new conversation
conversationsRoutes.post(
  "/",
  describeRoute(postConversationRouteDescription),
  async (c) => {
    const requestId = c.get("requestId");
    const userId = await getAuthenticatedUserId(c);

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const body = CreateConversationSchema.parse(await c.req.json());

      const conversation = await createConversation({
        userId,
        title: body.title,
      });

      await recordHistory({
        action: "conversation_created",
        itemType: "conversation",
        itemId: conversation.id,
        itemName: conversation.title,
        beforeData: null,
        afterData: conversation,
        actor: "user",
        userId,
      });

      logger.info(
        { requestId, userId, conversationId: conversation.id },
        "Created new conversation",
      );

      return c.json({
        status: "OK",
        conversation,
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          userId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Error creating conversation",
      );

      if (error instanceof z.ZodError) {
        return c.json(
          { error: "Invalid request format", details: error.issues },
          400,
        );
      }

      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// GET /api/conversations - List user's conversations
conversationsRoutes.get(
  "/",
  describeRoute(getConversationsRouteDescription),
  async (c) => {
    const requestId = c.get("requestId");
    const userId = await getAuthenticatedUserId(c);

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const query = ListConversationsSchema.parse(c.req.query());
      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const conversations = await listConversations(userId, limit, offset);

      logger.info(
        { requestId, userId, count: conversations.length },
        "Listed conversations",
      );

      return c.json({
        status: "OK",
        conversations,
        pagination: {
          limit,
          offset,
          count: conversations.length,
        },
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          userId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Error listing conversations",
      );

      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// GET /api/conversations/:id - Get conversation with messages
conversationsRoutes.get(
  "/:id",
  describeRoute(getConversationRouteDescription),
  async (c) => {
    const requestId = c.get("requestId");
    const userId = await getAuthenticatedUserId(c);
    const conversationId = c.req.param("id");

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!isValidConversationId(conversationId)) {
      return c.json({ error: "Invalid conversation ID" }, 400);
    }

    try {
      const conversation = await getConversationWithMessages(
        conversationId,
        userId,
      );

      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      logger.info(
        {
          requestId,
          userId,
          conversationId,
          messageCount: conversation.messageCount,
        },
        "Retrieved conversation with messages",
      );

      return c.json({
        status: "OK",
        conversation,
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          userId,
          conversationId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Error retrieving conversation",
      );

      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// PUT /api/conversations/:id - Update conversation
conversationsRoutes.put(
  "/:id",
  describeRoute(putConversationRouteDescription),
  async (c) => {
    const requestId = c.get("requestId");
    const userId = await getAuthenticatedUserId(c);
    const conversationId = c.req.param("id");

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!isValidConversationId(conversationId)) {
      return c.json({ error: "Invalid conversation ID" }, 400);
    }

    try {
      const body = UpdateConversationSchema.parse(await c.req.json());

      const updatedConversation = await updateConversation(
        conversationId,
        userId,
        body,
      );

      if (!updatedConversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      await recordHistory({
        action: "conversation_updated",
        itemType: "conversation",
        itemId: conversationId,
        itemName: updatedConversation.title,
        beforeData: { updates: body },
        afterData: updatedConversation,
        actor: "user",
        userId,
      });

      logger.info(
        { requestId, userId, conversationId },
        "Updated conversation",
      );

      return c.json({
        status: "OK",
        conversation: updatedConversation,
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          userId,
          conversationId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Error updating conversation",
      );

      if (error instanceof z.ZodError) {
        return c.json(
          { error: "Invalid request format", details: error.issues },
          400,
        );
      }

      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// DELETE /api/conversations/:id - Delete conversation
conversationsRoutes.delete(
  "/:id",
  describeRoute(deleteConversationRouteDescription),
  async (c) => {
    const requestId = c.get("requestId");
    const userId = await getAuthenticatedUserId(c);
    const conversationId = c.req.param("id");

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!isValidConversationId(conversationId)) {
      return c.json({ error: "Invalid conversation ID" }, 400);
    }

    try {
      const success = await deleteConversation(conversationId, userId);

      if (!success) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      await recordHistory({
        action: "conversation_deleted",
        itemType: "conversation",
        itemId: conversationId,
        itemName: "Deleted Conversation",
        beforeData: { conversationId },
        afterData: null,
        actor: "user",
        userId,
      });

      logger.info(
        { requestId, userId, conversationId },
        "Deleted conversation",
      );

      return c.json({
        status: "OK",
        message: "Conversation deleted successfully",
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          userId,
          conversationId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Error deleting conversation",
      );

      return c.json({ error: "Internal server error" }, 500);
    }
  },
);
