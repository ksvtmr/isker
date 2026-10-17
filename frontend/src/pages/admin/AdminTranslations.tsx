import { Badge, Card, Checkbox, DataTable, EmptyState, Pagination, Select, type BadgeTone, type DataColumn } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  TRANSLATION_ENTITIES, TRANSLATION_STATES, useTranslationStatus,
  type TranslationEntity, type TranslationLang, type TranslationState, type TranslationStatusItem,
} from "../../api/admin";
import { ErrorState, PageSkeleton } from "../../components/States";
import { formatNumber } from "../../utils/format";
import { AdminPageHeader, Muted } from "./common";
import { LANGS } from "./contentSync";

const TONE: Record<TranslationState, BadgeTone> = { complete: "success", partial: "warning", missing: "error", stale: "info" };
const PAGE_SIZE = 25;

/** Where each entity is edited. Areas, goals, levels and answer options have no editor in the admin area yet. */
export const TRANSLATION_EDITORS: Partial<Record<TranslationEntity, string>> = {
  competency: "/admin/competencies",
  question: "/admin/assessments?tab=questions",
  assessment: "/admin/assessments",
  resource: "/admin/learning-resources",
  task: "/admin/learning-resources",
  plan: "/admin/plans",
};

const isEntity = (v: string | null): v is TranslationEntity => !!v && (TRANSLATION_ENTITIES as string[]).includes(v);
const isLang = (v: string | null): v is TranslationLang => v === "ru" || v === "kk";

/**
 * Translation completeness of all localizable content (ru/kk; English is the base text): summary per entity and
 * language, filters, and a list of records that need work with a link to their editor.
 */
export function AdminTranslations() {
  const { t } = useTranslation("adminContent");
  const [params, setParams] = useSearchParams();
  const entity = isEntity(params.get("entity")) ? (params.get("entity") as TranslationEntity) : "";
  const language = isLang(params.get("language")) ? (params.get("language") as TranslationLang) : "";
  const statuses = (params.get("status") ?? "missing,partial,stale").split(",").filter((s): s is TranslationState => (TRANSLATION_STATES as string[]).includes(s));
  const page = Number(params.get("page") ?? 1) || 1;
  const q = useTranslationStatus({ entity, language, status: statuses, page, page_size: PAGE_SIZE });
  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === "") next.delete(k); else next.set(k, v); }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  };
  const entityLabel = (e: TranslationEntity) => t(`translations.entities.${e}`);
  const stateLabel = (s: TranslationState) => t(`translations.states.${s}`);
  const header = <AdminPageHeader crumbs={[{ label: t("translations.title") }]} title={t("translations.title")} subtitle={t("translations.subtitle")} />;

  if (q.isLoading) return <>{header}<PageSkeleton cards={3} chart={false} /></>;
  if (q.error) return <>{header}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  if (q.data === null || !q.data) {
    return <>{header}<EmptyState icon="languages" title={t("translations.unavailableTitle")} description={t("translations.unavailableText")} /></>;
  }
  const data = q.data;
  const summaryEntities = TRANSLATION_ENTITIES.filter((e) => data.summary[e]);

  const columns: DataColumn<TranslationStatusItem>[] = [
    { key: "item", header: t("translations.columns.item"), render: (it) => (
      <span><span style={{ display: "block", fontWeight: 500 }}>{it.label}</span><Muted>{entityLabel(it.entity)} · {t("common:format.id", { id: it.id })}</Muted></span>
    ) },
    ...LANGS.map((lang): DataColumn<TranslationStatusItem> => ({
      key: lang, header: t(`sync.translations.${lang}`), render: (it) => {
        const st = it.status[lang];
        if (!st) return t("common:state.none");
        const fields = [...(it.missing[lang] ?? []), ...(it.stale[lang] ?? [])];
        return (
          <span>
            <Badge tone={TONE[st]}>{stateLabel(st)}</Badge>
            {fields.length > 0 && <span style={{ display: "block", marginTop: 4 }}><Muted>{t("translations.badge.fields", { list: fields.join(", ") })}</Muted></span>}
          </span>
        );
      },
    })),
    { key: "editor", header: <span className="isk-sr-only">{t("content.actions")}</span>, render: (it) => {
      const to = TRANSLATION_EDITORS[it.entity];
      return to
        ? <Link to={to} className="ik-link">{t("translations.openEditor")}<span className="isk-sr-only">: {it.label}</span></Link>
        : <Muted>{t("translations.noEditor")}</Muted>;
    } },
  ];

  return (
    <>
      {header}
      <section aria-labelledby="tr-summary" style={{ marginBottom: 24 }}>
        <h2 id="tr-summary" className="isk-sr-only">{t("translations.summaryTitle")}</h2>
        {summaryEntities.length === 0 ? <Muted>{t("translations.summaryEmpty")}</Muted> : (
          <div className="ik-grid3">
            {summaryEntities.map((e) => (
              <Card key={e} padding={20}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>{entityLabel(e)}</h3>
                <dl className="ik-kv" style={{ marginTop: 10, fontSize: 13 }}>
                  {LANGS.map((lang) => {
                    const c = data.summary[e]?.[lang] ?? {};
                    return [
                      <dt key={`${lang}-dt`}>{t(`sync.translations.${lang}`)}</dt>,
                      <dd key={`${lang}-dd`} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {TRANSLATION_STATES.filter((s) => (c[s] ?? 0) > 0).map((s) => (
                          <Badge key={s} tone={TONE[s]}>{t("translations.countState", { state: stateLabel(s), n: formatNumber(c[s] ?? 0) })}</Badge>
                        ))}
                        {TRANSLATION_STATES.every((s) => !(c[s] ?? 0)) && <Muted>{t("common:state.none")}</Muted>}
                      </dd>,
                    ];
                  })}
                </dl>
              </Card>
            ))}
          </div>
        )}
      </section>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-filters" style={{ padding: 16 }} role="group" aria-label={t("translations.filtersLabel")}>
          <Select label={t("translations.filters.entity")} value={entity} onChange={(e) => update({ entity: e.target.value })}
            options={[{ value: "", label: t("translations.filters.allEntities") }, ...TRANSLATION_ENTITIES.map((e) => ({ value: e, label: entityLabel(e) }))]} />
          <Select label={t("translations.filters.language")} value={language} onChange={(e) => update({ language: e.target.value })}
            options={[{ value: "", label: t("translations.filters.allLanguages") }, ...LANGS.map((l) => ({ value: l, label: t(`sync.translations.${l}`) }))]} />
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <legend className="isk-label">{t("translations.filters.status")}</legend>
            {TRANSLATION_STATES.map((s) => (
              <Checkbox key={s} label={stateLabel(s)} checked={statuses.includes(s)}
                onChange={(e) => update({ status: (e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s)).join(",") || "none" })} />
            ))}
          </fieldset>
        </div>
        <DataTable caption={t("translations.caption")} columns={columns} rows={data.items} rowKey={(it) => `${it.entity}-${it.id}`} loading={q.isFetching}
          empty={<EmptyState icon="languages" title={t("translations.emptyTitle")} description={t("translations.emptyText")} />} />
        <Pagination page={data.page} pageSize={data.page_size} total={data.total} onChange={(p) => update({ page: String(p) }, false)} label={t("translations.pagesLabel")} />
      </Card>
    </>
  );
}
