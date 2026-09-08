import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpen, CalendarDays, ChartLine, ClipboardList, GripHorizontal, HeartPulse, LayoutDashboard, Settings, ShoppingCart, Soup, UserRound, type LucideIcon } from "lucide-react";
import type { AppRoute } from "./routing";

type TutorialRoute = Exclude<AppRoute, "not-found" | "tutorial">;

interface TutorialStep {
  icon: LucideIcon;
  title: string;
  text: string;
  task: string;
  route: TutorialRoute;
  routeLabel: string;
  accountOnly?: boolean;
}

const tutorialSteps: TutorialStep[] = [
  { icon: UserRound, title: "Complete your profile", text: "Work through four short sections. Your values stay as a draft until you save on Data use.", task: "Enter the values that you know. Optional fields can stay empty.", route: "profile-setup", routeLabel: "Open profile" },
  { icon: LayoutDashboard, title: "Use the overview", text: "The dashboard shows a short summary. Detailed charts stay on their own pages.", task: "Check the current score, then choose one area to review.", route: "dashboard", routeLabel: "Open dashboard" },
  { icon: CalendarDays, title: "Build a meal plan", text: "Create a day or week plan from the open recipe catalogue.", task: "Generate a plan, then swap or move one meal.", route: "meal-plan", routeLabel: "Open meal plan" },
  { icon: Soup, title: "Record nutrition", text: "Add eaten food and compare the day with your targets.", task: "Add one meal or ingredient and review the daily totals.", route: "nutrition", routeLabel: "Open nutrition", accountOnly: true },
  { icon: ShoppingCart, title: "Prepare a shopping list", text: "Make a list from a meal, a day, or a full plan.", task: "Create a list, then check or edit one item.", route: "shopping-list", routeLabel: "Open shopping list", accountOnly: true },
  { icon: BookOpen, title: "Find a recipe", text: "Search public-domain recipes and filter by diet, nutrition, or time.", task: "Open one recipe and follow its source link.", route: "recipes", routeLabel: "Open recipes" },
  { icon: ChartLine, title: "Review progress", text: "Progress keeps trends and charts away from the main dashboard.", task: "Change the date range and inspect one trend.", route: "progress", routeLabel: "Open progress" },
  { icon: ClipboardList, title: "Add records", text: "Records holds activity entries and the full history list.", task: "Add an activity record with the correct date and time.", route: "records", routeLabel: "Open records" },
  { icon: HeartPulse, title: "Ask Hale for guidance", text: "Hale shows local guidance first. Online AI is optional and needs an account plus consent.", task: "Open Hale and review the next suggested action.", route: "hale", routeLabel: "Open Hale", accountOnly: true },
  { icon: Settings, title: "Control your data", text: "Settings contains privacy, export, account access, and two-step sign-in.", task: "Review online AI and visibility before you finish.", route: "settings", routeLabel: "Open settings" }
];

interface TutorialProps {
  currentRoute: TutorialRoute;
  hasProfile: boolean;
  signedIn: boolean;
  onNavigate: (route: TutorialRoute) => void;
  onClose: () => void;
}

interface TutorialPosition {
  left: number;
  top: number;
}

interface TutorialDragState extends TutorialPosition {
  pointerId: number;
  pointerX: number;
  pointerY: number;
}

const tutorialMobileQuery = "(max-width: 680px)";
const tutorialViewportGap = 8;

export default function Tutorial({ currentRoute, hasProfile, signedIn, onNavigate, onClose }: TutorialProps) {
  const [step, setStep] = useState(0);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(tutorialMobileQuery).matches);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [position, setPosition] = useState<TutorialPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const dragStateRef = useRef<TutorialDragState | null>(null);
  const pendingPositionRef = useRef<TutorialPosition | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const current = tutorialSteps[step];
  const CurrentIcon = current.icon;
  const needsProfile = !hasProfile && current.route !== "profile-setup";
  const needsAccount = Boolean(current.accountOnly && !signedIn);
  const actionDisabled = needsProfile || needsAccount;
  const actionNote = needsProfile
    ? "Complete the profile to unlock this page."
    : needsAccount
      ? "Sign in to use this page."
      : currentRoute === current.route
        ? "You are on this page."
        : "Open the page and try the task.";

  const clampPosition = (left: number, top: number): TutorialPosition => {
    const panel = panelRef.current;
    const panelWidth = panel?.offsetWidth ?? 400;
    const panelHeight = panel?.offsetHeight ?? 0;
    const maximumLeft = Math.max(tutorialViewportGap, window.innerWidth - panelWidth - tutorialViewportGap);
    const maximumTop = Math.max(tutorialViewportGap, window.innerHeight - panelHeight - tutorialViewportGap);

    return {
      left: Math.min(Math.max(tutorialViewportGap, left), maximumLeft),
      top: Math.min(Math.max(tutorialViewportGap, top), maximumTop)
    };
  };

  const schedulePosition = (nextPosition: TutorialPosition) => {
    pendingPositionRef.current = nextPosition;
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      if (pendingPositionRef.current) setPosition(pendingPositionRef.current);
    });
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.matchMedia(tutorialMobileQuery).matches || !panelRef.current) return;

    const bounds = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: bounds.left,
      top: bounds.top
    };
    setPosition({ left: bounds.left, top: bounds.top });
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    schedulePosition(clampPosition(
      dragState.left + event.clientX - dragState.pointerX,
      dragState.top + event.clientY - dragState.pointerY
    ));
    event.preventDefault();
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  useEffect(() => {
    const mobileQuery = window.matchMedia(tutorialMobileQuery);
    const resetForMobile = () => {
      setIsMobile(mobileQuery.matches);
      if (!mobileQuery.matches) return;
      setMobileExpanded(false);
      dragStateRef.current = null;
      pendingPositionRef.current = null;
      setIsDragging(false);
      setPosition(null);
    };

    resetForMobile();
    mobileQuery.addEventListener("change", resetForMobile);
    return () => mobileQuery.removeEventListener("change", resetForMobile);
  }, []);

  useEffect(() => {
    if (!isMobile || !panelRef.current) return;
    const root = document.documentElement;
    document.body.classList.add("has-mobile-guide");
    const updateSpace = () => {
      root.style.setProperty("--mobile-guide-height", `${panelRef.current?.offsetHeight ?? 0}px`);
      root.style.setProperty("--guide-viewport-height", `${window.visualViewport?.height ?? window.innerHeight}px`);
    };
    const observer = new ResizeObserver(updateSpace);
    observer.observe(panelRef.current);
    updateSpace();
    const focusForm = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || panelRef.current?.contains(target)) return;
      if (target.matches("input, select, textarea, [contenteditable=true]")) setMobileExpanded(false);
    };
    document.addEventListener("focusin", focusForm);
    window.visualViewport?.addEventListener("resize", updateSpace);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", focusForm);
      window.visualViewport?.removeEventListener("resize", updateSpace);
      document.body.classList.remove("has-mobile-guide");
      root.style.removeProperty("--mobile-guide-height");
      root.style.removeProperty("--guide-viewport-height");
    };
  }, [isMobile]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const tutorialStyle: CSSProperties | undefined = position
    ? { left: position.left, top: position.top, right: "auto", bottom: "auto" }
    : undefined;

  if (isMobile) return (
    <aside ref={panelRef} className={`mobile-tutorial${mobileExpanded ? " is-expanded" : ""}`} aria-label="Haleview guide">
      <div className="mobile-tutorial-heading"><strong>{step + 1}/{tutorialSteps.length} · {current.title}</strong>
        <button className="text-button" type="button" aria-expanded={mobileExpanded} aria-controls="mobile-guide-details" onClick={() => setMobileExpanded(value => !value)}>{mobileExpanded ? "Less" : "Details"}</button>
        <button className="text-button" type="button" aria-label="Close guide" onClick={onClose}>Close</button>
      </div>
      <p className="mobile-tutorial-task">{current.task}</p>
      {mobileExpanded && <div id="mobile-guide-details" className="mobile-tutorial-details">
        <p>{current.text}</p>
        <label>Guide step<select value={step} onChange={event => setStep(Number(event.target.value))}>{tutorialSteps.map((item, index) => <option value={index} key={item.title}>{index + 1}. {item.title}</option>)}</select></label>
        <button className="secondary-button" type="button" disabled={actionDisabled} onClick={() => { onNavigate(current.route); setMobileExpanded(false); }}>{current.routeLabel}</button>
        <small>{actionNote}</small>
      </div>}
      <div className="mobile-tutorial-actions"><button className="text-button" type="button" disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}>Previous tip</button>
        <button className="text-button" type="button" onClick={() => step === tutorialSteps.length - 1 ? onClose() : setStep(value => value + 1)}>{step === tutorialSteps.length - 1 ? "Finish guide" : "Next tip"}</button>
      </div>
    </aside>
  );

  return (
    <aside ref={panelRef} className={`tutorial-overlay${isDragging ? " is-dragging" : ""}`} style={tutorialStyle} role="dialog" aria-labelledby="tutorial-title" aria-modal="false">
      <div className="tutorial-heading">
        <div className="tutorial-title-group">
          <button
            className="tutorial-drag-handle"
            type="button"
            aria-label="Move guide window"
            title="Drag to move the guide"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <GripHorizontal aria-hidden="true" />
          </button>
          <div><p className="eyebrow">Interactive guide</p><h2 id="tutorial-title">Learn Haleview</h2></div>
        </div>
        <button className="text-button" type="button" onClick={onClose} aria-label="Close guide">Close</button>
      </div>

      <nav className="tutorial-steps" aria-label="Guide steps">
        {tutorialSteps.map((item, index) => (
          <button className={index === step ? "active" : ""} type="button" key={item.title} aria-current={index === step ? "step" : undefined} aria-label={`Step ${index + 1}: ${item.title}`} onClick={() => setStep(index)}>
            {index + 1}
          </button>
        ))}
      </nav>

      <div className="tutorial-content" aria-live="polite">
        <span className={`tutorial-icon icon-tone-${step % 3}`} aria-hidden="true"><CurrentIcon /></span>
        <p className="eyebrow">Step {step + 1} of {tutorialSteps.length}</p>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
        <div className="tutorial-task"><strong>Try this</strong><span>{current.task}</span></div>
        <button className="secondary-button tutorial-open-page" type="button" disabled={actionDisabled} onClick={() => onNavigate(current.route)}>{current.routeLabel}</button>
        <small className="tutorial-action-note">{actionNote}</small>
      </div>

      <div className="tutorial-actions">
        <button className="secondary-button" type="button" disabled={step === 0} onClick={() => setStep((currentStep) => Math.max(0, currentStep - 1))}>Back</button>
        {step < tutorialSteps.length - 1 ? (
          <button className="primary-button compact-button" type="button" onClick={() => setStep((currentStep) => currentStep + 1)}>Next</button>
        ) : (
          <button className="primary-button compact-button" type="button" onClick={onClose}>Finish</button>
        )}
      </div>
    </aside>
  );
}
