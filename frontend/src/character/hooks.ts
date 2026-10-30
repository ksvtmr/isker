import { useCallback, useEffect, useRef, useState } from "react";
import { REACTION_MS, type CharacterState } from "./config";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The system "reduce motion" setting, kept up to date (listener removed on unmount). */
export function usePrefersReducedMotion(): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * The character's state for a screen: `base` (from the context), temporarily replaced by a short reaction after a
 * confirmed action (`react("happy")`). One reaction at a time: a new one replaces the running one; the timer is
 * cleared on unmount.
 */
export function useCharacterReaction(base: CharacterState): [CharacterState, (s: CharacterState) => void] {
  const [reaction, setReaction] = useState<CharacterState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const react = useCallback((s: CharacterState) => {
    clearTimeout(timer.current);
    setReaction(s);
    timer.current = setTimeout(() => setReaction(null), REACTION_MS[s] ?? 1600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [reaction ?? base, react];
}
