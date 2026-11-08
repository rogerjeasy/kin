"use client";

import { Component, type ReactNode } from "react";

type Props = { readonly fallback: ReactNode; readonly children: ReactNode };

/** Shows the fallback when the calendar's code fails to load or to draw. The error is reported, not hidden. */
export class CareCalendarBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("The care calendar could not be shown", error);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
