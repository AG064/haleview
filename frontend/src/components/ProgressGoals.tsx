interface GoalTrackingProps {
  weightProgress: number;
  targetDistance: number | null;
  weightEstimate: string;
  activityProgress: number;
  recentActivityDays: number;
  plannedActivityDays: number;
  activityReviewDate: string;
  habitProgress: number;
  habitStreak: number;
  exerciseTypeCount: number;
  monthlyActivityDays: number;
}

function progressState(value: number, available = true): string {
  if (!available) return "Not set";
  if (value >= 100) return "Met";
  if (value >= 50) return "In progress";
  return "Starting";
}

function GoalCard({ title, progress, state, detail, estimate }: {
  title: string;
  progress: number;
  state: string;
  detail: string;
  estimate: string;
}) {
  const safeProgress = Math.max(0, Math.min(100, progress));
  return (
    <article className="goal-card">
      <div className="goal-card-heading"><h4>{title}</h4><span>{state}</span></div>
      <strong className="goal-card-value">{safeProgress}%</strong>
      <div className="goal-track" role="img" aria-label={`${title}: ${safeProgress} percent`}><span style={{ width: `${safeProgress}%` }} /></div>
      <p>{detail}</p>
      <small>{estimate}</small>
    </article>
  );
}

function ComparisonBar({ label, value }: { label: string; value: number }) {
  const safeWidth = Math.max(0, Math.min(100, value / 7 * 100));
  return (
    <div className="comparison-bar-row">
      <div><span>{label}</span><strong>{value.toFixed(1)} days</strong></div>
      <div className="comparison-bar-track" role="img" aria-label={`${label}: ${value.toFixed(1)} active days`}><span style={{ width: `${safeWidth}%` }} /></div>
    </div>
  );
}

export function ProgressGoals(props: GoalTrackingProps) {
  const hasWeightTarget = props.targetDistance !== null;
  const monthlyWeeklyAverage = props.monthlyActivityDays / 30 * 7;

  return (
    <section className="panel goal-tracking-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Goals</p><h3>Goal tracking</h3></div>
        <span className="required-note">Three current measures</span>
      </div>
      <div className="goal-card-grid">
        <GoalCard
          title="Weight target"
          progress={hasWeightTarget ? props.weightProgress : 0}
          state={progressState(props.weightProgress, hasWeightTarget)}
          detail={hasWeightTarget ? `${props.targetDistance?.toFixed(1)} kg remaining.` : "Add a target weight to track this goal."}
          estimate={`Estimate: ${hasWeightTarget ? props.weightEstimate : "Not available"}`}
        />
        <GoalCard
          title="Weekly activity"
          progress={props.activityProgress}
          state={progressState(props.activityProgress, props.plannedActivityDays > 0)}
          detail={`${props.recentActivityDays} of ${props.plannedActivityDays} planned active days.`}
          estimate={`Review date: ${props.activityReviewDate}`}
        />
        <GoalCard
          title="Habit consistency"
          progress={props.habitProgress}
          state={progressState(props.habitProgress)}
          detail={`${props.habitStreak} day streak and ${props.exerciseTypeCount} exercise types.`}
          estimate="This goal remains active."
        />
      </div>
      <div className="activity-comparison">
        <div className="trend-card-heading"><h4>Weekly and monthly activity</h4><span>Seven-day comparison</span></div>
        <div className="comparison-bars">
          <ComparisonBar label="This week" value={props.recentActivityDays} />
          <ComparisonBar label="30-day weekly average" value={monthlyWeeklyAverage} />
        </div>
      </div>
    </section>
  );
}
