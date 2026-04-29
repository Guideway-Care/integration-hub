import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Render error caught by boundary:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
          <div className="max-w-lg w-full border border-destructive/30 bg-destructive/5 rounded-md p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-base">Dashboard error</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Something went wrong while rendering. The error is shown below.
                </p>
                <pre className="mt-3 text-xs font-mono bg-muted p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap break-words">
                  {this.state.error?.message || String(this.state.error)}
                  {this.state.error?.stack ? "\n\n" + this.state.error.stack : ""}
                </pre>
                <button
                  onClick={this.handleReset}
                  className="mt-4 inline-flex items-center px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:opacity-90"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
