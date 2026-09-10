import express, { type Request, type Response } from "express";
import { accessTokenUserId, authMiddleware } from "../auth.js";
import { getPrivacy } from "../storage.js";
import { deepSeekConfigStatus } from "../deepseek.js";
import { chatIsBusy, sendChatMessage } from "./conversation.js";
import { clearChatHistory, getChatPage } from "./store.js";
import { ChatError } from "./types.js";

function userId(request: Request): number {
  const value = (request as Request & { authUserId?: number }).authUserId;
  if (!value) throw new ChatError(401, "Sign in to chat with Hale.");
  return value;
}

function sendError(error: unknown, response: Response): void {
  response.status(error instanceof ChatError ? error.status : 500)
    .json({ error: error instanceof ChatError ? error.message : "Chat could not complete this request. Please try again." });
}

export function createAssistantRouter() {
  const router = express.Router();
  router.use(authMiddleware);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", (request, response) => {
    try {
      const id = userId(request);
      if (Object.keys(request.query).some((key) => key !== "before") || request.query.before !== undefined && (typeof request.query.before !== "string" || !/^[a-zA-Z0-9-]{16,80}$/u.test(request.query.before))) throw new ChatError(400, "Choose a valid earlier-message cursor.");
      response.json({ ...getChatPage(id, request.query.before as string | undefined), online: getPrivacy(id)?.dataForRecommendations === true && deepSeekConfigStatus().configured });
    } catch (error) { sendError(error, response); }
  });
  router.post("/", async (request, response) => {
    try {
      const id = userId(request);
      response.json({ turn: await sendChatMessage(id, request.body, { isAuthorized: () => accessTokenUserId(request.headers.authorization) === id }) });
    }
    catch (error) { sendError(error, response); }
  });
  router.delete("/", (request, response) => {
    try {
      const id = userId(request);
      if (chatIsBusy(id)) throw new ChatError(409, "Wait for the current reply before clearing chat.");
      clearChatHistory(id);
      response.json({ message: "Chat history cleared." });
    } catch (error) { sendError(error, response); }
  });
  return router;
}
