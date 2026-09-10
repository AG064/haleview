import { useState } from "react";
import type { HealthHistory, HealthProfile } from "../types";
import { ProgressGoals } from "../components/ProgressGoals";
import { ProgressValue, WeightTrendLine } from "../components/HealthVisuals";
import { WellnessHistoryChart } from "../components/WellnessHistoryChart";

interface ProgressScreenProps {
  profile: HealthProfile;
  history: HealthHistory;
  rangeDays: 7 | 30 | 90;
  onRangeChange: (days: 7 | 30 | 90) => void;
}

function classification(value: HealthProfile["analytics"]["bmiClassification"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ProgressScreen({ profile, history, rangeDays, onRangeChange }: ProgressScreenProps) {
  const [now] = useState(Date.now);
  const day = 24 * 60 * 60 * 1000;
  const latestWeight = history.weights[0]?.weightKg ?? profile.weightKg;
  const oldestWeight = history.weights[history.weights.length - 1]?.weightKg ?? latestWeight;
  const weightChange = latestWeight - oldestWeight;
  const targetDistance = profile.targetWeightKg === undefined ? null : Math.abs(latestWeight - profile.targetWeightKg);
  const recentActivityDays = history.activities.filter((record) => Date.parse(record.recordedAt) >= now - 7 * day).reduce((total, record) => total + record.activeDays, 0);
  const monthlyActivityDays = history.activities.filter((record) => Date.parse(record.recordedAt) >= now - 30 * day).reduce((total, record) => total + record.activeDays, 0);
  const rangeWeights = history.weights.filter((record) => Date.parse(record.recordedAt) >= now - rangeDays * day).slice(0, 12).reverse();
  const rangeAnalytics = history.analytics.filter((record) => Date.parse(record.recordedAt) >= now - rangeDays * day).slice(0, 12).reverse();
  const latestScoreChange = history.analytics.length > 1 ? history.analytics[0].wellnessScore - history.analytics[1].wellnessScore : null;
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
    return { label: date.toLocaleDateString(undefined, { weekday: "short" }), date: date.toISOString(), days };
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
  const activityCompletion = profile.weeklyActivityDays ? Math.round(Math.max(0, Math.min(100, recentActivityDays / profile.weeklyActivityDays * 100))) : recentActivityDays > 0 ? 100 : 0;
  let habitStreak = 0;
  for (let index = activityWeek.length - 1; index >= 0 && activityWeek[index].days > 0; index -= 1) habitStreak += 1;
  const completionEstimate = (() => {
    if (profile.targetWeightKg === undefined || targetDistance === null || history.weights.length < 2) return "Not enough data";
    const newest = history.weights[0];
    const oldest = history.weights[history.weights.length - 1];
    const elapsedDays = (Date.parse(newest.recordedAt) - Date.parse(oldest.recordedAt)) / day;
    const movement = oldest.weightKg > profile.targetWeightKg ? oldest.weightKg - newest.weightKg : newest.weightKg - oldest.weightKg;
    if (elapsedDays < 1 || movement <= 0 || targetDistance === 0) return targetDistance === 0 ? "Target reached" : "Not enough data";
    const daysRemaining = Math.ceil(targetDistance / (movement / elapsedDays));
    if (!Number.isFinite(daysRemaining) || daysRemaining > 3650) return "Not enough data";
    const date = new Date();
    date.setDate(date.getDate() + daysRemaining);
    return date.toLocaleDateString();
  })();
  const activityReviewDate = (() => {
    const date = new Date(now);
    const daysUntilSunday = (7 - date.getDay()) % 7;
    date.setDate(date.getDate() + daysUntilSunday);
    return date.toLocaleDateString();
  })();

  return (
    <>
      <section className="panel progress-panel">
        <div className="panel-heading"><div><p className="eyebrow">Progress</p><h3>Current view</h3></div></div>
        <div className="progress-grid">
          <ProgressValue label="Goal progress" value={profile.analytics.goalProgress} />
          <ProgressValue label="Wellness score" value={profile.analytics.wellnessScore} />
          <ProgressValue label="Activity score" value={profile.analytics.activityScore} />
          <ProgressValue label="Habits score" value={profile.analytics.habitsScore} />
        </div>
        <div className="comparison-list">
          <div><span className="metric-label">Current weight</span><strong>{latestWeight.toFixed(1)} kg</strong></div>
          <div><span className="metric-label">Target weight</span><strong>{profile.targetWeightKg === undefined ? "No target" : `${profile.targetWeightKg.toFixed(1)} kg`}</strong></div>
          <div><span className="metric-label">Target distance</span><strong>{targetDistance === null ? "No target" : `${targetDistance.toFixed(1)} kg`}</strong></div>
          <div><span className="metric-label">Weight change</span><strong>{weightChange > 0 ? "+" : ""}{weightChange.toFixed(1)} kg</strong></div>
          <div><span className="metric-label">Activity, 7 days</span><strong>{recentActivityDays} days</strong></div>
          <div><span className="metric-label">Activity, 30 days</span><strong>{monthlyActivityDays} days</strong></div>
          <div><span className="metric-label">Completion estimate</span><strong>{completionEstimate}</strong></div>
        </div>
      </section>

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

      <section className="panel trends-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Trends</p><h3>Record view</h3></div>
          <label className="range-control">Time range
            <select value={rangeDays} onChange={(event) => onRangeChange(Number(event.target.value) as 7 | 30 | 90)}>
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
            </select>
          </label>
        </div>
        <div className="trend-grid">
          <div className="trend-card">
            <div className="trend-card-heading"><h4>Weight trend</h4><span>{rangeWeights.length} record(s)</span></div>
            {rangeWeights.length > 0 ? (
              <div className="weight-chart" role="img" aria-label={`Weight trend for the last ${rangeDays} days`}>
                <WeightTrendLine records={rangeWeights} minimum={weightMinimum} span={weightSpan} />
                {targetPosition !== null && <span className="target-line" style={{ bottom: `${24 + (30 + targetPosition * 0.7) * 1.11}px` }} />}
                {rangeWeights.map((record, index) => <div className="weight-column" key={record.id}><span className="weight-bar" style={{ height: `${30 + (record.weightKg - weightMinimum) / weightSpan * 70}%` }} title={`${record.weightKg} kg`}>{weightMilestones[index] !== null && <span className="weight-milestone">{weightMilestones[index]}%</span>}</span><small>{new Date(record.recordedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</small></div>)}
              </div>
            ) : <p className="muted-text">No weight records in this range.</p>}
            <p className="chart-note">{profile.targetWeightKg === undefined ? "No target weight set." : `Target: ${profile.targetWeightKg} kg.`}</p>
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
            {rangeAnalytics.length > 0 ? <WellnessHistoryChart records={rangeAnalytics} /> : <p className="muted-text">No wellness records in this range.</p>}
            <p className="chart-note">{latestScoreChange === null ? "No previous score for comparison." : Math.abs(latestScoreChange) >= 5 ? `Significant change: ${Math.abs(latestScoreChange)} points ${latestScoreChange > 0 ? "higher" : "lower"} than the previous record.` : `Change: ${Math.abs(latestScoreChange)} points ${latestScoreChange >= 0 ? "higher" : "lower"} than the previous record.`}</p>
          </div>
        </div>
        <div className="activity-week">
          <div className="trend-card-heading"><h4>Activity week</h4><span>{recentActivityDays} days recorded</span></div>
          <div className="activity-blocks" role="img" aria-label="Activity recorded during the last seven days">
            {activityWeek.map((item) => <div className="activity-day" key={item.date}><span className={`activity-block activity-level-${Math.min(4, item.days)}`} title={`${item.days} active day(s)`} /><small>{item.label}</small></div>)}
          </div>
        </div>
        <div className="milestones">
          <div className="trend-card-heading"><h4>Milestones</h4><span>Based on saved records</span></div>
          <div className="milestone-grid">
            <div><strong>{weightGoalProgress}%</strong><span>Weight goal progress</span></div><div><strong>{nextWeightMilestone}%</strong><span>Next goal step</span></div><div><strong>{activityCompletion}%</strong><span>Activity completion</span></div><div><strong>{habitStreak} day(s)</strong><span>Habit streak</span></div><div><strong>{profile.exerciseTypes.length}/4</strong><span>Exercise types</span></div><div><strong>{profile.weeklyActivityDays}</strong><span>Planned days per week</span></div>
          </div>
        </div>
      </section>
    </>
  );
}
