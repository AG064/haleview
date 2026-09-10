import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Keep health and account details out of browser logs.
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="status-page">
          <section className="status-card">
            <p className="eyebrow">Page error</p>
            <h1>This page could not open.</h1>
            <p>Reload the page. Your saved profile will remain available.</p>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>Reload</button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
