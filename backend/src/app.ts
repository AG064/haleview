import { defaultTimezone, localDateTimeToIso, TimezoneValidationError } from "./timezone.js";
import { getNutritionPreferences } from "./nutrition/storage.js";
import express, { type ErrorRequestHandler, type Response } from "express";
import {
  AuthError,
  accountStatus,
  authConfig,
  authMiddleware,
  beginTwoFactor,
  confirmPasswordReset,
  confirmTwoFactor,
  disableTwoFactor,
  getLatestEmail,
  login,
  refresh,
  register,
  requestPasswordReset,
  verifyEmail,
  verifyTwoFactor
} from "./auth.js";
import { ProfileValidationError } from "./profile.js";
import { GuestDuplicateActivityError, GuestValidationError, saveGuestActivity, saveGuestProfile } from "./guest.js";
import { apiRateLimit } from "./rate-limit.js";
import { DeepSeekGenerationError, deepSeekConfigStatus, generateDeepSeekGuidance } from "./deepseek.js";
import {
  addActivity,
  DuplicateActivityError,
  exportData,
  getHistory,
  getProfile,
  getPrivacy,
  getRecommendations,
  HistoryValidationError,
  saveRecommendations,
  saveProfile
} from "./storage.js";

import { beginOAuth, completeOAuth, exchangeOAuthTicket, oauthProviderStatus } from "./oauth.js";
import { createNutritionRouter } from "./nutrition/routes.js";
import { exportNutritionData } from "./nutrition/export.js";
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use("/api", apiRateLimit);
app.use("/api/nutrition", createNutritionRouter());

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "haleview" });
});

function sendAuthError(error: unknown, response: Response): void {
  if (error instanceof AuthError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: "The account request could not be completed." });
}

app.post("/api/auth/register", async (request, response) => {
  try {
    const result = await register(request.body);
    response.status(201).json({
      message: result.verificationLink ? "Open the verification link shown below." : "Check your email for the verification link.",
      ...result
    });
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.get("/api/auth/verify", (request, response) => {
  try {
    verifyEmail(typeof request.query.token === "string" ? request.query.token : undefined);
    response.json({ message: "Email verified. You can sign in." });
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/login", (request, response) => {
  try {
    response.json(login(request.body));
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/2fa/verify", (request, response) => {
  try {
    response.json(verifyTwoFactor(request.body));
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/refresh", (request, response) => {
  try {
    response.json(refresh(request.body));
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/password-reset/request", async (request, response) => {
  try {
    const result = await requestPasswordReset(request.body);
    response.json({
      message: result.resetLink ? "Open the reset link shown below." : "If the account exists, a reset link was sent.",
      ...result
    });
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/password-reset/confirm", (request, response) => {
  try {
    confirmPasswordReset(request.body);
    response.json({ message: "Password changed. Sign in again." });
  } catch (error) {
    sendAuthError(error, response);
  }
});

function authUserId(request: express.Request): number {
  const userId = (request as { authUserId?: number }).authUserId;
  if (!userId) {
    throw new AuthError(401, "Sign in is required.");
  }
  return userId;
}

app.post("/api/auth/2fa/setup", authMiddleware, (request, response) => {
  try {
    response.json(beginTwoFactor(authUserId(request)));
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/2fa/confirm", authMiddleware, (request, response) => {
  try {
    confirmTwoFactor(authUserId(request), request.body);
    response.json({ message: "Two-step sign-in enabled." });
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.post("/api/auth/2fa/disable", authMiddleware, (request, response) => {
  try {
    disableTwoFactor(authUserId(request), request.body);
    response.json({ message: "Two-step sign-in disabled." });
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.get("/api/auth/me", authMiddleware, (request, response) => {
  try {
    response.json(accountStatus(authUserId(request)));
  } catch (error) {
    sendAuthError(error, response);
  }
});

function publicAppUrl(): string {
  return (process.env.PUBLIC_APP_URL?.trim() || "http://127.0.0.1:5173").replace(/\/$/u, "");
}

function oauthTicketCookie(request: express.Request): string | undefined {
  return authCookie(request, "oauth_ticket");
}

function authCookie(request: express.Request, name: string): string | undefined {
  const cookie = request.header("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, "u").exec(cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function clearOAuthTicket(response: Response): void {
  response.setHeader("Set-Cookie", "oauth_ticket=; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=0");
}

app.get("/api/auth/oauth/:provider", (request, response) => {
  try {
    const start = beginOAuth(request.params.provider);
    const secure = publicAppUrl().startsWith("https://") ? "; Secure" : "";
    response.setHeader("Set-Cookie", `oauth_binding=${encodeURIComponent(start.binding)}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=600${secure}`);
    response.redirect(start.url);
  } catch (error) {
    sendAuthError(error, response);
  }
});

app.get("/api/auth/oauth/:provider/callback", async (request, response) => {
  const clearBinding = "oauth_binding=; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=0";
  try {
    const ticket = await completeOAuth(request.params.provider, request.query.state, request.query.code, authCookie(request, "oauth_binding"));
    const secure = publicAppUrl().startsWith("https://") ? "; Secure" : "";
    response.setHeader("Set-Cookie", [
      `oauth_ticket=${encodeURIComponent(ticket)}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=60${secure}`,
      clearBinding
    ]);
    response.redirect(`${publicAppUrl()}/?oauth_ticket=1`);
  } catch (error) {
    response.setHeader("Set-Cookie", clearBinding);
    const message = error instanceof AuthError ? error.message : "Sign-in could not be completed.";
    response.redirect(`${publicAppUrl()}/?oauth_error=${encodeURIComponent(message)}`);
  }
});

app.post("/api/auth/oauth/exchange", (request, response) => {
  try {
    const tokens = exchangeOAuthTicket(oauthTicketCookie(request));
    clearOAuthTicket(response);
    response.json(tokens);
  } catch (error) {
    clearOAuthTicket(response);
    sendAuthError(error, response);
  }
});
app.get("/api/auth/config", (_request, response) => {
  response.json({
    ...authConfig(),
    oauthProviders: oauthProviderStatus(),
    onlineAiAvailable: deepSeekConfigStatus().configured
  });
});

app.get("/api/auth/dev/outbox/latest", (_request, response) => {
  if (process.env.NODE_ENV === "production") {
    response.status(404).json({ error: "Not found." });
    return;
  }
  response.json({ email: getLatestEmail() });
});

app.post("/api/guest/profile", (request, response) => {
  try {
    response.json(saveGuestProfile(request.body));
  } catch (error) {
    if (error instanceof ProfileValidationError || error instanceof GuestValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "The guest profile could not be processed." });
  }
});

app.post("/api/guest/activity", (request, response) => {
  try {
    response.status(201).json(saveGuestActivity(request.body));
  } catch (error) {
    if (error instanceof GuestDuplicateActivityError) {
      response.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof ProfileValidationError || error instanceof GuestValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "The guest activity could not be processed." });
  }
});

app.get("/api/profile", authMiddleware, (request, response) => {
  const userId = authUserId(request);
  response.json({ profile: getProfile(userId), privacy: getPrivacy(userId), history: getHistory(userId), recommendations: getRecommendations(userId) });
});

app.put("/api/profile", authMiddleware, (request, response) => {
  try {
    const userId = authUserId(request);
    response.status(200).json({
      profile: saveProfile(request.body, userId),
      privacy: getPrivacy(userId),
      history: getHistory(userId),
      recommendations: getRecommendations(userId)
    });
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "The profile could not be saved." });
  }
});

app.post("/api/history/activity", authMiddleware, (request, response) => {
  try {
    const userId = authUserId(request);
    const timezone = getNutritionPreferences(userId)?.timezone ?? defaultTimezone();
    const body = { ...request.body };
    if (body.recordedAtLocal !== undefined) {
      if (body.timezone !== undefined && body.timezone !== timezone) {
        throw new TimezoneValidationError("The saved timezone changed. Reload the activity form before saving.");
      }
      body.recordedAt = localDateTimeToIso(body.recordedAtLocal, timezone);
    }
    response.status(201).json({ history: addActivity(body, userId), recommendations: getRecommendations(userId) });
  } catch (error) {
    if (error instanceof HistoryValidationError || error instanceof TimezoneValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof DuplicateActivityError) {
      response.status(409).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "The activity record could not be saved." });
  }
});

app.get("/api/recommendations", authMiddleware, (request, response) => {
  response.json({ recommendations: getRecommendations(authUserId(request)) });
});

app.post("/api/recommendations/refresh", authMiddleware, async (request, response) => {
  const userId = authUserId(request);
  const profile = getProfile(userId);
  if (!profile) {
    response.status(404).json({ error: "Save a profile before requesting recommendations." });
    return;
  }
  const privacy = getPrivacy(userId);
  if (!privacy?.dataForRecommendations) {
    response.status(403).json({ error: "Allow online AI in Settings before generating guidance." });
    return;
  }
  try {
    const generated = await generateDeepSeekGuidance(profile, getHistory(userId));
    saveRecommendations(generated, userId);
    response.json({ recommendations: generated });
  } catch (error) {
    if (error instanceof DeepSeekGenerationError) {
      const statusText = error.providerStatus === undefined ? "" : `, provider status ${error.providerStatus}`;
      console.warn(`DeepSeek guidance failed: ${error.code}${statusText}`);
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.warn("DeepSeek guidance failed: unknown error");
    response.status(503).json({ error: "Online AI is not available now. Try again later. Local guidance is still available." });
  }
});

app.get("/api/profile/export", authMiddleware, (request, response) => {
  const userId = authUserId(request);
  response
    .type("application/json")
    .setHeader("Content-Disposition", 'attachment; filename="health-profile.json"')
    .send(JSON.stringify({ ...exportData(userId), nutrition: exportNutritionData(userId) }, null, 2));
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AuthError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError) {
    response.status(400).json({ error: "Request body must contain valid JSON." });
    return;
  }
  response.status(500).json({ error: "The request could not be completed." });
};

app.use(errorHandler);

export default app;
