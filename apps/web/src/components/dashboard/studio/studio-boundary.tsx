"use client";

import { Component, type ReactNode } from "react";

type Props = { readonly fallback: ReactNode; readonly children: ReactNode };

/** If AG Studio fails to render, the page shows Kin's summary of the same record instead of a broken screen. */
export class StudioBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
