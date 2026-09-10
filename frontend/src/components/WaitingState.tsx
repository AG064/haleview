import { LoaderCircle } from "lucide-react";

export function WaitingState({ label, detail }: { label: string; detail?: string }) {
  return <div className="waiting-state" role="status">
    <LoaderCircle className="waiting-spinner" aria-hidden="true" />
    <div><strong>{label}</strong>{detail && <p>{detail}</p>}</div>
  </div>;
}

export type LoadingViewKind = "recipes" | "plan" | "list" | "metrics" | "form" | "text";

export function LoadingView({ view = "text" }: { view?: LoadingViewKind }) {
  return <div className={`view-skeleton skeleton-${view}`} aria-hidden="true">
    {view === "recipes" ? Array.from({length: 3}, (_, index) => <div className="skeleton-card" key={index}><span className="skeleton-block skeleton-photo" /><span className="skeleton-block skeleton-heading" /><span className="skeleton-block" /><div className="skeleton-chips"><span className="skeleton-block" /><span className="skeleton-block" /></div></div>)
      : view === "metrics" ? <><div className="skeleton-metrics">{[1,2,3].map(value => <div key={value}><span className="skeleton-block skeleton-heading" /><span className="skeleton-block skeleton-number" /></div>)}</div><div className="skeleton-chart">{[45,70,55,85,65,90,75].map((height,index) => <span className="skeleton-block" style={{height: `${height}%`}} key={index} />)}</div></>
      : view === "plan" || view === "list" ? <>{view === "plan" && <div className="skeleton-chips skeleton-days">{[1,2,3,4].map(value => <span className="skeleton-block" key={value} />)}</div>}{[1,2,3,4].map(value => <div className="skeleton-row" key={value}><span className="skeleton-block skeleton-marker" /><div><span className="skeleton-block skeleton-heading" /><span className="skeleton-block" /></div><span className="skeleton-block skeleton-end" /></div>)}</>
      : <>{[1,2,3].map(value => <div className="skeleton-field" key={value}><span className="skeleton-block skeleton-heading" /><span className={`skeleton-block${view === "form" ? " skeleton-input" : ""}`} /></div>)}</>}
  </div>;
}
