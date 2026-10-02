import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from "react";
import { BusyOverlay, PasswordDialog, Toasts, btnPrimary } from "./components/ui";
import { useRoute } from "./lib/router";
import Home from "./pages/Home";
import { About, Contact, Privacy, Terms } from "./pages/StaticPages";
import ToolPage, { ToolsIndex } from "./pages/ToolPage";
import { clearAllData } from "./lib/pdf/persist";

const Editor = lazy(() => import("./pages/Editor"));

/** NF8/NF10: friendly crash screen. Errors are logged locally only – never with file content. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[pageflex] UI crash:", error.name, error.message, info.componentStack?.split("\n").slice(0, 4).join("\n"));
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div role="alert" className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow dark:border-red-900 dark:bg-slate-900">
          <div className="text-4xl" aria-hidden="true">😵</div>
          <h1 className="mt-2 text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The editor hit an unexpected problem. Your file was never uploaded. Reloading usually fixes it, and your last autosave can be recovered from the home page.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className={btnPrimary} onClick={() => { window.location.hash = "#/"; window.location.reload(); }}>Reload</button>
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600" onClick={async () => { await clearAllData(); window.location.hash = "#/"; window.location.reload(); }}>Clear saved data &amp; reload</button>
          </div>
          <p className="mt-3 break-words text-xs text-slate-400">{this.state.error.message}</p>
        </div>
      </div>
    );
  }
}

function Router() {
  const path = useRoute();
  if (path === "/edit") {
    return (
      <Suspense fallback={<div className="grid h-full place-items-center text-slate-500">Loading editor…</div>}>
        <Editor />
      </Suspense>
    );
  }
  if (path === "/tools") return <ToolsIndex />;
  if (path.startsWith("/tools/")) return <ToolPage slug={path.slice("/tools/".length)} key={path} />;
  if (path === "/privacy") return <Privacy />;
  if (path === "/terms") return <Terms />;
  if (path === "/about") return <About />;
  if (path === "/contact") return <Contact />;
  return <Home />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="h-full overflow-y-auto">
        <Router />
      </div>
      <BusyOverlay />
      <PasswordDialog />
      <Toasts />
    </ErrorBoundary>
  );
}
