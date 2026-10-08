import { Outlet } from "react-router-dom";

/** Distraction-free layout for the assessment and onboarding. */
export function FocusLayout() {
  return (
    <div className="ik-focus">
      <Outlet />
    </div>
  );
}
