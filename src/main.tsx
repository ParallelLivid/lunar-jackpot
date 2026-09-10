import "./styles.css";
import { bootstrap } from "./app/bootstrap";

void bootstrap().catch((error: unknown) => {
  // Startup failed before the dashboard could mount. Nothing has been written
  // to storage, so the existing save is untouched.
  const root = document.getElementById("root");

  if (root !== null) {
    root.textContent = `Lunar Jackpot could not start: ${String(error)}`;
  }
});
