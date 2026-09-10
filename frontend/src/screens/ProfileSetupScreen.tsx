import type { FormEvent } from "react";
import NumericSlider from "../NumericSlider";
import { labels, profileSteps } from "../app-data";
import { Metric, WellnessGauge } from "../components/HealthVisuals";
import { asNumber, formatClassification, splitList } from "../format";
import { activityLevels, exerciseTypes, fitnessGoals, type ExerciseType, type HealthProfile, type PrivacySettings, type ProfileFormValues } from "../types";

interface ProfileSetupScreenProps {
  form: ProfileFormValues;
  profile: HealthProfile | null;
  privacy: PrivacySettings;
  profileStep: number;
  furthestProfileStep: number;
  guestMode: boolean;
  signedIn: boolean;
  saving: boolean;
  onOpenTutorial: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => void;
  onUpdatePrivacy: <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => void;
  onToggleExercise: (exercise: ExerciseType) => void;
  onSliderValidity: (field: string, error: string | null) => void;
  onSelectStep: (step: number) => void;
  onBack: () => void;
  onNext: () => void;
}

export function ProfileSetupScreen(props: ProfileSetupScreenProps) {
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <p className="eyebrow">Your profile</p>
          <h2>Set up your health profile.</h2>
          <p>Add the details needed for results and guidance. You can change them later.</p>
        </div>
        <button className="secondary-button" type="button" onClick={props.onOpenTutorial}>Tutorial</button>
      </section>

      <div className="content-grid">
        <form className="panel profile-form" onSubmit={props.onSubmit} noValidate>
          <div className="panel-heading">
            <div>
              <h3>Profile data</h3>
              {props.guestMode && <p className="required-note">Guest values are saved in this browser.</p>}
              {props.signedIn && props.profile && <p className="required-note">Saved values are already filled. Open only the steps you need.</p>}
            </div>
          </div>

          <ProfileStepNavigation current={props.profileStep} furthest={props.furthestProfileStep} hasProfile={Boolean(props.profile)} onSelect={props.onSelectStep} />

          {props.profileStep === 0 && <BasicStep form={props.form} onUpdate={props.onUpdate} onSliderValidity={props.onSliderValidity} />}
          {props.profileStep === 1 && <GoalsStep form={props.form} onUpdate={props.onUpdate} />}
          {props.profileStep === 2 && <FitnessStep form={props.form} onUpdate={props.onUpdate} onToggleExercise={props.onToggleExercise} />}
          {props.profileStep === 3 && <DataUseStep form={props.form} privacy={props.privacy} onUpdatePrivacy={props.onUpdatePrivacy} />}

          <div className="wizard-actions">
            <button className="secondary-button" disabled={props.profileStep === 0} type="button" onClick={props.onBack}>Back</button>
            {props.profileStep < profileSteps.length - 1 ? (
              <button className="primary-button" type="button" onClick={props.onNext}>Next</button>
            ) : (
              <button className="primary-button" disabled={props.saving} type="submit">{props.saving ? "Saving..." : props.profile ? "Save changes" : "Save profile"}</button>
            )}
          </div>
        </form>

        <ProfileResults profile={props.profile} />
      </div>
    </>
  );
}

function ProfileStepNavigation({ current, furthest, hasProfile, onSelect }: { current: number; furthest: number; hasProfile: boolean; onSelect: (step: number) => void }) {
  return (
    <nav className="wizard-nav" aria-label="Profile steps">
      {profileSteps.map((step, index) => {
        const completed = hasProfile || index < current || index <= furthest && index !== current;
        return (
          <button className={`wizard-step${index === current ? " current" : ""}${completed ? " completed" : ""}`} type="button" key={step} aria-current={index === current ? "step" : undefined} disabled={!hasProfile && index > furthest} onClick={() => onSelect(index)}>
            <span>{completed && index !== current ? <><i className="fa-solid fa-check" aria-hidden="true" /><span className="sr-only">Done</span></> : index + 1}</span>
            {step}
          </button>
        );
      })}
    </nav>
  );
}

function BasicStep({ form, onUpdate, onSliderValidity }: Pick<ProfileSetupScreenProps, "form" | "onUpdate" | "onSliderValidity">) {
  return (
    <fieldset>
      <legend>Basic information</legend>
      <div className="field-grid two-columns slider-grid">
        <NumericSlider label="Age" value={form.age} min={1} max={120} unit="years" onChange={(value) => onUpdate("age", value)} onValidityChange={(error) => onSliderValidity("age", error)} />
        <label>Gender<select value={form.gender} onChange={(event) => onUpdate("gender", event.target.value)}>
          <option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="another">Another identity</option><option value="prefer_not_to_say">Prefer not to say</option>
        </select></label>
        <NumericSlider label="Height" value={form.heightCm} min={50} max={250} step={0.5} unit="cm" onChange={(value) => onUpdate("heightCm", value)} onValidityChange={(error) => onSliderValidity("height", error)} />
        <NumericSlider label="Current weight" value={form.weightKg} min={20} max={400} step={0.5} unit="kg" onChange={(value) => onUpdate("weightKg", value)} onValidityChange={(error) => onSliderValidity("weight", error)} />
      </div>
      <details className="optional-section">
        <summary>Optional profile details</summary>
        <div className="field-grid two-columns optional-fields">
          <label>Occupation type<input value={form.occupationType} maxLength={80} placeholder="For example, office work" onChange={(event) => onUpdate("occupationType", event.target.value)} /></label>
          <label className="checkbox-label no-target-option"><input type="checkbox" checked={form.targetWeightKg === undefined} onChange={(event) => { onUpdate("targetWeightKg", event.target.checked ? undefined : form.weightKg); if (event.target.checked) onSliderValidity("targetWeight", null); }} />No target weight</label>
          {form.targetWeightKg !== undefined && <div className="wide-field"><NumericSlider label="Target weight" value={form.targetWeightKg} min={20} max={400} step={0.5} unit="kg" onChange={(value) => onUpdate("targetWeightKg", value)} onValidityChange={(error) => onSliderValidity("targetWeight", error)} /></div>}
        </div>
      </details>
    </fieldset>
  );
}

function GoalsStep({ form, onUpdate }: Pick<ProfileSetupScreenProps, "form" | "onUpdate">) {
  return (
    <fieldset>
      <legend>Goals and routine</legend>
      <div className="field-grid two-columns">
        <label>Fitness goal<select value={form.fitnessGoal} onChange={(event) => onUpdate("fitnessGoal", event.target.value as ProfileFormValues["fitnessGoal"])}>{fitnessGoals.map((goal) => <option key={goal} value={goal}>{labels[goal]}</option>)}</select></label>
        <label>Activity level<select value={form.activityLevel} onChange={(event) => onUpdate("activityLevel", event.target.value as ProfileFormValues["activityLevel"])}>{activityLevels.map((level) => <option key={level} value={level}>{labels[level]}</option>)}</select></label>
        <label>Active days per week<input type="number" min="0" max="7" value={form.weeklyActivityDays} onChange={(event) => onUpdate("weeklyActivityDays", asNumber(event.target.value))} /></label>
      </div>
      <details className="optional-section">
        <summary>Food preferences and restrictions</summary>
        <div className="field-grid two-columns optional-fields">
          <label>Dietary preferences<input value={form.dietaryPreferences.join(", ")} placeholder="Separate values with commas" onChange={(event) => onUpdate("dietaryPreferences", splitList(event.target.value))} /></label>
          <label>Dietary restrictions<input value={form.dietaryRestrictions.join(", ")} placeholder="Separate values with commas" onChange={(event) => onUpdate("dietaryRestrictions", splitList(event.target.value))} /></label>
        </div>
      </details>
    </fieldset>
  );
}

function FitnessStep({ form, onUpdate, onToggleExercise }: Pick<ProfileSetupScreenProps, "form" | "onUpdate" | "onToggleExercise">) {
  return (
    <fieldset>
      <legend>Fitness assessment</legend>
      <div className="field-grid three-columns">
        <label>Session duration<select value={form.sessionDuration} onChange={(event) => onUpdate("sessionDuration", event.target.value as ProfileFormValues["sessionDuration"])}><option value="15_30">15 to 30 minutes</option><option value="30_60">30 to 60 minutes</option><option value="60_plus">60 minutes or more</option></select></label>
        <label>Fitness level<select value={form.fitnessLevel} onChange={(event) => onUpdate("fitnessLevel", event.target.value as ProfileFormValues["fitnessLevel"])}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label>Exercise environment<select value={form.exerciseEnvironment} onChange={(event) => onUpdate("exerciseEnvironment", event.target.value as ProfileFormValues["exerciseEnvironment"])}><option value="home">Home</option><option value="gym">Gym</option><option value="outdoors">Outdoors</option></select></label>
        <label>Preferred time<select value={form.exerciseTime} onChange={(event) => onUpdate("exerciseTime", event.target.value as ProfileFormValues["exerciseTime"])}><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></label>
        <label>Endurance, minutes<input type="number" min="0" max="1000" value={form.enduranceMinutes} onChange={(event) => onUpdate("enduranceMinutes", asNumber(event.target.value))} /></label>
        <label>Pushups<input type="number" min="0" max="1000" value={form.pushups} onChange={(event) => onUpdate("pushups", asNumber(event.target.value))} /></label>
        <label>Squats<input type="number" min="0" max="1000" value={form.squats} onChange={(event) => onUpdate("squats", asNumber(event.target.value))} /></label>
      </div>
      <div className="checkbox-group"><span>Exercise types</span><div className="checkbox-row">{exerciseTypes.map((exercise) => <label className="checkbox-label" key={exercise}><input type="checkbox" checked={form.exerciseTypes.includes(exercise)} onChange={() => onToggleExercise(exercise)} />{labels[exercise]}</label>)}</div></div>
    </fieldset>
  );
}

function DataUseStep({ form, privacy, onUpdatePrivacy }: Pick<ProfileSetupScreenProps, "form" | "privacy" | "onUpdatePrivacy">) {
  return (
    <fieldset>
      <legend>Data use</legend>
      <p className="data-note">Haleview uses this profile for calculations and local guidance. Online AI is not required.</p>
      <label className="consent-label"><input type="checkbox" checked={privacy.consentGiven} onChange={(event) => onUpdatePrivacy("consentGiven", event.target.checked)} /><span>I agree to the collection and use of this data.</span></label>
      <label className="consent-label ai-consent"><input type="checkbox" checked={privacy.dataForRecommendations} onChange={(event) => onUpdatePrivacy("dataForRecommendations", event.target.checked)} /><span><strong>Use online AI for Hale</strong><small>Optional. Sends age, body measures, activity, goals, preferences, and restrictions to DeepSeek. Names and email are not sent.</small></span></label>
      <details className="optional-section privacy-section">
        <summary>Sharing and messages</summary>
        <div className="privacy-options optional-fields">
          <label>Public visibility<select value={privacy.publicVisibility} onChange={(event) => onUpdatePrivacy("publicVisibility", event.target.value as PrivacySettings["publicVisibility"])}><option value="private">Private</option><option value="summary">Summary only</option></select></label>
          <label className="consent-label small-consent"><input type="checkbox" checked={privacy.emailNotifications} onChange={(event) => onUpdatePrivacy("emailNotifications", event.target.checked)} /><span>Send email notifications</span></label>
        </div>
      </details>
      <div className="profile-review" aria-label="Profile review">
        <h4>Review</h4>
        <dl>
          <div><dt>Current weight</dt><dd>{form.weightKg} kg</dd></div><div><dt>Target weight</dt><dd>{form.targetWeightKg === undefined ? "Not set" : `${form.targetWeightKg} kg`}</dd></div><div><dt>Goal</dt><dd>{labels[form.fitnessGoal]}</dd></div><div><dt>Active days</dt><dd>{form.weeklyActivityDays} per week</dd></div><div><dt>Exercise types</dt><dd>{form.exerciseTypes.length || "None selected"}</dd></div><div><dt>Online AI</dt><dd>{privacy.dataForRecommendations ? "Allowed" : "Off"}</dd></div><div><dt>Visibility</dt><dd>{privacy.publicVisibility === "private" ? "Private" : "Summary only"}</dd></div>
        </dl>
      </div>
    </fieldset>
  );
}

function ProfileResults({ profile }: { profile: HealthProfile | null }) {
  return (
    <aside className="panel summary-panel">
      <div className="panel-heading"><div><p className="eyebrow">Overview</p><h3>Results</h3></div></div>
      {profile ? (
        <>
          <div className="score-card"><WellnessGauge value={profile.analytics.wellnessScore} /><div className="score-caption"><span className="metric-label">Wellness score</span><span>Current result</span></div></div>
          <div className="metric-list">
            <Metric label="BMI" value={`${profile.analytics.bmi}`} detail={formatClassification(profile.analytics.bmiClassification)} />
            <Metric label="Activity score" value={`${profile.analytics.activityScore}/100`} detail={`${profile.weeklyActivityDays} days per week`} />
            <Metric label="Goal alignment" value={`${profile.analytics.goalProgress}%`} detail={labels[profile.fitnessGoal]} />
            <Metric label="Habits score" value={`${profile.analytics.habitsScore}/100`} detail={`${profile.exerciseTypes.length} exercise types`} />
          </div>
          <div className="summary-note"><span className="note-icon">i</span><p>Values are based on the data above.</p></div>
          <p className="updated-at">Updated {new Date(profile.updatedAt).toLocaleString()}</p>
        </>
      ) : <div className="empty-state"><h4>No results yet.</h4><p>Save the profile to calculate BMI and the other values.</p></div>}
    </aside>
  );
}
