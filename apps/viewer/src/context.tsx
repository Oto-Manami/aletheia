import { createContext, useContext } from "react";
import type { ArchiveSource, Viewer } from "./source/types.ts";

export interface AppContext {
  source: ArchiveSource;
  viewer: Viewer;
  signOut?: () => Promise<void>;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AppContext がありません");
  return ctx;
}
