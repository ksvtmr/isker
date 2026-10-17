/**
 * Option lists for the onboarding and profile forms. Values are sent to the API untranslated;
 * labels are translated with the current interface language — call these functions at render time.
 */
import i18n from "../i18n";

export interface Option { value: string; label: string }

/** Education values are stored as-is by the API (historical English values); only the labels are translated. */
const EDUCATION: [string, string][] = [
  ["School", "account:options.education.school"],
  ["Bachelor, 1st year", "account:options.education.bachelor1"],
  ["Bachelor, 2nd year", "account:options.education.bachelor2"],
  ["Bachelor, 3rd year", "account:options.education.bachelor3"],
  ["Bachelor, 4th year", "account:options.education.bachelor4"],
  ["Master", "account:options.education.master"],
  ["PhD", "account:options.education.phd"],
  ["Graduate", "account:options.education.graduate"],
];

const EXPERIENCE: [string, string][] = [
  ["none", "account:options.experience.none"],
  ["side_project", "account:options.experience.side_project"],
  ["startup_team", "account:options.experience.startup_team"],
  ["running_business", "account:options.experience.running_business"],
];

const FORMAT: [string, string][] = [
  ["article", "account:options.format.article"],
  ["video", "account:options.format.video"],
  ["course", "account:options.format.course"],
  ["mixed", "account:options.format.mixed"],
];

const WEEKLY: [string, string][] = [
  ["30", "account:options.weekly.30"],
  ["60", "account:options.weekly.60"],
  ["90", "account:options.weekly.90"],
  ["180", "account:options.weekly.180"],
];

const build = (list: [string, string][]): Option[] => list.map(([value, key]) => ({ value, label: i18n.t(key) }));

/** Raw values (untranslated), e.g. for validation or comparisons. */
export const EDUCATION_VALUES = EDUCATION.map(([v]) => v);
export const WEEKLY_VALUES = WEEKLY.map(([v]) => v);

export const educationOptions = (): Option[] => build(EDUCATION);

/**
 * Display text for a stored education value: the translated option label when it is one of the onboarding options,
 * otherwise the value itself (free text entered by the person is user data and is shown as written).
 */
export function educationLabel(value: string): string {
  const key = EDUCATION.find(([v]) => v === value)?.[1];
  return key ? i18n.t(key) : value;
}
export const experienceOptions = (): Option[] => build(EXPERIENCE);
export const formatOptions = (): Option[] => build(FORMAT);
export const weeklyOptions = (): Option[] => build(WEEKLY);
