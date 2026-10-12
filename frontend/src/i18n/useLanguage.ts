import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { keys } from "../api/keys";
import type { User } from "../types/api";
import { LANGUAGES, LANGUAGE_NAMES, toLanguage, type Language } from "./config";
import { currentLanguage } from "./index";

/** Language picker state. Signed-in users also get the choice saved to their account (all devices). */
export function useLanguage() {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (language: Language) => api.put<User>("/api/auth/me/language", { language }),
    onSuccess: (user) => qc.setQueryData(keys.me, user),
  });
  const setLanguage = useCallback(
    (lng: Language) => {
      // Interface updates immediately; the route and its query string are untouched.
      void i18n.changeLanguage(lng);
      const me = qc.getQueryData<User | null>(keys.me);
      if (me) save.mutate(lng);
      // Content (questions, competencies…) is localized by the API per Accept-Language: refetch it.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
    [i18n, qc, save],
  );
  return {
    language: currentLanguage(),
    setLanguage,
    saveError: save.error,
    options: LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
  };
}

/**
 * Applies the signed-in user's saved language (priority 1). If the account has no saved choice yet, the language
 * currently in use (chosen in this browser, or detected) is stored — the account's explicit choice is never
 * overwritten by the browser.
 */
export function useLanguageSync(user: User | null | undefined) {
  const { i18n } = useTranslation();
  const synced = useRef<number | null>(null);
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) {
      synced.current = null;
      return;
    }
    const saved = toLanguage(user.language);
    if (saved) {
      if (saved !== currentLanguage()) {
        void i18n.changeLanguage(saved);
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      }
      synced.current = user.id;
      return;
    }
    if (synced.current === user.id) return;
    synced.current = user.id;
    api.put<User>("/api/auth/me/language", { language: currentLanguage() })
      .then((u) => qc.setQueryData(keys.me, u))
      .catch(() => { /* keeps working locally; retried on next sign-in */ });
  }, [user, i18n, qc]);
}
