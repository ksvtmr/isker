import { ButtonLink, type ButtonLinkProps } from "@isker/design-system";
import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

/** Returns an onClick that performs client-side navigation (keeps cmd/ctrl-click opening a new tab). */
export function useSpaClick() {
  const navigate = useNavigate();
  return (to: string) => (e: MouseEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}

/** Design-system ButtonLink with router navigation. */
export function LinkButton({ to, ...props }: Omit<ButtonLinkProps, "href"> & { to: string }) {
  const spa = useSpaClick();
  return <ButtonLink href={to} onClick={spa(to)} {...props} />;
}
