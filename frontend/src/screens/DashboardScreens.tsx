import type { FormEvent } from "react";
import TwoFactorQr from "../TwoFactorQr";
import { labels } from "../app-data";
import { GuidanceMeta, HaleBriefing, PrimaryGuidance } from "../components/HaleGuidance";
import { Metric, ProgressValue, WellnessGauge } from "../components/HealthVisuals";
import { asNumber, displayDate, formatClassification } from "../format";
import { guidanceContext, withoutGoalPrefix } from "../hale-guidance";
import type { Guidance, HealthHistory, HealthProfile, PrivacySettings } from "../types";

type DashboardRoute = "dashboard" | "progress" | "records" | "hale" | "profile-setup";

interface DashboardOverviewProps {
  profile: HealthProfile;
  recommendations: Guidance | null;
  onNavigate: (route: DashboardRoute) => void;
}

export function DashboardOverview({ profile, recommendations, onNavigate }: DashboardOverviewProps) {
  return (
    <section className="panel dashboard-overview">
      <div className="panel-heading">
        <div><p className="eyebrow">Dashboard</p><h2>Health overview</h2></div>
        <button className="secondary-button" type="button" onClick={() => onNavigate("profile-setup")}>Edit profile</button>
      </div>
      <div className="dashboard-summary-grid">
        <div className="dashboard-score">
          <div className="score-card">
            <WellnessGauge value={profile.analytics.wellnessScore} />
            <div className="score-caption"><span className="metric-label">Wellness score</span><span>Current result</span></div>
          </div>
          <div className="metric-list">
            <Metric label="BMI" value={`${profile.analytics.bmi}`} detail={formatClassification(profile.analytics.bmiClassification)} />
            <Metric label="Activity" value={`${profile.analytics.activityScore}/100`} detail={`${profile.weeklyActivityDays} days per week`} />
            <Metric label="Goal" value={`${profile.analytics.goalProgress}%`} detail={labels[profile.fitnessGoal]} />
            <Metric label="Habits" value={`${profile.analytics.habitsScore}/100`} detail={`${profile.exerciseTypes.length} exercise types`} />
          </div>
        </div>
        <div className="dashboard-progress">
          <h3>Progress</h3>
          <div className="progress-grid compact-progress-grid">
            <ProgressValue label="Goal progress" value={profile.analytics.goalProgress} />
            <ProgressValue label="Wellness score" value={profile.analytics.wellnessScore} />
            <ProgressValue label="Activity score" value={profile.analytics.activityScore} />
            <ProgressValue label="Habits score" value={profile.analytics.habitsScore} />
          </div>
          <button className="text-button dashboard-link" type="button" onClick={() => onNavigate("progress")}>Open progress</button>
        </div>
        <div className="dashboard-guidance">
          {recommendations ? (
            <HaleBriefing guidance={recommendations} onOpen={() => onNavigate("hale")} />
          ) : (
            <div className="hale-briefing-empty">
              <h3>Hale</h3>
              <p className="muted-text">Save the profile to prepare guidance.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface ProfileScreenProps {
  profile: HealthProfile;
  onEdit: () => void;
}

export function ProfileScreen({ profile, onEdit }: ProfileScreenProps) {
  return (
    <section className="panel page-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Profile</p><h2>Saved health profile</h2></div>
        <button className="primary-button compact-button" type="button" onClick={onEdit}>Edit profile</button>
      </div>
      <dl className="profile-details">
        <div><dt>Age</dt><dd>{profile.age} years</dd></div>
        <div><dt>Gender</dt><dd>{labels[profile.gender] ?? profile.gender.replaceAll("_", " ")}</dd></div>
        <div><dt>Height</dt><dd>{profile.heightCm} cm</dd></div>
        <div><dt>Current weight</dt><dd>{profile.weightKg} kg</dd></div>
        <div><dt>Target weight</dt><dd>{profile.targetWeightKg === undefined ? "Not set" : `${profile.targetWeightKg} kg`}</dd></div>
        <div><dt>Goal</dt><dd>{labels[profile.fitnessGoal]}</dd></div>
        <div><dt>Activity</dt><dd>{labels[profile.activityLevel]}</dd></div>
        <div><dt>Planned days</dt><dd>{profile.weeklyActivityDays} per week</dd></div>
        <div><dt>Fitness level</dt><dd>{profile.fitnessLevel}</dd></div>
        <div><dt>Updated</dt><dd>{displayDate(profile.updatedAt)}</dd></div>
      </dl>
    </section>
  );
}

interface SettingsScreenProps {
  profile: HealthProfile | null;
  privacy: PrivacySettings;
  guestMode: boolean;
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
  return (
    <div className="settings-grid">
      <section className="panel page-panel">
        <div className="panel-heading"><div><p className="eyebrow">Settings</p><h2>Profile and data</h2></div></div>
        <div className="settings-list">
          <SettingAction title="Health profile" text="Change profile values and data use." action="Edit" onClick={props.onEditProfile} />
          <SettingAction title="Tutorial" text="Review the main steps." action="Open" onClick={props.onOpenTutorial} />
          <SettingAction title="Data export" text="Download profile values and history." action="Export" onClick={props.onExport} />
          {props.profile && <SettingValue title="Online AI" text={props.privacy.dataForRecommendations ? "DeepSeek use is allowed." : "Local guidance only."} value={props.privacy.dataForRecommendations ? "Allowed" : "Off"} />}
          {props.profile && <SettingValue title="Visibility" text="Controls profile sharing." value={props.privacy.publicVisibility === "private" ? "Private" : "Summary only"} />}
        </div>
      </section>

      <section className="panel page-panel">
        <div className="panel-heading"><div><p className="eyebrow">Account</p><h2>Access and security</h2></div></div>
        {props.guestMode ? (
          <div className="settings-list"><SettingAction title="Guest mode" text="Data stays in this browser." action="Sign in" onClick={props.onOpenAccount} /></div>
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
      </section>
    </div>
  );
}

interface RecordsScreenProps {
  history: HealthHistory;
  activityDays: number;
  activityRecordedAt: string;
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
        <div><p className="eyebrow">History</p><h3>Records</h3></div>
        <button className="secondary-button" type="button" onClick={props.onExport} disabled={!props.canExport}>Export</button>
      </div>
      <div className="history-grid">
        <RecordList title="Weight" emptyText="No weight records." records={props.history.weights.slice(0, 8).map((record) => ({ id: record.id, value: `${record.weightKg} kg`, date: record.recordedAt }))} />
        <div>
          <h4>Activity</h4>
          <div className="activity-entry">
            <div className="field-grid two-columns">
              <label>Active days<input type="number" min="0" max="7" value={props.activityDays} onChange={(event) => props.onActivityDaysChange(asNumber(event.target.value))} /></label>
              <label>Date and time<input type="datetime-local" value={props.activityRecordedAt} onChange={(event) => props.onActivityRecordedAtChange(event.target.value)} /></label>
            </div>
            <button className="secondary-button" type="button" disabled={props.activitySaving} onClick={props.onAddActivity}>{props.activitySaving ? "Saving..." : "Add activity"}</button>
          </div>
          <RecordList emptyText="No activity records." records={props.history.activities.slice(0, 8).map((record) => ({ id: record.id, value: `${record.activeDays} days`, date: record.recordedAt }))} />
        </div>
      </div>
    </section>
  );
}

interface HaleScreenProps {
  guidance: Guidance;
  allowOnlineAi: boolean;
  recommendationRefreshing: boolean;
  onRefresh: () => void;
}

export function HaleScreen({ guidance, allowOnlineAi, recommendationRefreshing, onRefresh }: HaleScreenProps) {
  const [primaryItem, ...otherItems] = guidance.items;

  return (
    <section className="panel guidance-panel">
      <div className="panel-heading hale-page-heading">
        <div><p className="eyebrow">Hale</p><h3>Guidance for now</h3><GuidanceMeta guidance={guidance} /></div>
        {allowOnlineAi ? (
          <button className="secondary-button" type="button" disabled={recommendationRefreshing} onClick={onRefresh}>{recommendationRefreshing ? "Preparing..." : "Generate AI guidance"}</button>
        ) : <span className="required-note">Local guidance updates after each save.</span>}
      </div>
      {recommendationRefreshing && <p className="hale-reviewing" role="status">Hale is reviewing your saved data.</p>}
      <p className="hale-page-context">{guidanceContext(guidance)}</p>
      <div className="hale-guidance-layout">
        <div className="hale-next-step">
          <span className="metric-label">Next step</span>
          {primaryItem ? <PrimaryGuidance item={primaryItem} /> : <p className="muted-text">No guidance is available yet.</p>}
        </div>
        <div className="hale-summary-block">
          <div><span className="metric-label">This week</span><p>{withoutGoalPrefix(guidance.summaries.weekly)}</p></div>
          <div><span className="metric-label">This month</span><p>{withoutGoalPrefix(guidance.summaries.monthly)}</p></div>
        </div>
      </div>
      {otherItems.length > 0 && <div className="hale-other-guidance">
        <h4>Other guidance</h4>
        <div className="recommendation-list">
          {otherItems.map((item) => (
          <details className="recommendation-item" key={item.id}>
            <summary><span className={`priority priority-${item.priority}`}>{item.priority}</span><strong>{item.title}</strong></summary>
            <p>{withoutGoalPrefix(item.text)}</p>
          </details>
          ))}
        </div>
      </div>}
    </section>
  );
}

function SettingAction({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return <div><div><strong>{title}</strong><p>{text}</p></div><button className="secondary-button" type="button" onClick={onClick}>{action}</button></div>;
}

function SettingValue({ title, text, value }: { title: string; text: string; value: string }) {
  return <div><div><strong>{title}</strong><p>{text}</p></div><span className="setting-value">{value}</span></div>;
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

function RecordList({ title, emptyText, records }: { title?: string; emptyText: string; records: RecordItem[] }) {
  return (
    <div>
      {title && <h4>{title}</h4>}
      {records.length > 0 ? (
        <ul className="record-list">{records.map((record) => <li key={record.id}><strong>{record.value}</strong><span>{displayDate(record.date)}</span></li>)}</ul>
      ) : <p className="muted-text">{emptyText}</p>}
    </div>
  );
}
