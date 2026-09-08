import type { RequestHandler } from "express";
import { accessTokenUserId } from "./auth.js";

const windowMs = 60_000;
const requestLimit = 60;
const clients = new Map<string, { startedAt: number; count: number }>();

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - windowMs;
  for (const [key, value] of clients) {
    if (value.startedAt < cutoff) {
      clients.delete(key);
    }
  }
}, windowMs);
cleanupTimer.unref();

export const apiRateLimit: RequestHandler = (request, response, next) => {
  const userId = accessTokenUserId(request.header("authorization"));
  const key = userId === null
    ? `ip:${request.ip || request.socket.remoteAddress || "unknown"}`
    : `user:${userId}`;
  const now = Date.now();
  const current = clients.get(key);
  const window = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : current;

  window.count += 1;
  clients.set(key, window);
  response.setHeader("X-RateLimit-Limit", requestLimit);
  response.setHeader("X-RateLimit-Remaining", Math.max(0, requestLimit - window.count));

  if (window.count > requestLimit) {
    const retryAfter = Math.max(1, Math.ceil((window.startedAt + windowMs - now) / 1000));
    response.setHeader("Retry-After", retryAfter);
    response.status(429).json({ error: "Too many requests. Try again shortly." });
    return;
  }

  next();
};
