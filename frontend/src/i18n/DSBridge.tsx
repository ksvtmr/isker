import { DSLocaleProvider, type DSStrings } from "@isker/design-system";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "./format";

/** Feeds the design system with strings from the "common:ds" namespace, re-rendering on language change. */
export function I18nDSProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation("common");
  const strings = useMemo<DSStrings>(() => {
    const obj = (key: string) => t(key, { returnObjects: true }) as Record<string, string>;
    return {
      levels: obj("levels"),
      gaps: obj("gaps"),
      gapSuffix: t("ds.gapSuffix"),
      prioritySuffix: t("ds.prioritySuffix"),
      close: t("ds.close"),
      dismiss: t("ds.dismiss"),
      loading: t("ds.loading"),
      notAssessed: t("ds.notAssessed"),
      notMeasured: t("ds.notMeasured"),
      target: (n) => t("ds.target", { n }),
      scoreAria: (name) => t("ds.scoreAria", { name }),
      outOf: (label, value, max) => t("ds.outOf", { label, value, max }),
      questionOf: (current, total) => t("ds.questionOf", { current, total }),
      aiInsight: t("ds.aiInsight"),
      confidence: (value) => t("ds.confidence", { value }),
      planSteps: obj("ds.planSteps"),
      stepStatus: obj("ds.stepStatus") as DSStrings["stepStatus"],
      recommendedFor: (competency) => t("ds.recommendedFor", { competency }),
      targetSuffix: t("ds.targetSuffix"),
      practice: t("ds.practice"),
      learn: t("ds.learn"),
      startActivity: t("ds.startActivity"),
      nav: obj("nav"),
      bottomNav: obj("bottomNav"),
      mainNavigation: t("ds.mainNavigation"),
      primaryNavigation: t("ds.primaryNavigation"),
      breadcrumb: t("ds.breadcrumb"),
      pagination: t("ds.pagination"),
      noResults: t("ds.noResults"),
      previous: t("ds.previous"),
      next: t("ds.next"),
      pageOf: (page, pages) => t("ds.pageOf", { page, pages }),
      range: (from, to, total) => t("ds.range", { from, to, total }),
      sortedBy: (column, asc) => t(asc ? "ds.sortedAsc" : "ds.sortedDesc", { column }),
      cancel: t("ds.cancel"),
      reasonLabel: t("ds.reasonLabel"),
      reasonHint: t("ds.reasonHint"),
      reasonTooShort: t("ds.reasonTooShort"),
      typeToConfirm: (text) => t("ds.typeToConfirm", { text }),
      progress: t("ds.progress"),
      skipToContent: t("ds.skipToContent"),
      admin: t("ds.admin"),
      adminNavigation: t("ds.adminNavigation"),
      administration: t("ds.administration"),
      before: t("ds.before"),
      after: t("ds.after"),
      scoreHistoryChart: t("ds.scoreHistoryChart"),
      radarChart: t("ds.radarChart"),
      charCount: (count, max) => t("ds.charCount", { count, max }),
      formatNumber: (n) => formatNumber(n),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n.language]);
  return <DSLocaleProvider strings={strings}>{children}</DSLocaleProvider>;
}
