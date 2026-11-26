import React from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ExamSeat UI ErrorBoundary] Caught runtime exception:', error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  handleRetry() {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }));
    if (typeof this.props.onReset === 'function') {
      this.props.onReset();
    }
  }

  render() {
    if (this.state.hasError) {
      const message =
        this.state.error?.message || 'An unexpected rendering error occurred while loading this page.';

      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6 bg-[#F5F7FA]">
          <div className="max-w-lg w-full bg-white border border-red-200 rounded-2xl shadow-lg p-6 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-600 flex-shrink-0">
                <AlertTriangle size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-navy-800">
                  {this.props.title || 'Page Rendering Error'}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  ExamSeat AI prevented a blank screen because an unexpected runtime error occurred.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-mono text-red-800 break-words">
              {message}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <a
                href="/admin/dashboard"
                className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                <Home size={14} className="mr-1.5" />
                Back to Dashboard
              </a>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-semibold text-navy-800 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Reload Page
              </button>
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover shadow-xs transition-colors cursor-pointer"
              >
                <RotateCcw size={14} className="mr-1.5" />
                Retry Render
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryCount}>{this.props.children}</React.Fragment>;
  }
}

export default ErrorBoundary;
