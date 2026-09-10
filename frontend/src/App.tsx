import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AccountTokens,
  type AuthenticatedSession,
  confirmTwoFactor,
  confirmPasswordReset,
  createAuthenticatedSession,
  disableTwoFactor,
  downloadExport,
  exchangeOAuthTicket,
  getAccountState,
  getAuthConfig,
  getProfile,
  loginAccount,
  refreshAccountSession,
  refreshRecommendations,
  registerAccount,
  requestPasswordReset,
  saveActivity as saveActivityRecord,
  saveGuestActivity,
  saveGuestProfile,
  saveProfile,
  setupTwoFactor,
  verifyTwoFactor
} from "./api";
import {
  type ExerciseType,
  type Guidance,
  type HealthHistory,
  type HealthProfile,
  type PrivacySettings,
  type ProfileFormValues
} from "./types";
import { appPath, appRouteFromPath, isEntryPath, type AppRoute } from "./routing";
import Tutorial from "./Tutorial";
import { LoadingDashboard } from "./components/LoadingDashboard";
import { AppShell } from "./components/AppShell";
import { initialForm, initialPrivacy, profileSteps } from "./app-data";
import { localDateTimeValue } from "./format";
import { markTutorialSeen, readGuestSnapshot, storeGuestSnapshot, tutorialWasSeen } from "./guest-storage";
import { AccessScreen, NotFoundScreen, OverviewScreen } from "./screens/EntryScreens";
import { DashboardOverview, HaleScreen, ProfileScreen, RecordsScreen, SettingsScreen } from "./screens/DashboardScreens";
import { ProfileSetupScreen } from "./screens/ProfileSetupScreen";
import { ProgressScreen } from "./screens/ProgressScreen";

function App() {
  const [form, setForm] = useState<ProfileFormValues>(initialForm);
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [privacy, setPrivacy] = useState<PrivacySettings>(initialPrivacy);
  const [history, setHistory] = useState<HealthHistory>({ weights: [], activities: [], analytics: [] });
  const [recommendations, setRecommendations] = useState<Guidance | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [verificationLink, setVerificationLink] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get("reset_token"));
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMode, setAccountMode] = useState<"signin" | "create">("signin");
  const [resetVisible, setResetVisible] = useState(Boolean(resetToken));
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [accessTokenExpiresIn, setAccessTokenExpiresIn] = useState(0);
  const [guestMode, setGuestMode] = useState(false);
  const [entryView, setEntryView] = useState<"overview" | "access">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("reset_token") || params.has("oauth_ticket") || params.has("oauth_error") || window.location.pathname !== "/" ? "access" : "overview";
  });
  const [appRoute, setAppRoute] = useState<AppRoute>(() => isEntryPath(window.location.pathname) ? "dashboard" : appRouteFromPath(window.location.pathname));
  const [oauthProviders, setOauthProviders] = useState({ google: false, github: false });
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorSecret, setTwoFactorSecret] = useState<string | null>(null);
  const [twoFactorUri, setTwoFactorUri] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorState, setTwoFactorState] = useState<"loading" | "off" | "pending" | "on">("off");
  const [activityDays, setActivityDays] = useState(0);
  const [activityRecordedAt, setActivityRecordedAt] = useState(localDateTimeValue());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activitySaving, setActivitySaving] = useState(false);
  const [recommendationRefreshing, setRecommendationRefreshing] = useState(false);
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [profileStep, setProfileStep] = useState(0);
  const [furthestProfileStep, setFurthestProfileStep] = useState(0);
  const [sliderErrors, setSliderErrors] = useState<Record<string, string>>({});
  const [tutorialReturn, setTutorialReturn] = useState<"profile-setup" | "settings">("profile-setup");
  const [error, setError] = useState<string | null>(null);
  const sessionVersionRef = useRef(0);
  const sessionIssuedAtRef = useRef(0);
  const lastActivityRef = useRef(0);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const authenticatedSessionRef = useRef<AuthenticatedSession | null>(null);

  const applyAccountTokens = useCallback((tokens: AccountTokens) => {
    sessionIssuedAtRef.current = Date.now();
    accessTokenRef.current = tokens.accessToken;
    refreshTokenRef.current = tokens.refreshToken;
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
    setAccessTokenExpiresIn(tokens.accessTokenExpiresIn);
  }, []);

  const clearAccountSession = useCallback((message: string) => {
    sessionVersionRef.current += 1;
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    setAccessToken(null);
    setRefreshToken(null);
    setAccessTokenExpiresIn(0);
    setTwoFactorChallenge(null);
    setTwoFactorSecret(null);
    setTwoFactorUri(null);
    setTwoFactorCode("");
    setTwoFactorState("off");
    setAccountBusy(false);
    setAccountError(null);
    setAccountMessage(message);
  }, []);

  useEffect(() => {
    authenticatedSessionRef.current = createAuthenticatedSession({
      getAccessToken: () => accessTokenRef.current,
      getRefreshToken: () => refreshTokenRef.current,
      refresh: async (token) => {
        const version = sessionVersionRef.current;
        const tokens = await refreshAccountSession(token);
        if (sessionVersionRef.current !== version) {
          throw new Error("Session ended. Sign in again.");
        }
        return tokens;
      },
      applyTokens: applyAccountTokens,
      clearSession: () => clearAccountSession("Session ended. Sign in again.")
    });
    return () => {
      authenticatedSessionRef.current = null;
    };
  }, [applyAccountTokens, clearAccountSession]);

  const requestWithSession = useCallback(<T,>(operation: (token: string) => Promise<T>): Promise<T> => {
    const session = authenticatedSessionRef.current;
    if (!session) {
      return Promise.reject(new Error("Sign in is required."));
    }
    return session.request(operation);
  }, []);

  const refreshSession = useCallback((): Promise<AccountTokens> => {
    const session = authenticatedSessionRef.current;
    if (!session) {
      return Promise.reject(new Error("Session ended. Sign in again."));
    }
    return session.refresh();
  }, []);
  useEffect(() => {
    getAuthConfig()
      .then((config) => setOauthProviders(config.oauthProviders))
      .catch(() => {
        setOauthProviders({ google: false, github: false });
      });
  }, []);

  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const signedIn = accessToken !== null;

  const navigate = (route: Exclude<AppRoute, "not-found">, replace = false) => {
    const path = appPath(route);
    if (replace) window.history.replaceState({}, document.title, path);
    else window.history.pushState({}, document.title, path);
    setAppRoute(route);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const handlePopState = () => {
      if (isEntryPath(window.location.pathname)) {
        setEntryView(window.location.pathname === "/access" ? "access" : "overview");
        return;
      }
      setAppRoute(appRouteFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    // Account sessions end after 15 minutes without input.
    lastActivityRef.current = Date.now();
    const version = sessionVersionRef.current;
    let inactivityTimer = 0;
    const scheduleEnd = () => {
      window.clearTimeout(inactivityTimer);
      const remaining = Math.max(0, 15 * 60 * 1000 - (Date.now() - lastActivityRef.current));
      inactivityTimer = window.setTimeout(() => {
        if (sessionVersionRef.current !== version) {
          return;
        }
        clearAccountSession("Session ended after 15 minutes without activity.");
      }, remaining);
    };
    const recordActivity = () => {
      lastActivityRef.current = Date.now();
      scheduleEnd();
    };
    window.addEventListener("pointerdown", recordActivity);
    window.addEventListener("keydown", recordActivity);
    scheduleEnd();
    return () => {
      window.clearTimeout(inactivityTimer);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
    };
  }, [signedIn, clearAccountSession]);

  useEffect(() => {
    if (!refreshToken || accessTokenExpiresIn <= 0) {
      return;
    }
    // An active session refreshes before the access token expires.
    const version = sessionVersionRef.current;
    let timer = 0;
    const tryRefresh = () => {
      const tokenExpiresAt = sessionIssuedAtRef.current + accessTokenExpiresIn * 1000;
      const remaining = tokenExpiresAt - Date.now();
      const activeSinceIssue = lastActivityRef.current > sessionIssuedAtRef.current + 1000;
      if (!activeSinceIssue && remaining > 0) {
        timer = window.setTimeout(tryRefresh, Math.min(5000, remaining));
        return;
      }
      if (!activeSinceIssue || remaining <= 0 || sessionVersionRef.current !== version) {
        return;
      }
      refreshSession().catch(() => undefined);
    };
    timer = window.setTimeout(tryRefresh, Math.max(1000, (accessTokenExpiresIn - 30) * 1000));
    return () => window.clearTimeout(timer);
  }, [refreshToken, accessTokenExpiresIn, refreshSession]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    let active = true;
    setTwoFactorState("loading");
    requestWithSession(getAccountState)
      .then((account) => {
        if (active) setTwoFactorState(account.twoFactorEnabled ? "on" : "off");
      })
      .catch((statusError: unknown) => {
        if (!active) return;
        setTwoFactorState("loading");
        setAccountError(statusError instanceof Error ? statusError.message : "Two-step status could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [accessToken, requestWithSession]);

  useEffect(() => {
    if (!accessToken) {
      if (guestMode) {
        setLoading(false);
        return;
      }
      setProfile(null);
      setPrivacy(initialPrivacy);
      setHistory({ weights: [], activities: [], analytics: [] });
      setRecommendations(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    requestWithSession(getProfile)
      .then(({ profile: storedProfile, privacy: storedPrivacy, history: storedHistory, recommendations: storedRecommendations }) => {
        setHistory(storedHistory);
        setRecommendations(storedRecommendations);
        setPrivacy(storedPrivacy ?? initialPrivacy);
        setProfile(storedProfile);
        if (storedProfile) {
          setForm(storedProfile);
          setProfileStep(1);
          setFurthestProfileStep(profileSteps.length - 1);
          if (isEntryPath(window.location.pathname)) navigate("dashboard", true);
        } else {
          const guest = readGuestSnapshot();
          if (guest) {
            setForm(guest.profile);
            setPrivacy(guest.privacy);
            setProfileStep(1);
            setFurthestProfileStep(profileSteps.length - 1);
            setSavedMessage("Guest values are ready. Save them to this account when needed.");
          }
          navigate(tutorialWasSeen("account") ? "profile-setup" : "tutorial", true);
        }
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "The profile could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [accessToken, guestMode, requestWithSession]);

  useEffect(() => {
    if (!loading && (accessToken || guestMode) && !profile && appRoute !== "profile-setup" && appRoute !== "tutorial") {
      navigate("profile-setup", true);
    }
  }, [loading, accessToken, guestMode, profile, appRoute]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset_token")) {
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    const oauthError = params.get("oauth_error");
    if (oauthError) {
      setAccountError(oauthError);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    if (!params.get("oauth_ticket")) {
      return;
    }
    setAccountBusy(true);
    exchangeOAuthTicket()
      .then((result) => {
        sessionVersionRef.current += 1;
        lastActivityRef.current = Date.now();
        applyAccountTokens(result);
        setGuestMode(false);
        setAccountMessage("Signed in.");
      })
      .catch((oauthLoadError: unknown) => {
        setAccountError(oauthLoadError instanceof Error ? oauthLoadError.message : "Sign in failed.");
      })
      .finally(() => {
        setAccountBusy(false);
        window.history.replaceState({}, document.title, window.location.pathname);
      });
  }, [applyAccountTokens]);


  const update = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSavedMessage(null);
  };

  const toggleExercise = (exercise: ExerciseType) => {
    const next = form.exerciseTypes.includes(exercise)
      ? form.exerciseTypes.filter((item) => item !== exercise)
      : [...form.exerciseTypes, exercise];
    update("exerciseTypes", next);
  };

  const updatePrivacy = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => {
    setPrivacy((current) => ({ ...current, [key]: value }));
    setSavedMessage(null);
  };

  const updateSliderError = (field: string, fieldError: string | null) => {
    setSliderErrors((current) => {
      if (!fieldError) {
        const next = { ...current };
        delete next[field];
        return next;
      }
      return { ...current, [field]: fieldError };
    });
  };

  const validateProfileStep = (step: number): string | null => {
    if (step === 0) {
      const sliderError = Object.values(sliderErrors)[0];
      if (sliderError) return sliderError;
      if (!Number.isInteger(form.age) || form.age < 1 || form.age > 120) return "Enter an age from 1 to 120.";
      if (!form.gender.trim()) return "Enter a gender value.";
      if (form.heightCm < 50 || form.heightCm > 250) return "Enter a height from 50 to 250 cm.";
      if (form.weightKg < 20 || form.weightKg > 400) return "Enter a weight from 20 to 400 kg.";
      if (form.targetWeightKg !== undefined && (form.targetWeightKg < 20 || form.targetWeightKg > 400)) return "Enter a target weight from 20 to 400 kg.";
    }
    if (step === 1 && (!Number.isInteger(form.weeklyActivityDays) || form.weeklyActivityDays < 0 || form.weeklyActivityDays > 7)) {
      return "Enter active days from 0 to 7.";
    }
    if (step === 2) {
      if (!Number.isInteger(form.enduranceMinutes) || form.enduranceMinutes < 0 || form.enduranceMinutes > 1000) return "Enter endurance from 0 to 1000 minutes.";
      if (!Number.isInteger(form.pushups) || form.pushups < 0 || form.pushups > 1000) return "Enter pushups from 0 to 1000.";
      if (!Number.isInteger(form.squats) || form.squats < 0 || form.squats > 1000) return "Enter squats from 0 to 1000.";
    }
    if (step === 3 && !privacy.consentGiven) return "Confirm data use before saving.";
    return null;
  };

  const moveToNextProfileStep = () => {
    const stepError = validateProfileStep(profileStep);
    if (stepError) {
      setError(stepError);
      return;
    }
    const next = Math.min(profileSteps.length - 1, profileStep + 1);
    setError(null);
    setProfileStep(next);
    setFurthestProfileStep((current) => Math.max(current, next));
  };

  const selectProfileStep = (step: number) => {
    if (profile || step <= furthestProfileStep) {
      setError(null);
      setProfileStep(step);
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profileStep < profileSteps.length - 1) {
      moveToNextProfileStep();
      return;
    }
    const token = accessToken;
    if (!token && !guestMode) {
      setError("Choose account access or guest mode first.");
      return;
    }
    if (!privacy.consentGiven) {
      setError("Confirm data use before saving.");
      setProfileStep(3);
      setFurthestProfileStep(3);
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const saved = token
        ? await requestWithSession((currentToken) => saveProfile(form, privacy, currentToken))
        : await saveGuestProfile(form, privacy, history);
      let nextRecommendations = saved.recommendations;
      let guidanceError: string | null = null;
      if (token && saved.privacy.dataForRecommendations) {
        try {
          nextRecommendations = await requestWithSession(refreshRecommendations);
        } catch (generationError: unknown) {
          guidanceError = generationError instanceof Error
            ? generationError.message
            : "Online AI could not update guidance. Local guidance is still available.";
        }
      }
      setProfile(saved.profile);
      setPrivacy(saved.privacy);
      setHistory(saved.history);
      setRecommendations(nextRecommendations);
      setForm(saved.profile);
      if (!token && saved.recommendations) {
        storeGuestSnapshot({
          profile: saved.profile,
          privacy: saved.privacy,
          history: saved.history,
          recommendations: saved.recommendations
        });
      }
      let profileMessage = "Saved in this browser.";
      if (token && guidanceError) {
        profileMessage = "Profile saved. Local guidance is ready.";
      } else if (token && saved.privacy.dataForRecommendations) {
        profileMessage = "Profile saved. Online guidance is ready.";
      } else if (token) {
        profileMessage = "Saved. Values updated.";
      }
      setSavedMessage(profileMessage);
      setError(guidanceError);
      navigate("dashboard", true);
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : "The profile could not be saved.";
      setError(message);
      if (/age|gender|height|weight/i.test(message)) setProfileStep(0);
      else if (/activityLevel|weeklyActivityDays|dietary|fitnessGoal/i.test(message)) setProfileStep(1);
      else if (/sessionDuration|fitnessLevel|exerciseEnvironment|exerciseTime|endurance|pushups|squats|exerciseTypes/i.test(message)) setProfileStep(2);
      else if (/consent|visibility|recommendations|email settings/i.test(message)) setProfileStep(3);
    } finally {
      setSaving(false);
    }
  };

  const addActivity = async () => {
    const token = accessToken;
    if (!token && !guestMode) {
      setError("Choose account access or guest mode first.");
      return;
    }
    if (!profile) {
      setError("Save the profile before adding activity.");
      return;
    }
    const recordedAt = new Date(activityRecordedAt);
    if (Number.isNaN(recordedAt.getTime())) {
      setError("Enter a valid activity time.");
      return;
    }
    setActivitySaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const savedActivity = token
        ? await requestWithSession((currentToken) => saveActivityRecord(activityDays, recordedAt.toISOString(), currentToken))
        : await saveGuestActivity(profile, privacy, history, activityDays, recordedAt.toISOString());
      setHistory(savedActivity.history);
      setRecommendations(savedActivity.recommendations);
      if (!token && savedActivity.recommendations) {
        storeGuestSnapshot({ profile, privacy, history: savedActivity.history, recommendations: savedActivity.recommendations });
      }
      setActivityRecordedAt(localDateTimeValue());
      setSavedMessage(token ? "Activity saved." : "Activity saved in this browser.");
    } catch (activityError: unknown) {
      setError(activityError instanceof Error ? activityError.message : "The activity could not be saved.");
    } finally {
      setActivitySaving(false);
    }
  };

  const exportProfile = async () => {
    const token = accessToken;
    if (!token && !guestMode) {
      setError("Choose account access or guest mode first.");
      return;
    }
    try {
      const file = token
        ? await requestWithSession(downloadExport)
        : new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, privacy, history }, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(file);
      link.href = url;
      link.download = "health-profile.json";
      link.click();
      URL.revokeObjectURL(url);
      setSavedMessage("Export ready.");
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "The export could not be created.");
    }
  };

  const refreshGuidance = async () => {
    const token = accessToken;
    if (!token) {
      setSavedMessage("Local guidance updates when you save the profile or activity.");
      return;
    }
    setRecommendationRefreshing(true);
    setError(null);
    setSavedMessage(null);
    try {
      const updated = await requestWithSession(refreshRecommendations);
      setRecommendations(updated);
      setSavedMessage("Online guidance updated.");
    } catch (refreshError: unknown) {
      setError(refreshError instanceof Error ? refreshError.message : "The recommendations could not be updated.");
    } finally {
      setRecommendationRefreshing(false);
    }
  };

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await registerAccount(accountEmail, accountPassword);
      setVerificationLink(result.verificationLink ?? null);
      setAccountMessage(result.message);
    } catch (createError: unknown) {
      setAccountError(createError instanceof Error ? createError.message : "The account could not be created.");
    } finally {
      setAccountBusy(false);
    }
  };

  const startOAuth = (provider: "google" | "github") => {
    setAccountError(null);
    setAccountMessage("Opening sign-in provider.");
    window.location.assign(`/api/auth/oauth/${provider}`);
  };
  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await loginAccount(accountEmail, accountPassword);
      if ("twoFactorRequired" in result) {
        sessionVersionRef.current += 1;
        accessTokenRef.current = null;
        refreshTokenRef.current = null;
        setAccessToken(null);
        setRefreshToken(null);
        setAccessTokenExpiresIn(0);
        setTwoFactorChallenge(result.challengeToken);
        setTwoFactorCode("");
        setAccountMessage("Enter the code from your authenticator.");
      } else {
        sessionVersionRef.current += 1;
        lastActivityRef.current = Date.now();
        setTwoFactorChallenge(null);
        applyAccountTokens(result);
        setGuestMode(false);
        setAccountMessage("Signed in.");
      }
    } catch (loginError: unknown) {
      setAccountError(loginError instanceof Error ? loginError.message : "Sign in failed.");
    } finally {
      setAccountBusy(false);
    }
  };

  const startTwoFactor = async () => {
    if (!accessToken) {
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    setTwoFactorSecret(null);
    setTwoFactorUri(null);
    try {
      const result = await requestWithSession(setupTwoFactor);
      setTwoFactorSecret(result.secret);
      setTwoFactorUri(result.otpauthUri);
      setTwoFactorState("pending");
      setTwoFactorCode("");
      setAccountMessage("Add the key to your authenticator, then enter its code.");
    } catch (setupError: unknown) {
      setAccountError(setupError instanceof Error ? setupError.message : "Two-step setup failed.");
    } finally {
      setAccountBusy(false);
    }
  };

  const confirmTwoFactorSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) {
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await requestWithSession((token) => confirmTwoFactor(token, twoFactorCode));
      setTwoFactorSecret(null);
      setTwoFactorUri(null);
      setTwoFactorState("on");
      setTwoFactorCode("");
      setAccountMessage(result.message);
    } catch (confirmError: unknown) {
      setAccountError(confirmError instanceof Error ? confirmError.message : "The two-step code could not be confirmed.");
    } finally {
      setAccountBusy(false);
    }
  };

  const disableTwoFactorSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) {
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await requestWithSession((token) => disableTwoFactor(token, twoFactorCode));
      setTwoFactorSecret(null);
      setTwoFactorUri(null);
      setTwoFactorState("off");
      setTwoFactorCode("");
      setAccountMessage(result.message);
    } catch (disableError: unknown) {
      setAccountError(disableError instanceof Error ? disableError.message : "Two-step sign-in could not be disabled.");
    } finally {
      setAccountBusy(false);
    }
  };

  const confirmTwoFactorLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!twoFactorChallenge) {
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await verifyTwoFactor(twoFactorChallenge, twoFactorCode);
      sessionVersionRef.current += 1;
      lastActivityRef.current = Date.now();
      applyAccountTokens(result);
      setGuestMode(false);
      setTwoFactorChallenge(null);
      setTwoFactorState("on");
      setTwoFactorCode("");
      setAccountMessage("Signed in.");
    } catch (verifyError: unknown) {
      setAccountError(verifyError instanceof Error ? verifyError.message : "The two-step code could not be checked.");
    } finally {
      setAccountBusy(false);
    }
  };

  const signOut = () => {
    clearAccountSession("Signed out.");
    setEntryView("access");
    window.history.replaceState({}, document.title, "/access");
  };

  const continueAsGuest = () => {
    const stored = readGuestSnapshot();
    if (stored) {
      setProfile(stored.profile);
      setForm(stored.profile);
      setPrivacy(stored.privacy);
      setHistory(stored.history);
      setRecommendations(stored.recommendations);
      setProfileStep(1);
      setFurthestProfileStep(profileSteps.length - 1);
      setSavedMessage("Saved guest data loaded.");
      navigate("dashboard", true);
    } else {
      setProfile(null);
      setForm(initialForm);
      setPrivacy(initialPrivacy);
      setHistory({ weights: [], activities: [], analytics: [] });
      setRecommendations(null);
      setProfileStep(0);
      setFurthestProfileStep(0);
      setSavedMessage(null);
      navigate(tutorialWasSeen("guest") ? "profile-setup" : "tutorial", true);
    }
    setGuestMode(true);
    setAccountError(null);
    setAccountMessage(null);
    setError(null);
  };

  const openAccountAccess = () => {
    setGuestMode(false);
    setEntryView("access");
    setSavedMessage(null);
    setError(null);
    window.history.pushState({}, document.title, "/access");
  };

  const openTutorial = (returnRoute: "profile-setup" | "settings") => {
    setTutorialReturn(returnRoute);
    navigate("tutorial");
  };

  const closeTutorial = () => {
    markTutorialSeen(guestMode ? "guest" : "account");
    navigate(tutorialReturn, true);
  };

  const requestReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await requestPasswordReset(resetEmail);
      setResetToken(result.resetLink ? new URL(result.resetLink).searchParams.get("reset_token") : null);
      setAccountMessage(result.message);
    } catch (resetError: unknown) {
      setAccountError(resetError instanceof Error ? resetError.message : "The reset request failed.");
    } finally {
      setAccountBusy(false);
    }
  };

  const setNewPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetToken) {
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await confirmPasswordReset(resetToken, resetPassword);
      setAccountMessage(result.message);
      setResetToken(null);
      setResetPassword("");
    } catch (confirmError: unknown) {
      setAccountError(confirmError instanceof Error ? confirmError.message : "The new password could not be set.");
    } finally {
      setAccountBusy(false);
    }
  };

  if (loading) {
    return <LoadingDashboard />;
  }

  if ((!accessToken && !guestMode && appRoute === "not-found" && !isEntryPath(window.location.pathname)) || ((accessToken || guestMode) && appRoute === "not-found")) {
    return <NotFoundScreen signedIn={Boolean(accessToken || guestMode)} onReturn={() => {
      if (accessToken || guestMode) navigate(profile ? "dashboard" : "profile-setup", true);
      else {
        window.history.replaceState({}, document.title, "/");
        setEntryView("overview");
        setAppRoute("dashboard");
      }
    }} />;
  }

  if (!accessToken && !guestMode && entryView === "overview") {
    const openAccess = () => {
      setEntryView("access");
      window.history.pushState({}, document.title, "/access");
    };
    return <OverviewScreen onOpenAccess={openAccess} onContinueAsGuest={continueAsGuest} />;
  }

  if (!accessToken && !guestMode) {
    return <AccessScreen
      accountMode={accountMode}
      accountEmail={accountEmail}
      accountPassword={accountPassword}
      accountBusy={accountBusy}
      accountError={accountError}
      accountMessage={accountMessage}
      oauthProviders={oauthProviders}
      resetVisible={resetVisible}
      resetEmail={resetEmail}
      resetToken={resetToken}
      resetPassword={resetPassword}
      twoFactorChallenge={twoFactorChallenge}
      twoFactorCode={twoFactorCode}
      verificationLink={verificationLink}
      onAccountModeChange={setAccountMode}
      onAccountEmailChange={setAccountEmail}
      onAccountPasswordChange={setAccountPassword}
      onOAuth={startOAuth}
      onEmailSubmit={accountMode === "signin" ? signIn : createAccount}
      onShowReset={() => { setResetEmail(accountEmail); setResetVisible(true); }}
      onResetEmailChange={setResetEmail}
      onResetSubmit={requestReset}
      onHideReset={() => setResetVisible(false)}
      onResetPasswordChange={setResetPassword}
      onNewPasswordSubmit={setNewPassword}
      onTwoFactorCodeChange={setTwoFactorCode}
      onTwoFactorSubmit={confirmTwoFactorLogin}
      onContinueAsGuest={continueAsGuest}
      onBack={() => { setEntryView("overview"); window.history.pushState({}, document.title, "/"); }}
    />;
  }

  const activeRoute = appRoute as Exclude<AppRoute, "not-found">;
  return (
    <AppShell route={activeRoute} hasProfile={Boolean(profile)} guestMode={guestMode} signedIn={Boolean(accessToken)} onNavigate={navigate} onOpenAccount={openAccountAccess}>
      {error && <div className="notice error" role="alert">{error}</div>}
      {savedMessage && <div className="notice success" role="status">{savedMessage}</div>}
      {activeRoute === "tutorial" && <Tutorial onClose={closeTutorial} />}
      {activeRoute === "profile-setup" && <ProfileSetupScreen
        form={form}
        profile={profile}
        privacy={privacy}
        profileStep={profileStep}
        furthestProfileStep={furthestProfileStep}
        guestMode={guestMode}
        signedIn={Boolean(accessToken)}
        saving={saving}
        onOpenTutorial={() => openTutorial("profile-setup")}
        onSubmit={save}
        onUpdate={update}
        onUpdatePrivacy={updatePrivacy}
        onToggleExercise={toggleExercise}
        onSliderValidity={updateSliderError}
        onSelectStep={selectProfileStep}
        onBack={() => { setError(null); setProfileStep((current) => Math.max(0, current - 1)); }}
        onNext={moveToNextProfileStep}
      />}
      {profile && activeRoute === "dashboard" && <DashboardOverview profile={profile} recommendations={recommendations} onNavigate={navigate} />}
      {profile && activeRoute === "profile" && <ProfileScreen profile={profile} onEdit={() => navigate("profile-setup")} />}
      {activeRoute === "settings" && <SettingsScreen
        profile={profile}
        privacy={privacy}
        guestMode={guestMode}
        twoFactorState={twoFactorState}
        twoFactorSecret={twoFactorSecret}
        twoFactorUri={twoFactorUri}
        twoFactorCode={twoFactorCode}
        accountBusy={accountBusy}
        accountError={accountError}
        accountMessage={accountMessage}
        onEditProfile={() => navigate("profile-setup")}
        onOpenTutorial={() => openTutorial("settings")}
        onExport={exportProfile}
        onOpenAccount={openAccountAccess}
        onStartTwoFactor={startTwoFactor}
        onTwoFactorCodeChange={setTwoFactorCode}
        onConfirmTwoFactor={confirmTwoFactorSetup}
        onDisableTwoFactor={disableTwoFactorSetup}
        onSignOut={signOut}
      />}
      {profile && activeRoute === "records" && <RecordsScreen
        history={history}
        activityDays={activityDays}
        activityRecordedAt={activityRecordedAt}
        activitySaving={activitySaving}
        canExport={Boolean(accessToken || guestMode)}
        onExport={exportProfile}
        onActivityDaysChange={setActivityDays}
        onActivityRecordedAtChange={setActivityRecordedAt}
        onAddActivity={addActivity}
      />}
      {profile && activeRoute === "progress" && (
        <ProgressScreen profile={profile} history={history} rangeDays={rangeDays} onRangeChange={setRangeDays} />
      )}
      {profile && recommendations && activeRoute === "hale" && <HaleScreen guidance={recommendations} allowOnlineAi={Boolean(accessToken && privacy.dataForRecommendations)} recommendationRefreshing={recommendationRefreshing} onRefresh={refreshGuidance} />}
    </AppShell>
  );
}

export default App;
