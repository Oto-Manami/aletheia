import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoRoot, LiveRoot } from "./root.tsx";
import "./styles.css";
import { applyTheme, loadTheme } from "./theme.ts";

applyTheme(loadTheme());

const container = document.getElementById("root");
if (!container) throw new Error("#root がありません");

// mode = demo（npm run dev:demo / build:demo）のときは、架空のデータで動かす
const demo = import.meta.env.MODE === "demo";

createRoot(container).render(<StrictMode>{demo ? <DemoRoot /> : <LiveRoot />}</StrictMode>);
