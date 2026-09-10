import { PageDataState } from "../components/PageDataState";
import { useEffect, useState } from "react";
import { ArrowRight, ChartLine, Dumbbell, HeartPulse, ListChecks, Scale, Target } from "lucide-react";
import type { HealthHistory, HealthProfile } from "../types";
import { AppAccordion } from "../components/AppAccordion";
import { ProgressGoals } from "../components/ProgressGoals";
import { WeightTrendLine } from "../components/HealthVisuals";
import { WellnessHistoryChart } from "../components/WellnessHistoryChart";
import { displayDateOnly, displayShortDate } from "../format";
import { NutritionProgress } from "../components/NutritionProgress";
import { NutritionTrends } from "../components/NutritionTrends";
import { getNutritionProgress, type SessionRequest } from "../nutrition/api";
import type { NutritionProgressResult } from "../nutrition/types";

interface ProgressScreenProps {
  profile: HealthProfile;
  history: HealthHistory;
  rangeDays: 7 | 30 | 90;
  request: SessionRequest;
  signedIn: boolean;
  onRangeChange: (days: 7 | 30 | 90) => void;
  onNavigate: (route: "profile-setup" | "records") => void;
}

function classification(value: HealthProfile["analytics"]["bmiClassification"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ProgressRing({ value, label }: { value: number; label: string }) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress-focus-ring" role="img" aria-label={`${label}: ${progress}%`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="progress-ring-track" cx="60" cy="60" r="52" pathLength="100" />
        <circle className="progress-ring-value" cx="60" cy="60" r="52" pathLength="100" strokeDasharray={`${progress} 100`} />
      </svg>
      <div><strong>{progress}%</strong><span>{label}</span></div>
    </div>
  );
}

export function ProgressScreen({ profile, history, rangeDays, request, signedIn, onRangeChange, onNavigate }: ProgressScreenProps) {
  const [now] = useState(Date.now);
  const [nutrition, setNutrition] = useState<NutritionProgressResult | null>(null);
  const [nutritionLoading, setNutritionLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [nutritionError, setNutritionError] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setNutritionLoading(true);
    setNutritionError(null);
    request(getNutritionProgress).then((value) => {
      if (active) setNutrition(value);
    }).catch((error: unknown) => {
      if (active) setNutritionError(error instanceof Error ? error.message : "Nutrition history could not be loaded.");
    }).finally(() => { if (active) setNutritionLoading(false); });
    return () => { active = false; };
  }, [request, signedIn, retry]);
  if (signedIn && (nutritionLoading || nutritionError)) return <PageDataState view="metrics" title="Progress" loading={nutritionLoading} error={nutritionError} onRetry={() => setRetry((value) => value + 1)} />;

  const day = 24 * 60 * 60 * 1000;
  const orderedWeights = [...history.weights].sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  const orderedAnalytics = [...history.analytics].sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  const latestWeight = orderedWeights[0]?.weightKg ?? profile.weightKg;
  const oldestWeight = orderedWeights[orderedWeights.length - 1]?.weightKg ?? latestWeight;
  const weightChange = latestWeight - oldestWeight;
  const targetDistance = profile.targetWeightKg === undefined ? null : Math.abs(latestWeight - profile.targetWeightKg);
  const recentActivityDays = history.activities.filter((record) => Date.parse(record.recordedAt) >= now - 7 * day).reduce((total, record) => total + record.activeDays, 0);
  const monthlyActivityDays = history.activities.filter((record) => Date.parse(record.recordedAt) >= now - 30 * day).reduce((total, record) => total + record.activeDays, 0);
  const rangeWeights = orderedWeights.filter((record) => Date.parse(record.recordedAt) >= now - rangeDays * day).slice(0, 12).reverse();
  const rangeAnalytics = orderedAnalytics.filter((record) => Date.parse(record.recordedAt) >= now - rangeDays * day).slice(0, 12).reverse();
  const latestScoreChange = orderedAnalytics.length > 1 ? orderedAnalytics[0].wellnessScore - orderedAnalytics[1].wellnessScore : null;
  const weightValues = rangeWeights.map((record) => record.weightKg);
  const weightMinimum = weightValues.length > 0 ? Math.min(...weightValues) : latestWeight;
  const weightMaximum = weightValues.length > 0 ? Math.max(...weightValues) : latestWeight + 1;
  const weightSpan = Math.max(1, weightMaximum - weightMinimum);
  const targetPosition = profile.targetWeightKg === undefined ? null : Math.max(0, Math.min(100, (profile.targetWeightKg - weightMinimum) / weightSpan * 100));
  const activityWeek = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const days = history.activities.filter((record) => {
      const recordedAt = Date.parse(record.recordedAt);
      return recordedAt >= date.getTime() && recordedAt < nextDay.getTime();
    }).reduce((total, record) => total + record.activeDays, 0);
    return { label: displayDateOnly(date), date: date.toISOString(), days };
  });
  const weightGoalProgress = (() => {
    if (profile.targetWeightKg === undefined) return 0;
    const fullDistance = Math.abs(oldestWeight - profile.targetWeightKg);
    if (fullDistance === 0) return latestWeight === profile.targetWeightKg ? 100 : 0;
    const movement = oldestWeight > profile.targetWeightKg ? oldestWeight - latestWeight : latestWeight - oldestWeight;
    return Math.round(Math.max(0, Math.min(100, movement / fullDistance * 100)));
  })();
  const nextWeightMilestone = weightGoalProgress >= 100 ? 100 : Math.min(100, (Math.floor(weightGoalProgress / 5) + 1) * 5);
  const weightMilestones = rangeWeights.map((record, index) => {
    const targetWeight = profile.targetWeightKg;
    if (targetWeight === undefined) return null;
    const fullDistance = Math.abs(oldestWeight - targetWeight);
    if (fullDistance === 0) return record.weightKg === targetWeight ? 100 : null;
    const progressAt = (weight: number) => Math.max(0, Math.min(100, (oldestWeight > targetWeight ? oldestWeight - weight : weight - oldestWeight) / fullDistance * 100));
    const current = progressAt(record.weightKg);
    const previous = index === 0 ? 0 : progressAt(rangeWeights[index - 1].weightKg);
    return [100, 75, 50, 25].find((milestone) => current >= milestone && previous < milestone) ?? null;
  });
  const weightLabelStep = Math.max(1, Math.ceil(Math.max(0, rangeWeights.length - 1) / 4));
  const activityCompletion = profile.weeklyActivityDays ? Math.round(Math.max(0, Math.min(100, recentActivityDays / profile.weeklyActivityDays * 100))) : recentActivityDays > 0 ? 100 : 0;
  let habitStreak = 0;
  for (let index = activityWeek.length - 1; index >= 0 && activityWeek[index].days > 0; index -= 1) habitStreak += 1;
  const completionEstimate = (() => {
    if (profile.targetWeightKg === undefined || targetDistance === null || history.weights.length < 2) return "Not enough data";
    const newest = orderedWeights[0];
    const oldest = orderedWeights[orderedWeights.length - 1];
    const elapsedDays = (Date.parse(newest.recordedAt) - Date.parse(oldest.recordedAt)) / day;
    const movement = oldest.weightKg > profile.targetWeightKg ? oldest.weightKg - newest.weightKg : newest.weightKg - oldest.weightKg;
    if (elapsedDays < 1 || movement <= 0 || targetDistance === 0) return targetDistance === 0 ? "Target reached" : "Not enough data";
    const daysRemaining = Math.ceil(targetDistance / (movement / elapsedDays));
    if (!Number.isFinite(daysRemaining) || daysRemaining > 3650) return "Not enough data";
    const date = new Date();
    date.setDate(date.getDate() + daysRemaining);
    return displayDateOnly(date);
  })();
  const activityReviewDate = (() => {
    const date = new Date(now);
    const daysUntilSunday = (7 - date.getDay()) % 7;
    date.setDate(date.getDate() + daysUntilSunday);
    return displayDateOnly(date);
  })();
  const plannedActivityDays = profile.weeklyActivityDays;
  const activityDaysLeft = Math.max(0, plannedActivityDays - recentActivityDays);
  const focus = profile.fitnessGoal !== "general_fitness" && profile.targetWeightKg === undefined
    ? {
        title: "Set a clear target",
        text: "Add a target weight so Haleview can show progress towards it.",
        action: "Edit profile",
        route: "profile-setup" as const,
      }
    : plannedActivityDays === 0
      ? {
          title: "Set a weekly routine",
          text: "Choose how many active days you want to plan each week.",
          action: "Edit profile",
          route: "profile-setup" as const,
        }
    : activityDaysLeft > 0
      ? {
          title: `Add ${activityDaysLeft === 1 ? "one" : activityDaysLeft} active ${activityDaysLeft === 1 ? "day" : "days"}`,
          text: `${recentActivityDays} of ${plannedActivityDays} planned active days are recorded this week.`,
          action: "Record activity",
          route: "records" as const,
        }
      : {
          title: "Review your recent changes",
          text: "Your weekly activity is on track. Add a new record when something changes.",
          action: "Open records",
          route: "records" as const,
        };

  return (
    <>
      <section className="panel progress-focus-panel">
        <div className="progress-focus-copy">
          <p className="dashboard-card-label"><Target aria-hidden="true" /><span>Your focus</span></p>
          <h2>{focus.title}</h2>
          <p>{focus.text}</p>
          <button className="primary-button progress-focus-action" type="button" onClick={() => onNavigate(focus.route)}><span>{focus.action}</span><ArrowRight aria-hidden="true" /></button>
        </div>
        <ProgressRing value={activityCompletion} label="weekly activity" />
        <div className="progress-snapshot" aria-label="Progress at a glance">
          <div className="progress-snapshot-item wellness"><span className="progress-snapshot-icon" aria-hidden="true"><HeartPulse /></span><span>Wellness</span><strong>{nutrition?.wellnessScore ?? profile.analytics.wellnessScore}</strong></div>
          <div className="progress-snapshot-item weight"><span className="progress-snapshot-icon" aria-hidden="true"><Scale /></span><span>Current weight</span><strong>{latestWeight.toFixed(1)} kg</strong></div>
          <div className="progress-snapshot-item activity"><span className="progress-snapshot-icon" aria-hidden="true"><Dumbbell /></span><span>Active days</span><strong>{recentActivityDays} of {plannedActivityDays}</strong></div>
        </div>
      </section>

      <AppAccordion className="progress-details-panel" title="Health numbers" eyebrow="Details" meta="Open when needed" icon={ListChecks}>
        <div className="comparison-list progress-detail-list">
          <div><span className="metric-label">Goal progress</span><strong>{profile.analytics.goalProgress}%</strong></div>
          <div><span className="metric-label">Activity score</span><strong>{profile.analytics.activityScore}</strong></div>
          <div><span className="metric-label">Habits score</span><strong>{profile.analytics.habitsScore}</strong></div>
          <div><span className="metric-label">Current weight</span><strong>{latestWeight.toFixed(1)} kg</strong></div>
          <div><span className="metric-label">Target weight</span><strong>{profile.targetWeightKg === undefined ? "No target" : `${profile.targetWeightKg.toFixed(1)} kg`}</strong></div>
          <div><span className="metric-label">Target distance</span><strong>{targetDistance === null ? "No target" : `${targetDistance.toFixed(1)} kg`}</strong></div>
          <div><span className="metric-label">Weight change</span><strong>{weightChange > 0 ? "+" : ""}{weightChange.toFixed(1)} kg</strong></div>
          <div><span className="metric-label">Active days, 30 days</span><strong>{monthlyActivityDays}</strong></div>
          <div><span className="metric-label">Estimated goal date</span><strong>{completionEstimate}</strong></div>
        </div>
      </AppAccordion>

      <ProgressGoals
        weightProgress={weightGoalProgress}
        targetDistance={targetDistance}
        weightEstimate={completionEstimate}
        activityProgress={activityCompletion}
        recentActivityDays={recentActivityDays}
        plannedActivityDays={profile.weeklyActivityDays}
        activityReviewDate={activityReviewDate}
        habitProgress={profile.analytics.habitsScore}
        habitStreak={habitStreak}
        exerciseTypeCount={profile.exerciseTypes.length}
        monthlyActivityDays={monthlyActivityDays}
      />

      <AppAccordion className="trends-panel" title="Weight, wellness, and activity" eyebrow="Trends" meta={`${rangeDays} day view`} icon={ChartLine}>
        <div className="progress-trend-controls">
          <label className="range-control">Time range
            <select value={rangeDays} onChange={(event) => onRangeChange(Number(event.target.value) as 7 | 30 | 90)}>
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
            </select>
          </label>
        </div>
        <div className="trend-grid">
          <div className="trend-card">
            <div className="trend-card-heading"><h4>Weight trend</h4><span>{rangeWeights.length} record(s)</span></div>
            {rangeWeights.length > 1 ? (
              <div className="weight-chart" role="group" aria-label={`Weight trend for the last ${rangeDays} days`}>
                <WeightTrendLine records={rangeWeights} minimum={weightMinimum} span={weightSpan} />
                {targetPosition !== null && <span className="target-line" style={{ bottom: `${24 + (30 + targetPosition * 0.7) * 1.11}px` }} />}
                {rangeWeights.map((record, index) => {
                  const showDate = index === 0 || index === rangeWeights.length - 1 || index % weightLabelStep === 0;
                  const recordLabel = `${displayDateOnly(record.recordedAt)}: ${record.weightKg.toFixed(1)} kg`;
                  return <div className="weight-column" key={record.id} role="group" tabIndex={0} aria-label={recordLabel}>
                    <span className="weight-bar" style={{ height: `${30 + (record.weightKg - weightMinimum) / weightSpan * 70}%` }}>
                      <span className="weight-tooltip" role="tooltip" aria-hidden="true"><strong>{record.weightKg.toFixed(1)} kg</strong><span>{displayDateOnly(record.recordedAt)}</span></span>
                      {weightMilestones[index] !== null && <span className="weight-milestone">{weightMilestones[index]}%</span>}
                    </span>
                    <small className={showDate ? undefined : "is-hidden"} aria-hidden={!showDate}>{displayShortDate(record.recordedAt)}</small>
                  </div>;
                })}
              </div>
            ) : rangeWeights.length === 1 ? <div className="trend-sparse-state"><strong>{rangeWeights[0].weightKg.toFixed(1)} kg</strong><span>{displayDateOnly(rangeWeights[0].recordedAt)}</span><p>Add one more weight record to show a trend.</p></div> : <div className="trend-sparse-state"><strong>No records</strong><p>Add a weight record to start the chart.</p></div>}
            <p className="chart-note">Showing the latest 12 records within the selected period. {profile.targetWeightKg === undefined ? "No target weight set." : `Target: ${profile.targetWeightKg} kg.`}</p>
          </div>
          <div className="trend-card bmi-card">
            <div className="trend-card-heading"><h4>BMI range</h4><strong>{profile.analytics.bmi}</strong></div>
            <div className="bmi-range" role="img" aria-label={`BMI ${profile.analytics.bmi}, healthy range 18.5 to 24.9`}>
              <span className="bmi-segment bmi-low">Low</span><span className="bmi-segment bmi-healthy">Healthy</span><span className="bmi-segment bmi-high">High</span>
              <span className="bmi-marker" style={{ left: `${Math.max(0, Math.min(100, (profile.analytics.bmi - 10) / 30 * 100))}%` }} />
            </div>
            <div className="bmi-labels"><span>10</span><span>18.5 to 24.9</span><span>40</span></div>
            <p className="chart-note">Classification: {classification(profile.analytics.bmiClassification)}.</p>
          </div>
          <div className="trend-card wellness-card">
            <div className="trend-card-heading"><h4>Wellness history</h4><span>{rangeAnalytics.length} record(s)</span></div>
            {rangeAnalytics.length > 1 ? <WellnessHistoryChart records={rangeAnalytics} /> : rangeAnalytics.length === 1 ? <div className="trend-sparse-state"><strong>{rangeAnalytics[0].wellnessScore}</strong><span>Wellness score</span><p>Add one more record to compare your scores.</p></div> : <div className="trend-sparse-state"><strong>No records</strong><p>Save a profile record to start the chart.</p></div>}
            <p className="chart-note">Showing the latest 12 records within the selected period.</p>
            {latestScoreChange !== null && <p className="chart-note">{Math.abs(latestScoreChange) >= 5 ? `Significant change: ${Math.abs(latestScoreChange)} points ${latestScoreChange > 0 ? "higher" : "lower"} than the previous record.` : `Change: ${Math.abs(latestScoreChange)} points ${latestScoreChange >= 0 ? "higher" : "lower"} than the previous record.`}</p>}
          </div>
        </div>
        <div className={`activity-week ${recentActivityDays === 0 ? "is-empty" : ""}`}>
          <div className="trend-card-heading"><h4>Activity week</h4><span>{recentActivityDays} days recorded</span></div>
          {recentActivityDays > 0 ? <div className="activity-blocks" role="img" aria-label="Activity recorded during the last seven days">
            {activityWeek.map((item) => <div className="activity-day" key={item.date}><span className={`activity-block activity-level-${Math.min(4, item.days)}`} title={`${item.days} active day(s)`} /><small>{item.label}</small></div>)}
          </div> : <div className="trend-sparse-state activity-empty-state"><strong>No activity yet</strong><p>The weekly chart will appear after the first activity record.</p></div>}
        </div>
        <div className="milestones">
          <div className="trend-card-heading"><h4>Milestones</h4><span>Based on saved records</span></div>
          <div className="milestone-grid">
            <div><strong>{weightGoalProgress}%</strong><span>Weight goal progress</span></div><div><strong>{nextWeightMilestone}%</strong><span>Next goal step</span></div><div><strong>{activityCompletion}%</strong><span>Activity completion</span></div><div><strong>{habitStreak} day(s)</strong><span>Habit streak</span></div><div><strong>{profile.exerciseTypes.length}/4</strong><span>Exercise types</span></div><div><strong>{profile.weeklyActivityDays}</strong><span>Planned days per week</span></div>
          </div>
        </div>
      </AppAccordion>
      {signedIn && <AppAccordion title="Nutrition history" eyebrow="Calories and macros" icon={ChartLine} tone="oat">
        {nutritionError ? <p className="error-text" role="alert">{nutritionError}</p> : nutrition ? <>
          <NutritionProgress progress={nutrition} />
          <NutritionTrends points={nutrition.trend} />
        </> : <p className="muted-text" role="status">Loading nutrition history...</p>}
      </AppAccordion>}
    </>
  );
}
