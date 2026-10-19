import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import { App } from "./App";
import { applyAppearance } from "./lib/appearance";

applyAppearance();
createRoot(document.getElementById("root")!).render(<App />);

// Offline support for hosted builds. Skipped in dev and in the single-file demo.
if (!__MIKI_DEV__ && !__MIKI_SINGLE__ && "serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline support is optional */
    });
  });
}
