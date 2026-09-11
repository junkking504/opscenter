import { Component, type ReactNode } from 'react';

/** A stale deployment chunk or render error must not remove the app navigation. */
export class WorkspaceBoundary extends Component<{ children: ReactNode; root?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="workspace-loading" role="alert">
      <h2>This workspace could not open.</h2>
      <p>Reload OpsCenter to retrieve the current page. {!this.props.root && 'Other workspaces remain available.'}</p>
      <button type="button" onClick={() => window.location.reload()}>Reload OpsCenter</button>
    </section>;
    return this.props.children;
  }
}
