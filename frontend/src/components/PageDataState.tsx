import { LoadingView, WaitingState, type LoadingViewKind } from "./WaitingState";

interface PageDataStateProps {
  title: string;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  compact?: boolean;
  view?: LoadingViewKind;
}

export function PageDataState({ title, loading, error, onRetry, compact = false, view }: PageDataStateProps) {
  return (
    <section className={compact ? "page-data-state" : "panel page-data-state"} aria-busy={loading}>
      <h2>{title}</h2>
      {loading ? <>
        <WaitingState label={`Loading ${title.toLowerCase()}.`} />
        <LoadingView view={view} />
      </> : <>
        <p className="error-text" role="alert">{error || `${title} could not be loaded.`}</p>
        <button className="secondary-button" type="button" onClick={onRetry}>Retry</button>
      </>}
    </section>
  );
}
