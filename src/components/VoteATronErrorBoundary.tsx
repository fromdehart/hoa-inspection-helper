import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Catches errors when Convex deployment doesn't have votes module yet
 * (e.g. before running npx convex dev / npx convex deploy).
 * Renders nothing so the rest of the app keeps working.
 */
export class VoteATronErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
