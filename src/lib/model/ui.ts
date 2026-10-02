import { create } from "zustand";
import type { PanelId } from "../tools";

interface UiState {
  rightTab: "props" | "forms";
  leftOpen: boolean;
  rightOpen: boolean;
  toolPanel: PanelId | null;
  exportOpen: boolean;
  signatureOpen: boolean;
  tourOpen: boolean;
  set(p: Partial<UiState>): void;
}

export const useUi = create<UiState>((set) => ({
  rightTab: "props",
  leftOpen: typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  rightOpen: typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  toolPanel: null,
  exportOpen: false,
  signatureOpen: false,
  tourOpen: false,
  set: (p) => set(p),
}));
