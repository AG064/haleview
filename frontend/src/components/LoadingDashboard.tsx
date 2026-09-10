export function LoadingDashboard() {
  return (
    <main className="app-shell loading-shell" aria-busy="true">
      <header className="loading-header">
        <div><strong>Haleview</strong><span>Health and progress</span></div>
        <div className="loading-tabs" aria-hidden="true"><span /><span /><span /></div>
      </header>
      <p className="loading-label" role="status">Loading health data.</p>
      <section className="loading-panel" aria-hidden="true">
        <div className="loading-title" />
        <div className="loading-overview">
          <div className="loading-gauge" />
          <div className="loading-lines"><span /><span /><span /><span /></div>
          <div className="loading-lines"><span /><span /><span /><span /></div>
        </div>
      </section>
    </main>
  );
}
