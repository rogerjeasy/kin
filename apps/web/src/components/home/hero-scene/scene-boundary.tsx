"use client";

import { Component, type ReactNode } from "react";

type SceneBoundaryProps = { onError: () => void; children: ReactNode };

/**
 * Keeps a failed 3D scene (no WebGL, a lost GPU context) from taking the page
 * with it: the still poster stays. React catches render errors only in a class.
 */
export class SceneBoundary extends Component<SceneBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
