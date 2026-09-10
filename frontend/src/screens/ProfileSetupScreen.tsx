import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, Save, UserRoundCheck } from "lucide-react";
import NumericSlider from "../NumericSlider";
import { HelpTip } from "../components/HelpTip";
import { labels, profileSteps } from "../app-data";
import { Metric, WellnessGauge } from "../components/HealthVisuals";
import { asNumber, displayDate, formatClassification, splitList } from "../format";
import { activityLevels, exerciseTypes, fitnessGoals, type ExerciseType, type HealthProfile, type PrivacySettings, type ProfileFormValues } from "../types";

interface ProfileSetupScreenProps {
  form: ProfileFormValues;
  profile: HealthProfile | null;
  privacy: PrivacySettings;
  profileStep: number;
  furthestProfileStep: number;
  guestMode: boolean;
  signedIn: boolean;
  onlineAiAvailable: boolean;
  saving: boolean;
  error?: string | null;
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
  const errorRef = useRef<HTMLDivElement>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  useEffect(() => {
    if (!props.error) return;
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [props.error, props.profileStep, validationAttempt]);
  const keepDraftInForm = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && props.profileStep < profileSteps.length - 1) {
      event.preventDefault();
    }
  };

  return (
    <>
      <section className="intro compact-intro">
        <div>
          <p className="eyebrow">Your profile</p>
          <h2>{props.profile ? "Edit your health profile." : "Set up your health profile."}</h2>
          <p>Your details guide health calculations and nutrition recommendations.</p>
        </div>
        <button className="secondary-button button-with-icon" type="button" onClick={props.onOpenTutorial}><BookOpen aria-hidden="true" /><span>Tutorial</span></button>
      </section>

      <div className="content-grid">
        <form className="panel profile-form" aria-label="Health profile" onSubmit={event => { setValidationAttempt(value => value + 1); props.onSubmit(event); }} onKeyDown={keepDraftInForm} noValidate>
          <p className="profile-form-note">{props.guestMode
            ? "Guest profile data clears when you leave or reload. Confirm data use to apply your changes."
            : "Nothing is saved until you confirm your changes in Data use."}</p>

          <ProfileStepNavigation current={props.profileStep} hasProfile={Boolean(props.profile)} onSelect={props.onSelectStep} />

          {props.profileStep === 0 && <BasicStep form={props.form} onUpdate={props.onUpdate} onSliderValidity={props.onSliderValidity} />}
          {props.profileStep === 1 && <GoalsStep form={props.form} onUpdate={props.onUpdate} />}
          {props.profileStep === 2 && <FitnessStep form={props.form} onUpdate={props.onUpdate} onToggleExercise={props.onToggleExercise} />}
          {props.profileStep === 3 && <DataUseStep form={props.form} privacy={props.privacy} guestMode={props.guestMode} onlineAiAvailable={props.onlineAiAvailable} onUpdatePrivacy={props.onUpdatePrivacy} />}

          {props.error && <div ref={errorRef} id="profile-save-error" className="notice error profile-save-error" role="alert" tabIndex={-1}>
            <strong>Changes have not been saved.</strong><p>{props.error}</p>
            {props.profileStep === 3 && !props.privacy.consentGiven && <button className="text-button" type="button" onClick={() => { const consent = document.getElementById("profile-data-consent"); consent?.focus({ preventScroll: true }); consent?.scrollIntoView({ block: "center" }); }}>Review data use</button>}
          </div>}
          <div className="wizard-actions">
            <button className="secondary-button button-with-icon" disabled={props.profileStep === 0} type="button" onClick={props.onBack}><ArrowLeft aria-hidden="true" /><span>Back</span></button>
            {props.profileStep < profileSteps.length - 1 ? (
              <button key="continue-profile" className="primary-button button-with-icon" type="button" onClick={(event) => { event.preventDefault(); setValidationAttempt(value => value + 1); props.onNext(); }}><span>Continue</span><ArrowRight aria-hidden="true" /></button>
            ) : (
              <button key="save-profile" className="primary-button button-with-icon" disabled={props.saving} aria-busy={props.saving} type="submit"><Save aria-hidden="true" /><span>{props.saving ? "Saving..." : props.guestMode ? "Use for this visit" : props.profile ? "Save changes" : "Save profile"}</span></button>
            )}
          </div>
        </form>

        <ProfileResults profile={props.profile} />
      </div>
    </>
  );
}

function ProfileStepNavigation({ current, hasProfile, onSelect }: { current: number; hasProfile: boolean; onSelect: (step: number) => void }) {
  return (
    <nav className="wizard-nav" aria-label="Profile steps">
      {profileSteps.map((step, index) => {
        const completed = hasProfile;
        return (
          <button className={`wizard-step${index === current ? " current" : ""}${completed ? " completed" : ""}`} type="button" key={step} aria-current={index === current ? "step" : undefined} onClick={() => onSelect(index)}>
            <span>{completed && index !== current ? <><Check aria-hidden="true" /><span className="sr-only">Done</span></> : index + 1}</span>
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
      <div className="field-grid two-columns basic-profile-grid">
        <NumericSlider showSlider={false} label="Age" value={form.age} min={1} max={120} unit="years" onChange={(value) => onUpdate("age", value)} onValidityChange={(error) => onSliderValidity("age", error)} />
        <label>Gender<select value={form.gender} onChange={(event) => onUpdate("gender", event.target.value)}>
          <option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="another">Another identity</option><option value="prefer_not_to_say">Prefer not to say</option>
        </select></label>
        <NumericSlider showSlider={false} label="Height" value={form.heightCm} min={50} max={250} step={0.5} unit="cm" onChange={(value) => onUpdate("heightCm", value)} onValidityChange={(error) => onSliderValidity("height", error)} />
        <NumericSlider showSlider={false} label="Current weight" value={form.weightKg} min={20} max={400} step={0.5} unit="kg" onChange={(value) => onUpdate("weightKg", value)} onValidityChange={(error) => onSliderValidity("weight", error)} />
      </div>
      <details className="optional-section">
        <summary>Optional profile details</summary>
        <div className="field-grid two-columns optional-fields">
          <label>Name for Hale<input autoComplete="given-name" maxLength={60} value={form.displayName ?? ""} onChange={(event) => onUpdate("displayName", event.target.value)} /><small>Optional. Hale can use this name in your conversations.</small></label>
          <label>Occupation type<input value={form.occupationType} maxLength={80} placeholder="For example, office work" onChange={(event) => onUpdate("occupationType", event.target.value)} /></label>
          <label className="checkbox-label no-target-option"><input type="checkbox" checked={form.targetWeightKg === undefined} onChange={(event) => { onUpdate("targetWeightKg", event.target.checked ? undefined : form.weightKg); if (event.target.checked) onSliderValidity("targetWeight", null); }} />No target weight</label>
          {form.targetWeightKg !== undefined && <div className="wide-field"><NumericSlider showSlider={false} label="Target weight" value={form.targetWeightKg} min={20} max={400} step={0.5} unit="kg" onChange={(value) => onUpdate("targetWeightKg", value)} onValidityChange={(error) => onSliderValidity("targetWeight", error)} /></div>}
        </div>
      </details>
    </fieldset>
  );
}

function GoalsStep({ form, onUpdate }: Pick<ProfileSetupScreenProps, "form" | "onUpdate">) {
  const activityDescriptions = {
    sedentary: "Mostly sitting, with little walking or exercise.",
    light: "Some walking and occasional light exercise.",
    moderate: "Regular exercise and a mix of sitting and movement.",
    active: "Lots of movement most days, or a physically active job.",
    very_active: "Intense training or demanding physical work most days.",
  };
  return (
    <fieldset>
      <legend>Goals and routine</legend>
      <div className="field-grid two-columns">
        <div className="field-with-help"><div className="field-label-row"><label htmlFor="profile-fitness-goal">Fitness goal</label></div><select id="profile-fitness-goal" value={form.fitnessGoal} onChange={event => onUpdate("fitnessGoal", event.target.value as ProfileFormValues["fitnessGoal"])}>{fitnessGoals.map(goal => <option key={goal} value={goal}>{labels[goal]}</option>)}</select></div>
        <div className="field-with-help"><div className="field-label-row"><label htmlFor="profile-activity-level">Activity level</label><HelpTip label="activity level" text="Think about a usual week, including your job, walking and exercise. This helps Haleview estimate energy needs. Choose your typical routine, not your busiest day." /></div>
          <select id="profile-activity-level" aria-describedby="activity-level-description" value={form.activityLevel} onChange={(event) => onUpdate("activityLevel", event.target.value as ProfileFormValues["activityLevel"])}>{activityLevels.map(level => <option key={level} value={level}>{labels[level]}</option>)}</select>
          <small id="activity-level-description" className="field-description">{activityDescriptions[form.activityLevel]}</small>
        </div>
        <div className="field-with-help"><div className="field-label-row"><label htmlFor="profile-active-days">Active days per week</label><HelpTip label="active days per week" text="Count days when you exercise or deliberately stay active, from 0 to 7. This is your weekly routine goal; Activity level describes how active your whole week usually is." /></div><input id="profile-active-days" type="number" min="0" max="7" value={form.weeklyActivityDays} onChange={event => onUpdate("weeklyActivityDays", asNumber(event.target.value))} /></div>
      </div>
      <details className="optional-section">
        <summary>Food preferences and restrictions</summary>
        <div className="field-grid two-columns optional-fields">
          <CommaListInput label="Dietary preferences" values={form.dietaryPreferences} onChange={(values) => onUpdate("dietaryPreferences", values)} />
          <CommaListInput label="Dietary restrictions" values={form.dietaryRestrictions} onChange={(values) => onUpdate("dietaryRestrictions", values)} />
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

function CommaListInput({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState(values.join(", "));

  useEffect(() => {
    const draftValues = splitList(draft);
    if (draftValues.length !== values.length || draftValues.some((value, index) => value !== values[index])) {
      setDraft(values.join(", "));
    }
  }, [draft, values]);

  return (
    <label>{label}<input
      value={draft}
      placeholder="For example, vegetarian, low sodium"
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(splitList(event.target.value));
      }}
      onBlur={() => setDraft(values.join(", "))}
    /></label>
  );
}

function DataUseStep({ form, privacy, guestMode, onlineAiAvailable, onUpdatePrivacy }: Pick<ProfileSetupScreenProps, "form" | "privacy" | "guestMode" | "onlineAiAvailable" | "onUpdatePrivacy">) {
  const onlineAiDisabled = guestMode || !onlineAiAvailable;
  const onlineAiText = guestMode
    ? "Online AI is unavailable in guest mode. Sign in or create an account to enable it. Local guidance still works."
    : onlineAiAvailable
      ? "Available. Chat can use your optional name and relevant wellness data. Email and credentials are excluded."
      : "Not configured. Local guidance remains available.";
  return (
    <fieldset>
      <legend>Data use</legend>
      <p className="data-note">Haleview uses this profile for calculations and local guidance. Online AI is not required.</p>
      <label className="consent-label"><input id="profile-data-consent" type="checkbox" checked={privacy.consentGiven} onChange={(event) => onUpdatePrivacy("consentGiven", event.target.checked)} /><span>I agree to the collection and use of this data.</span></label>
      <label className={`consent-label ai-consent${onlineAiDisabled ? " disabled-consent" : ""}`}><input type="checkbox" checked={onlineAiDisabled ? false : privacy.dataForRecommendations} disabled={onlineAiDisabled} aria-describedby={guestMode ? "guest-ai-explanation" : undefined} onChange={(event) => onUpdatePrivacy("dataForRecommendations", event.target.checked)} /><span><strong>{guestMode ? "Online AI requires an account" : "Use online AI for Hale"}</strong><small>{onlineAiText}</small></span></label>
      {guestMode && <p id="guest-ai-explanation" className="guest-ai-explanation"><strong>Guest mode: Online AI is off.</strong> This checkbox cannot be enabled as a guest. Sign in or create an account, then enable Online AI in Data use. Calculations and local guidance remain available.</p>}
      <details className="optional-section privacy-section">
        <summary>Sharing and messages</summary>
        <div className="privacy-options optional-fields">
          <label>Public visibility<select disabled={guestMode} value={guestMode ? "private" : privacy.publicVisibility} onChange={(event) => onUpdatePrivacy("publicVisibility", event.target.value as PrivacySettings["publicVisibility"])}><option value="private">Private</option><option value="summary">Summary only</option></select></label>
          <label className="consent-label small-consent"><input type="checkbox" disabled={guestMode} checked={guestMode ? false : privacy.emailNotifications} onChange={(event) => onUpdatePrivacy("emailNotifications", event.target.checked)} /><span>{guestMode ? "Email notifications require an account" : "Send email notifications"}</span></label>
        </div>
      </details>
      <div className="profile-review" aria-label="Profile review">
        <h4>Review</h4>
        <dl>
          <div><dt>Current weight</dt><dd>{form.weightKg} kg</dd></div><div><dt>Target weight</dt><dd>{form.targetWeightKg === undefined ? "Not set" : `${form.targetWeightKg} kg`}</dd></div><div><dt>Goal</dt><dd>{labels[form.fitnessGoal]}</dd></div><div><dt>Active days</dt><dd>{form.weeklyActivityDays} per week</dd></div><div><dt>Exercise types</dt><dd>{form.exerciseTypes.length || "None selected"}</dd></div><div><dt>Online AI</dt><dd>{guestMode ? "Account required" : !onlineAiAvailable ? "Unavailable" : privacy.dataForRecommendations ? "Allowed" : "Off"}</dd></div><div><dt>Visibility</dt><dd>{privacy.publicVisibility === "private" ? "Private" : "Summary only"}</dd></div>
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
          <p className="updated-at">Updated {displayDate(profile.updatedAt)}</p>
        </>
      ) : <div className="profile-setup-help"><span className="tutorial-icon" aria-hidden="true"><UserRoundCheck /></span><h4>Finish the profile first.</h4><p>Complete each step. Nothing is sent or calculated until the final save.</p></div>}
    </aside>
  );
}
