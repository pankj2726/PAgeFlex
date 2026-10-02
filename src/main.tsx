import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { useEditor } from "./lib/model/docState";

// Test hook for Playwright (tests/e2e/*): only exposed when the page is opened with ?e2e=1. Exposes the store, no file data.
if (/[?&]e2e=1/.test(window.location.search)) (window as unknown as { __qf: unknown }).__qf = { useEditor };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
