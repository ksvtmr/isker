import { Outlet } from "react-router-dom";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

/** Distraction-free layout for the assessment and onboarding. */
export function FocusLayout() {
  return (
    <div className="ik-focus">
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 16px 0" }}>
        <LanguageSwitcher />
      </div>
      <Outlet />
    </div>
  );
}
