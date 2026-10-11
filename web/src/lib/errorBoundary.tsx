import { Component, type ErrorInfo, type ReactNode } from 'react';

/** مرز خطای رندر — بدون آن یک throw در یک صفحه، کل اپ را سفید می‌کند.
 *  مرجع: react.dev/reference/react/Component#catching-rendering-errors */
interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui-error]', error.message, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="state" role="alert">
          <div className="state-icon error" aria-hidden="true">!</div>
          <div className="state-title">این صفحه با خطا مواجه شد</div>
          <p className="state-text">{this.state.error.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
            بارگذاری دوباره
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
