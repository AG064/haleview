import { LoadingView, WaitingState } from "../components/WaitingState";
import { PageDataState } from "../components/PageDataState";
import { useEffect, useState, type FormEvent } from "react";
import { NutritionInsights } from "../components/NutritionInsights";
import { Activity, ArrowRight, BookOpen, CalendarDays, Coffee, Download, Dumbbell, Eye, HeartPulse, History, LogIn, MessageCircle, Scale, ShieldCheck, Soup, Sparkles, Target, UserRound, UtensilsCrossed, type LucideIcon } from "lucide-react";
import TwoFactorQr from "../TwoFactorQr";
import { labels } from "../app-data";
import { ApiError } from "../api";
import { GuidanceMeta, PrimaryGuidance } from "../components/HaleGuidance";
import { HaleChat } from "../components/HaleChat";
import { AppAccordion } from "../components/AppAccordion";
import { asNumber, displayDate, sentenceLabel } from "../format";
import { guidanceContext, withoutGoalPrefix } from "../hale-guidance";
import { getNutritionProgress, listMealPlans, listNutritionIntake, requestNutritionReview, type SessionRequest } from "../nutrition/api";
import { loggedMealIds, mealsForDate } from "../nutrition/meal-tracking";
import type { MealPlan, NutritionAdvice, NutritionIntakeRecord, NutritionProgressResult } from "../nutrition/types";
import type { Guidance, HealthHistory, HealthProfile, PrivacySettings } from "../types";

type DashboardRoute = "dashboard" | "progress" | "records" | "hale" | "nutrition" | "meal-plan" | "profile-setup" | "recipes";

interface DashboardOverviewProps {
  profile: HealthProfile;
  history: HealthHistory;
  recommendations: Guidance | null;
  request: SessionRequest;
  signedIn: boolean;
  onNavigate: (route: DashboardRoute) => void;
}

function localDateValue(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function displayMealType(value: string): string {
  return sentenceLabel(value);
}

function MealTypeIcon({ mealType }: { mealType: string }) {
  if (mealType.includes("breakfast")) return <Coffee aria-hidden="true" />;
  if (mealType.includes("lunch")) return <Soup aria-hidden="true" />;
  return <UtensilsCrossed aria-hidden="true" />;
}

function DashboardProgressRing({ value, label }: { value: number; label: string }) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="dashboard-progress-ring" role="img" aria-label={`${label}: ${progress}%`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="dashboard-ring-track" cx="60" cy="60" r="52" pathLength="100" />
        <circle className="dashboard-ring-value" cx="60" cy="60" r="52" pathLength="100" strokeDasharray={`${progress} 100`} />
      </svg>
      <div><strong>{progress}%</strong><span>{label}</span></div>
    </div>
  );
}

export function DashboardOverview({ profile, history, recommendations, request, signedIn, onNavigate }: DashboardOverviewProps) {
  const [now] = useState(Date.now);
  const [nutrition, setNutrition] = useState<NutritionProgressResult | null>(null);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [intake, setIntake] = useState<NutritionIntakeRecord[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      setNutrition(null);
      setPlans([]);
      setIntake([]);
      return;
    }
    let active = true;
    setLoadState("loading");
    Promise.all([request(getNutritionProgress), request(listMealPlans), request(listNutritionIntake)])
      .then(([progress, mealPlans, records]) => {
        if (!active) return;
        setNutrition(progress);
        setPlans(mealPlans);
        setIntake(records);
        setLoadState("ready");
      })
      .catch(() => { if (active) setLoadState("error"); });
    return () => { active = false; };
  }, [request, signedIn, retry]);

  const today = nutrition?.trend.at(-1)?.date ?? localDateValue();
  const { meals: todayMeals } = mealsForDate(plans, today);
  const recordedMeals = loggedMealIds(intake, today);
  const mealTarget = todayMeals.length;
  const mealCount = todayMeals.filter((meal) => recordedMeals.has(meal.id)).length;
  const nextMeal = todayMeals.find((meal) => !recordedMeals.has(meal.id));
  const dailyProgress = signedIn
    ? mealTarget > 0 ? mealCount / mealTarget * 100 : 0
    : profile.analytics.goalProgress;
  const recentActivityDays = history.activities
    .filter((record) => Date.parse(record.recordedAt) >= now - 7 * 24 * 60 * 60 * 1000)
    .reduce((total, record) => total + record.activeDays, 0);
  const plannedActivityDays = Math.max(1, profile.weeklyActivityDays);
  const activityProgress = Math.min(100, recentActivityDays / plannedActivityDays * 100);
  const guidanceItem = recommendations?.items[0];
  const guidanceNote = guidanceItem
    ? withoutGoalPrefix(guidanceItem.text)
    : signedIn
      ? "Record meals and activity to prepare a useful next step."
      : "Your saved profile is ready. Sign in to keep meal and activity progress.";
  const nextTitle = signedIn
    ? nextMeal ? `Log ${displayMealType(nextMeal.mealType).toLowerCase()}` : mealTarget ? "Review today" : "Record a meal"
    : "Explore recipes";
  const nextText = signedIn
    ? nextMeal ? "Record one meal and keep today up to date." : mealTarget ? "Today's planned meals are recorded." : "Use manual entry or create a plan for today."
    : "Search the catalogue and review ingredients and nutrition.";
  const nextButton = signedIn ? nextMeal ? `Log ${displayMealType(nextMeal.mealType).toLowerCase()}` : "Open nutrition" : "Open recipes";

  return (
    <section className="panel dashboard-overview">
      {signedIn && loadState !== "ready" ? (
        <div aria-busy={loadState === "loading"}>
          {loadState === "loading" ? (
            <>
              <WaitingState label="Loading your day." />
              <LoadingView view="plan" />
            </>
          ) : (
            <div role="alert">
              <p>Could not load your day. Please try again.</p>
              <button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
            </div>
          )}
        </div>
      ) : <div className="dashboard-simple-grid">
        <section className="dashboard-next-card" aria-labelledby="dashboard-next-title">
          <div className="dashboard-next-copy">
            <p className="dashboard-card-label"><Target aria-hidden="true" /><span>Next step</span></p>
            <h3 id="dashboard-next-title">{nextTitle}</h3>
            <p>{nextText}</p>
            <button className="primary-button dashboard-primary-action" type="button" onClick={() => onNavigate(signedIn ? "nutrition" : "recipes")}><span>{nextButton}</span><ArrowRight aria-hidden="true" /></button>
          </div>
          <DashboardProgressRing value={dailyProgress} label={signedIn ? "daily progress" : "goal progress"} />
          <div className="dashboard-quick-values">
            <div className="dashboard-quick-value wellness"><span className="dashboard-quick-icon" aria-hidden="true"><HeartPulse /></span><span>Wellness</span><strong>{nutrition?.wellnessScore ?? profile.analytics.wellnessScore}</strong></div>
            <div className="dashboard-quick-value meals"><span className="dashboard-quick-icon" aria-hidden="true">{signedIn ? <UtensilsCrossed /> : <Target />}</span><span>{signedIn ? mealTarget ? "Planned meals" : "Intake records" : "Goal"}</span><strong>{signedIn ? mealTarget ? `${mealCount} of ${mealTarget}` : nutrition?.today.recordCount ?? 0 : `${profile.analytics.goalProgress}%`}</strong></div>
            <div className="dashboard-quick-value activity"><span className="dashboard-quick-icon" aria-hidden="true"><Dumbbell /></span><span>{signedIn ? "Active days" : "Activity plan"}</span><strong>{signedIn ? `${recentActivityDays} of ${plannedActivityDays}` : `${profile.weeklyActivityDays} days`}</strong></div>
          </div>
        </section>

        <section className="dashboard-today-card" aria-labelledby="dashboard-today-title">
          <div className="dashboard-card-heading"><h3 id="dashboard-today-title"><CalendarDays aria-hidden="true" /><span>Today</span></h3>{todayMeals.length > 0 && <button className="text-button" type="button" onClick={() => onNavigate("meal-plan")}>Open plan</button>}</div>
          {todayMeals.length > 0 ? (
            <ol className="dashboard-day-list">
              {todayMeals.map((meal) => (
                <li key={meal.id} className={recordedMeals.has(meal.id) ? "is-complete" : undefined}>
                  <span className={`dashboard-day-marker meal-${meal.mealType}`} aria-hidden="true"><MealTypeIcon mealType={meal.mealType} /></span>
                  <div><strong>{displayMealType(meal.mealType)}</strong><span>{meal.recipeId ? <a className="recipe-title-open" href={`/recipes?recipe=${encodeURIComponent(meal.recipeId)}`}>{meal.title}</a> : meal.title}</span></div>
                  <time>{recordedMeals.has(meal.id) ? "Recorded" : meal.time}</time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="dashboard-empty-day">
              <strong>{signedIn ? "No meal plan for today" : "Meal tracking needs an account"}</strong>
              <p>{signedIn ? "Create a plan when you want a timed view of the day." : "You can still search recipes and review their nutrition as a guest."}</p>
              {signedIn && <button className="text-button" type="button" onClick={() => onNavigate("meal-plan")}>Open meal plan</button>}
            </div>
          )}
        </section>

        <section className="dashboard-track-card" aria-labelledby="dashboard-track-title">
          <p className="dashboard-card-label" id="dashboard-track-title"><Activity aria-hidden="true" /><span>{activityProgress >= 100 ? "On track" : "Weekly activity"}</span></p>
          <strong className="dashboard-track-value">{recentActivityDays} of {plannedActivityDays} active days</strong>
          <div className="dashboard-activity-track" role="progressbar" aria-label="Weekly activity progress" aria-valuemin={0} aria-valuemax={plannedActivityDays} aria-valuenow={Math.min(recentActivityDays, plannedActivityDays)}>
            <span style={{ width: `${activityProgress}%` }} />
          </div>
          <div className="dashboard-hale-note">
            <span>Hale note</span>
            <p>{guidanceNote}</p>
          </div>
          {signedIn && <button className="text-button" type="button" onClick={() => onNavigate("hale")}>Open Hale</button>}
        </section>
      </div>}
    </section>
  );
}

interface ProfileScreenProps {
  profile: HealthProfile;
  onEdit: () => void;
}

export function ProfileScreen({ profile, onEdit }: ProfileScreenProps) {
  const valueLabel = (value: string) => value.trim() ? labels[value] ?? sentenceLabel(value) : "Not set";
  const listLabel = (values: string[], empty: string) => values.length > 0 ? values.map(valueLabel).join(", ") : empty;
  return (
    <section className="panel page-panel profile-page">
      <div className="profile-hero">
        <div className="profile-hero-heading">
          <div><p className="eyebrow">Profile</p><h2>Your health profile</h2><p>Haleview uses these saved values for goals and guidance.</p></div>
          <button className="primary-button compact-button" type="button" onClick={onEdit}>Edit profile</button>
        </div>
        <div className="profile-highlights">
          <div className="tone-sage"><span><HeartPulse aria-hidden="true" />Wellness</span><strong>{profile.analytics.wellnessScore}</strong><small>out of 100</small></div>
          <div className="tone-oat"><span><Scale aria-hidden="true" />Current weight</span><strong>{profile.weightKg} kg</strong><small>{profile.targetWeightKg === undefined ? "No target set" : `Target ${profile.targetWeightKg} kg`}</small></div>
          <div className="tone-clay"><span><Target aria-hidden="true" />Main goal</span><strong>{valueLabel(profile.fitnessGoal)}</strong><small>{profile.weeklyActivityDays} active days per week</small></div>
        </div>
      </div>
      <div className="profile-sections">
        <AppAccordion title="Body details" eyebrow="Personal values" meta="Open when needed" icon={Scale} defaultOpen>
          <dl className="profile-details">
            <div><dt>Age</dt><dd>{profile.age} years</dd></div>
            <div><dt>Gender</dt><dd>{valueLabel(profile.gender)}</dd></div>
            <div><dt>Height</dt><dd>{profile.heightCm} cm</dd></div>
            <div><dt>Current weight</dt><dd>{profile.weightKg} kg</dd></div>
            <div><dt>Target weight</dt><dd>{profile.targetWeightKg === undefined ? "Not set" : `${profile.targetWeightKg} kg`}</dd></div>
            <div><dt>Occupation</dt><dd>{profile.occupationType.trim() || "Not set"}</dd></div>
          </dl>
        </AppAccordion>
        <AppAccordion title="Goals and routine" eyebrow="Weekly plan" meta={`${profile.weeklyActivityDays} active days`} icon={Target} tone="oat">
          <dl className="profile-details">
            <div><dt>Goal</dt><dd>{valueLabel(profile.fitnessGoal)}</dd></div>
            <div><dt>Activity</dt><dd>{valueLabel(profile.activityLevel)}</dd></div>
            <div><dt>Fitness level</dt><dd>{valueLabel(profile.fitnessLevel)}</dd></div>
            <div><dt>Session length</dt><dd>{valueLabel(profile.sessionDuration)} minutes</dd></div>
            <div><dt>Place</dt><dd>{valueLabel(profile.exerciseEnvironment)}</dd></div>
            <div><dt>Preferred time</dt><dd>{valueLabel(profile.exerciseTime)}</dd></div>
          </dl>
        </AppAccordion>
        <AppAccordion title="Preferences and fitness check" eyebrow="More details" meta="Open when needed" icon={Dumbbell} tone="clay">
          <dl className="profile-details profile-details-wide">
            <div><dt>Exercise types</dt><dd>{listLabel(profile.exerciseTypes, "No preference")}</dd></div>
            <div><dt>Food preferences</dt><dd>{listLabel(profile.dietaryPreferences, "No preference")}</dd></div>
            <div><dt>Food restrictions</dt><dd>{listLabel(profile.dietaryRestrictions, "None")}</dd></div>
            <div><dt>Endurance</dt><dd>{profile.enduranceMinutes} minutes</dd></div>
            <div><dt>Push-ups</dt><dd>{profile.pushups}</dd></div>
            <div><dt>Squats</dt><dd>{profile.squats}</dd></div>
            <div><dt>Updated</dt><dd>{displayDate(profile.updatedAt)}</dd></div>
          </dl>
        </AppAccordion>
      </div>
    </section>
  );
}

interface SettingsScreenProps {
  profile: HealthProfile | null;
  privacy: PrivacySettings;
  guestMode: boolean;
  onlineAiAvailable: boolean;
  twoFactorState: "loading" | "off" | "pending" | "on";
  twoFactorSecret: string | null;
  twoFactorUri: string | null;
  twoFactorCode: string;
  accountBusy: boolean;
  accountError: string | null;
  accountMessage: string | null;
  onEditProfile: () => void;
  onOpenTutorial: () => void;
  onExport: () => void;
  onOpenAccount: () => void;
  onStartTwoFactor: () => void;
  onTwoFactorCodeChange: (value: string) => void;
  onConfirmTwoFactor: (event: FormEvent<HTMLFormElement>) => void;
  onDisableTwoFactor: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const visibility = props.privacy.publicVisibility === "private" ? "Private" : "Summary only";
  const accessLabel = props.guestMode ? "Guest mode" : "Account";

  return (
    <section className="settings-page" aria-labelledby="settings-page-title">
      <header className="panel settings-hero">
        <div className="settings-hero-heading">
          <div><p className="eyebrow">Settings</p><h2 id="settings-page-title">Your data and account</h2><p>Change only what you need. Your health profile stays private unless you choose summary sharing.</p></div>
          <div className="settings-status-list" aria-label="Current settings">
            <span><UserRound aria-hidden="true" />{accessLabel}</span>
            <span><ShieldCheck aria-hidden="true" />{visibility}</span>
          </div>
        </div>
      </header>

      <div className="settings-sections">
        <AppAccordion title="Profile and data" eyebrow="Personal settings" meta="Open when needed" icon={UserRound} defaultOpen>
          <div className="settings-list">
          <SettingAction icon={UserRound} title="Health profile" text="Change profile values and data use." action="Edit" onClick={props.onEditProfile} />
          <SettingAction icon={BookOpen} title="Tutorial" text="Review the main steps." action="Open" onClick={props.onOpenTutorial} />
          <SettingAction icon={Download} title="Data export" text="Download profile values and history." action="Export" onClick={props.onExport} />
          {props.profile && <SettingValue
            icon={Sparkles}
            title="Online AI"
            text={props.guestMode ? "Sign in to use online AI." : !props.onlineAiAvailable ? "The provider is not configured." : props.privacy.dataForRecommendations ? "DeepSeek use is allowed." : "Local guidance only."}
            value={props.guestMode ? "Account required" : !props.onlineAiAvailable ? "Unavailable" : props.privacy.dataForRecommendations ? "Allowed" : "Off"}
          />}
          {props.profile && <SettingValue icon={Eye} title="Visibility" text="Controls profile sharing." value={visibility} />}
          </div>
        </AppAccordion>

        <AppAccordion title="Access and security" eyebrow="Account" meta={props.guestMode ? "Sign in for account features" : twoFactorStateText(props.twoFactorState)} icon={ShieldCheck} tone="oat">
        {props.guestMode ? (
          <div className="settings-account-callout">
            <span className="settings-callout-icon"><LogIn aria-hidden="true" /></span>
            <div><strong>Use Haleview on another device</strong><p>Sign in to save account data, meal plans, shopping lists, ratings, and Online AI access.</p></div>
            <button className="primary-button compact-button" type="button" onClick={props.onOpenAccount}>Sign in</button>
          </div>
        ) : (
          <>
            <details className="optional-section account-security" open={props.twoFactorState === "on" ? true : undefined}>
              <summary><span>Two-step sign-in</span><span className="setting-value">{twoFactorStateText(props.twoFactorState)}</span></summary>
              <p>Use an authenticator app if needed.</p>
              {props.twoFactorState === "loading" && <p>Checking the current setting.</p>}
              {props.twoFactorState === "off" && <button className="secondary-button" type="button" onClick={props.onStartTwoFactor} disabled={props.accountBusy}>Enable</button>}
              {props.twoFactorState === "pending" && props.twoFactorSecret && (
                <form className="reset-form" onSubmit={props.onConfirmTwoFactor}>
                  <p>Scan this QR code with the authenticator app.</p>
                  {props.twoFactorUri && <TwoFactorQr value={props.twoFactorUri} />}
                  <p>If scanning fails, enter this setup key:</p>
                  <code className="two-factor-secret">{props.twoFactorSecret}</code>
                  <AuthenticatorField value={props.twoFactorCode} onChange={props.onTwoFactorCodeChange} />
                  <button className="secondary-button" type="submit" disabled={props.accountBusy}>Confirm</button>
                </form>
              )}
              {props.twoFactorState === "on" && (
                <form className="reset-form" onSubmit={props.onDisableTwoFactor}>
                  <p>Enter the current authenticator code to disable two-step sign-in.</p>
                  <AuthenticatorField value={props.twoFactorCode} onChange={props.onTwoFactorCodeChange} />
                  <button className="secondary-button" type="submit" disabled={props.accountBusy}>Disable</button>
                </form>
              )}
            </details>
            <button className="text-button sign-out-button" type="button" onClick={props.onSignOut}>Sign out</button>
          </>
        )}
        {props.accountError && <p className="account-message error-text" role="alert">{props.accountError}</p>}
        {props.accountMessage && <p className="account-message" role="status">{props.accountMessage}</p>}
        </AppAccordion>
      </div>
    </section>
  );
}

interface RecordsScreenProps {
  history: HealthHistory;
  activityDays: number;
  activityRecordedAt: string;
  activityTimezone: string | null;
  activitySaving: boolean;
  canExport: boolean;
  onExport: () => void;
  onActivityDaysChange: (value: number) => void;
  onActivityRecordedAtChange: (value: string) => void;
  onAddActivity: () => void;
}

export function RecordsScreen(props: RecordsScreenProps) {
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Records</p><h3>Keep progress up to date</h3></div>
        <button className="secondary-button" type="button" onClick={props.onExport} disabled={!props.canExport}>Export</button>
      </div>
      <div className="records-next-step">
        <p className="dashboard-card-label"><Activity aria-hidden="true" /><span>Next step</span></p>
        <h4>Add recent activity</h4>
        <p>Enter the number of active days since your last record.</p>
        <p>{props.activityTimezone ? `Times use ${props.activityTimezone}.` : "Loading your saved timezone."} Repeated daylight-saving times use the earlier occurrence. Skipped times cannot be saved.</p>
        <div className="activity-entry">
          <div className="field-grid two-columns">
            <label>Active days<input type="number" min="0" max="7" value={props.activityDays} onChange={(event) => props.onActivityDaysChange(asNumber(event.target.value))} /></label>
            <label>Date and time<input type="datetime-local" value={props.activityRecordedAt} onChange={(event) => props.onActivityRecordedAtChange(event.target.value)} /></label>
          </div>
          <button className="primary-button compact-button" type="button" disabled={props.activitySaving} aria-busy={props.activitySaving} onClick={props.onAddActivity}>{props.activitySaving ? "Saving..." : "Save activity"}</button>
        </div>
      </div>
      <div className="records-history">
        <AppAccordion title="Weight history" eyebrow="Saved records" meta={`${props.history.weights.length} record(s)`} icon={Scale}>
          <RecordList timezone={props.activityTimezone} emptyText="No weight records." records={props.history.weights.slice(0, 8).map((record) => ({ id: record.id, value: `${record.weightKg} kg`, date: record.recordedAt }))} />
        </AppAccordion>
        <AppAccordion title="Activity history" eyebrow="Saved records" meta={`${props.history.activities.length} record(s)`} icon={History} tone="clay">
          <RecordList timezone={props.activityTimezone} emptyText="No activity records." records={props.history.activities.slice(0, 8).map((record) => ({ id: record.id, value: `${record.activeDays} days`, date: record.recordedAt }))} />
        </AppAccordion>
      </div>
    </section>
  );
}

interface HaleScreenProps {
  guidance: Guidance;
  allowOnlineAi: boolean;
  recommendationRefreshing: boolean;
  onRefresh: () => void;
  request: SessionRequest;
}

export function HaleScreen({ guidance, allowOnlineAi, recommendationRefreshing, onRefresh, request }: HaleScreenProps) {
  const views = ["chat", "guidance"] as const;
  const [activeView, setActiveView] = useState<(typeof views)[number]>("chat");
  const [primaryItem, ...otherItems] = guidance.items;
  const [nutrition, setNutrition] = useState<NutritionProgressResult | null>(null);
  const [nutritionLoading, setNutritionLoading] = useState(true);
  const [nutritionLoadError, setNutritionLoadError] = useState<string | null>(null);
  const [nutritionRetry, setNutritionRetry] = useState(0);
  const [nutritionReview, setNutritionReview] = useState<NutritionAdvice | null>(null);
  const [nutritionBusy, setNutritionBusy] = useState(false);
  const [nutritionMessage, setNutritionMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setNutritionLoading(true);
    setNutritionLoadError(null);
    request(getNutritionProgress).then((value) => { if (active) setNutrition(value); }).catch(() => {
      if (active) setNutritionLoadError("Nutrition insights could not be loaded.");
    }).finally(() => { if (active) setNutritionLoading(false); });
    return () => { active = false; };
  }, [request, nutritionRetry]);
  const reviewNutrition = async () => {
    if (nutritionBusy) return;
    setNutritionBusy(true);
    setNutritionMessage(null);
    try {
      const result = await request(requestNutritionReview);
      setNutrition(result.progress);
      setNutritionReview(result.summary);
      setNutritionMessage(result.summary.source === "deepseek" ? null : result.message);
    } catch (error: unknown) {
      setNutritionMessage(error instanceof ApiError ? error.message : "Could not connect to the nutrition service. Your existing results are still available. Try again.");
    } finally {
      setNutritionBusy(false);
    }
  };
  const nutritionAdvice = nutritionReview ?? nutrition?.summary;

  return (
    <div className="hale-view">
      <div className="hale-view-tabs segmented-switch" data-view={activeView} data-index={activeView === "chat" ? "0" : "1"} data-segments="2" role="tablist" aria-label="Hale views">
        {views.map((view) => {
          const active = activeView === view;
          const label = view === "chat" ? "Chat" : "Guidance";
          const Icon = view === "chat" ? MessageCircle : HeartPulse;
          return (
            <button
              aria-controls={`hale-${view}-panel`}
              aria-selected={active}
              className="hale-view-tab"
              id={`hale-${view}-tab`}
              key={view}
              onClick={() => setActiveView(view)}
              onKeyDown={(event) => {
                const currentIndex = views.indexOf(view);
                let nextIndex: number;
                if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + views.length) % views.length;
                else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % views.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = views.length - 1;
                else return;
                event.preventDefault();
                const nextView = views[nextIndex];
                setActiveView(nextView);
                document.getElementById(`hale-${nextView}-tab`)?.focus();
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" />
              <strong>{label}</strong>
            </button>
          );
        })}
      </div>
      <div aria-labelledby="hale-chat-tab" hidden={activeView !== "chat"} id="hale-chat-panel" role="tabpanel">
        <HaleChat request={request} />
      </div>
      <div aria-labelledby="hale-guidance-tab" hidden={activeView !== "guidance"} id="hale-guidance-panel" role="tabpanel">
        <section className="panel guidance-panel hale-page" aria-labelledby="hale-page-title">
      <div className="panel-heading hale-page-heading">
        <div className="hale-page-title">
          <span className="hale-page-icon"><HeartPulse aria-hidden="true" /></span>
          <div><p className="eyebrow">Hale</p><h2 id="hale-page-title">Guidance for now</h2><GuidanceMeta guidance={guidance} /></div>
        </div>
        {allowOnlineAi ? (
          <button className="secondary-button hale-ai-button" type="button" disabled={recommendationRefreshing} aria-busy={recommendationRefreshing} onClick={onRefresh}>
            <Sparkles aria-hidden="true" />
            {recommendationRefreshing ? "Preparing..." : "Refresh with online AI"}
          </button>
        ) : <span className="required-note">Local guidance updates after each save.</span>}
      </div>
      {recommendationRefreshing && <WaitingState label="Hale is reviewing your saved data." detail="Your current guidance stays available while the new review is prepared." />}
      <p className="hale-page-context">{guidanceContext(guidance)}</p>
      <div className="hale-guidance-layout">
        <article className="hale-next-step">
          <div className="hale-section-heading">
            <span className="hale-section-icon"><Target aria-hidden="true" /></span>
            <div><span className="metric-label">Start here</span><strong>One useful action</strong></div>
          </div>
          {primaryItem ? <PrimaryGuidance item={primaryItem} /> : <p className="muted-text">No guidance is available yet.</p>}
        </article>
        <div className="hale-summary-block" aria-label="Progress summaries">
          <article>
            <div className="hale-period-label"><CalendarDays aria-hidden="true" /><span>This week</span></div>
            <p>{withoutGoalPrefix(guidance.summaries.weekly)}</p>
          </article>
          <article>
            <div className="hale-period-label"><History aria-hidden="true" /><span>Last 30 days</span></div>
            <p>{withoutGoalPrefix(guidance.summaries.monthly)}</p>
          </article>
        </div>
      </div>
      <AppAccordion title="Nutrition insights" eyebrow="Food and health" icon={UtensilsCrossed} tone="oat" defaultOpen>
        {nutritionBusy && <WaitingState label="Hale is reviewing your nutrition." />}
        {nutritionLoading || nutritionLoadError ? <PageDataState compact view="metrics" title="Nutrition insights" loading={nutritionLoading} error={nutritionLoadError} onRetry={() => setNutritionRetry((value) => value + 1)} /> : <NutritionInsights progress={nutrition} advice={nutritionAdvice} allowOnlineAi={allowOnlineAi} busy={nutritionBusy} message={nutritionMessage} onReview={() => void reviewNutrition()} />}
      </AppAccordion>
      {otherItems.length > 0 && <div className="hale-other-guidance">
        <div className="hale-other-heading">
          <div><p className="eyebrow">When you need more</p><h3>Other guidance</h3></div>
          <span>{otherItems.length} {otherItems.length === 1 ? "item" : "items"}</span>
        </div>
        <div className="hale-accordion-list">
          {otherItems.map((item) => {
            const Icon = item.priority === "high" ? HeartPulse : item.priority === "medium" ? Target : CalendarDays;
            const tone = item.priority === "high" ? "clay" : item.priority === "medium" ? "oat" : "sage";
            const label = item.priority === "high" ? "Review first" : item.priority === "medium" ? "Plan next" : "Keep in mind";
            return (
              <AppAccordion className="hale-guidance-accordion" eyebrow={label} icon={Icon} key={item.id} meta="Open when needed" title={item.title} tone={tone}>
                <p>{withoutGoalPrefix(item.text)}</p>
              </AppAccordion>
            );
          })}
        </div>
      </div>}
        </section>
      </div>
    </div>
  );
}

function SettingAction({ icon: Icon, title, text, action, onClick }: { icon: LucideIcon; title: string; text: string; action: string; onClick: () => void }) {
  return <div className="settings-row"><span className="settings-row-icon"><Icon aria-hidden="true" /></span><div><strong>{title}</strong><p>{text}</p></div><button className="secondary-button compact-button" type="button" onClick={onClick}>{action}</button></div>;
}

function SettingValue({ icon: Icon, title, text, value }: { icon: LucideIcon; title: string; text: string; value: string }) {
  return <div className="settings-row"><span className="settings-row-icon"><Icon aria-hidden="true" /></span><div><strong>{title}</strong><p>{text}</p></div><span className="setting-value">{value}</span></div>;
}

function AuthenticatorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function twoFactorStateText(state: SettingsScreenProps["twoFactorState"]): string {
  if (state === "loading") return "Checking";
  if (state === "on") return "Enabled";
  if (state === "pending") return "Setup open";
  return "Off";
}

interface RecordItem {
  id: string | number;
  value: string;
  date: string;
}

function RecordList({ title, emptyText, records, timezone }: { title?: string; emptyText: string; records: RecordItem[]; timezone?: string | null }) {
  return (
    <div>
      {title && <h4>{title}</h4>}
      {records.length > 0 ? (
        <ul className="record-list">{records.map((record) => <li key={record.id}><strong>{record.value}</strong><time dateTime={record.date}>{displayDate(record.date, timezone ?? undefined)}</time></li>)}</ul>
      ) : <p className="muted-text">{emptyText}</p>}
    </div>
  );
}
