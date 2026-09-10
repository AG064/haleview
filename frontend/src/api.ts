import type { Guidance, HealthHistory, HealthProfile, PrivacySettings, ProfileFormValues } from "./types";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ProfileResponse {
  profile: HealthProfile | null;
  privacy: PrivacySettings | null;
  history: HealthHistory;
  recommendations: Guidance | null;
}

export interface SavedProfileResponse {
  profile: HealthProfile;
  privacy: PrivacySettings;
  history: HealthHistory;
  recommendations: Guidance | null;
}

export async function getProfile(token: string): Promise<ProfileResponse> {
  const response = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as ProfileResponse;
}

export async function saveProfile(profile: ProfileFormValues, privacy: PrivacySettings, token: string): Promise<SavedProfileResponse> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...profile, privacy })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as SavedProfileResponse;
}

export async function saveActivity(activeDays: number, recordedAt: string, token: string): Promise<{ history: HealthHistory; recommendations: Guidance | null }> {
  const response = await fetch("/api/history/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ activeDays, recordedAt })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as { history: HealthHistory; recommendations: Guidance | null };
}

export async function saveGuestProfile(
  profile: ProfileFormValues,
  privacy: PrivacySettings,
  history: HealthHistory
): Promise<SavedProfileResponse> {
  const response = await fetch("/api/guest/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, privacy, history })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as SavedProfileResponse;
}

export async function saveGuestActivity(
  profile: HealthProfile,
  privacy: PrivacySettings,
  history: HealthHistory,
  activeDays: number,
  recordedAt: string
): Promise<{ history: HealthHistory; recommendations: Guidance }> {
  const response = await fetch("/api/guest/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, privacy, history, activeDays, recordedAt })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as { history: HealthHistory; recommendations: Guidance };
}

export async function downloadExport(token: string): Promise<Blob> {
  const response = await fetch("/api/profile/export", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return response.blob();
}

export async function refreshRecommendations(token: string): Promise<Guidance> {
  const response = await fetch("/api/recommendations/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  const body = (await response.json()) as { recommendations: Guidance | null };
  if (!body.recommendations || body.recommendations.source !== "deepseek") {
    throw new Error("Online AI did not return usable guidance. Local guidance is still available.");
  }
  return body.recommendations;
}

export interface AuthConfig {
  accessTokenMinutes: number;
  refreshTokenDays: number;
  oauthProviders: { google: boolean; github: boolean };
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const response = await fetch("/api/auth/config");
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AuthConfig;
}

export interface AccountRegistration {
  userId: number;
  email: string;
  verificationLink?: string;
  message: string;
}

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

interface AuthenticatedSessionOptions {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  refresh: (refreshToken: string) => Promise<AccountTokens>;
  applyTokens: (tokens: AccountTokens) => void;
  clearSession: () => void;
}

export interface AuthenticatedSession {
  request: <T>(operation: (accessToken: string) => Promise<T>) => Promise<T>;
  refresh: () => Promise<AccountTokens>;
}

export function createAuthenticatedSession(options: AuthenticatedSessionOptions): AuthenticatedSession {
  let refreshInFlight: Promise<AccountTokens> | null = null;

  const refresh = (): Promise<AccountTokens> => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    const refreshToken = options.getRefreshToken();
    if (!refreshToken) {
      options.clearSession();
      return Promise.reject(new ApiError(401, "Session ended. Sign in again."));
    }

    const pending = options.refresh(refreshToken)
      .then((tokens) => {
        options.applyTokens(tokens);
        return tokens;
      })
      .catch((error: unknown) => {
        options.clearSession();
        throw error;
      })
      .finally(() => {
        if (refreshInFlight === pending) {
          refreshInFlight = null;
        }
      });

    refreshInFlight = pending;
    return pending;
  };

  const request = async <T>(operation: (accessToken: string) => Promise<T>): Promise<T> => {
    const accessToken = options.getAccessToken();
    if (!accessToken) {
      throw new ApiError(401, "Sign in is required.");
    }

    try {
      return await operation(accessToken);
    } catch (error: unknown) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
    }

    const tokens = await refresh();
    return operation(tokens.accessToken);
  };

  return { request, refresh };
}

export interface AccountState {
  userId: number;
  twoFactorEnabled: boolean;
}

export async function getAccountState(token: string): Promise<AccountState> {
  const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AccountState;
}

export interface TwoFactorLoginChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

export type AccountLoginResult = AccountTokens | TwoFactorLoginChallenge;

export async function registerAccount(email: string, password: string): Promise<AccountRegistration> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AccountRegistration;
}

export async function loginAccount(email: string, password: string): Promise<AccountLoginResult> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AccountLoginResult;

}

export async function refreshAccountSession(refreshToken: string): Promise<AccountTokens> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AccountTokens;
}

export async function exchangeOAuthTicket(): Promise<AccountTokens> {
  const response = await fetch("/api/auth/oauth/exchange", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AccountTokens;
}

async function accountRequest<T>(path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as T;
}

export async function setupTwoFactor(token: string): Promise<{ secret: string; otpauthUri: string }> {
  return accountRequest<{ secret: string; otpauthUri: string }>("/api/auth/2fa/setup", token);
}

export async function confirmTwoFactor(token: string, code: string): Promise<{ message: string }> {
  return accountRequest<{ message: string }>("/api/auth/2fa/confirm", token, { code });
}

export async function disableTwoFactor(token: string, code: string): Promise<{ message: string }> {
  return accountRequest<{ message: string }>("/api/auth/2fa/disable", token, { code });
}

export async function verifyTwoFactor(challengeToken: string, code: string): Promise<AccountTokens> {
  const response = await fetch("/api/auth/2fa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken, code })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as AccountTokens;
}

export async function requestPasswordReset(email: string): Promise<{ message: string; resetLink?: string }> {
  const response = await fetch("/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as { message: string; resetLink?: string };
}

export async function confirmPasswordReset(token: string, password: string): Promise<{ message: string }> {
  const response = await fetch("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  return (await response.json()) as { message: string };
}
