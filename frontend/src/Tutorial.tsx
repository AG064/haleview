import { useState } from "react";

const tutorialSteps = [
  {
    icon: "fa-user-lock",
    title: "Choose access",
    text: "Use an account on several devices. Guest data stays in this browser."
  },
  {
    icon: "fa-sliders",
    title: "Set up the profile",
    text: "Use a slider or type each value. Confirm data use before saving."
  },
  {
    icon: "fa-chart-line",
    title: "Read the dashboard",
    text: "Review BMI, wellness, goal progress, and recent Hale guidance."
  },
  {
    icon: "fa-list-check",
    title: "Track progress",
    text: "Add activity records. Use Progress and Records to review changes."
  },
  {
    icon: "fa-heart-pulse",
    title: "Use Hale",
    text: "Local guidance is always available. Online AI is optional and clearly labelled."
  }
] as const;

interface TutorialProps {
  onClose: () => void;
}

export default function Tutorial({ onClose }: TutorialProps) {
  const [step, setStep] = useState(0);
  const current = tutorialSteps[step];

  return (
    <section className="panel tutorial-panel" aria-labelledby="tutorial-title">
      <div className="tutorial-heading">
        <div>
          <p className="eyebrow">Tutorial</p>
          <h2 id="tutorial-title">Start with Haleview</h2>
        </div>
        <button className="text-button" type="button" onClick={onClose}>Skip tutorial</button>
      </div>

      <nav className="tutorial-steps" aria-label="Tutorial steps">
        {tutorialSteps.map((item, index) => (
          <button
            className={index === step ? "active" : ""}
            type="button"
            key={item.title}
            aria-current={index === step ? "step" : undefined}
            aria-label={`Step ${index + 1}: ${item.title}`}
            onClick={() => setStep(index)}
          >
            {index < step ? <i className="fa-solid fa-check" aria-hidden="true" /> : index + 1}
          </button>
        ))}
      </nav>

      <div className="tutorial-content">
        <span className="tutorial-icon" aria-hidden="true"><i className={`fa-solid ${current.icon}`} /></span>
        <p className="eyebrow">Step {step + 1} of {tutorialSteps.length}</p>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
      </div>

      <div className="tutorial-actions">
        <button className="secondary-button" type="button" disabled={step === 0} onClick={() => setStep((currentStep) => Math.max(0, currentStep - 1))}>Back</button>
        {step < tutorialSteps.length - 1 ? (
          <button className="primary-button compact-button" type="button" onClick={() => setStep((currentStep) => currentStep + 1)}>Next</button>
        ) : (
          <button className="primary-button compact-button" type="button" onClick={onClose}>Finish</button>
        )}
      </div>
    </section>
  );
}
