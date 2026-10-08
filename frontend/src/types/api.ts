/** Types mirroring the backend Pydantic schemas (see /api/docs). */

export type Role = "user" | "admin";
export type Level = "Foundation" | "Developing" | "Intermediate" | "Advanced" | "Proficient";
export type GapBand = "high" | "medium" | "low";
export type QuestionType = "likert" | "situational" | "open" | "practical";
export type AttemptScope = "full" | "competency";
export type AttemptStatus = "in_progress" | "completed" | "abandoned";
export type ActivityKind = "learn" | "practice" | "reflect" | "reassess";
export type ActivityStatus = "todo" | "in_progress" | "done";
export type ProgressStatus = "not_started" | "in_progress" | "completed";
export type PracticeStatus = "started" | "submitted" | "completed";
export type ResourceType = "article" | "video" | "course" | "exercise" | "case_study" | "template";
export type Difficulty = "beginner" | "intermediate" | "advanced";
export type ExperienceLevel = "none" | "side_project" | "startup_team" | "running_business";
export type LearningFormat = "article" | "video" | "course" | "mixed";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  onboarding_completed: boolean;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface Goal {
  code: string;
  title: string;
  description: string | null;
}

export interface Profile {
  full_name: string;
  email: string;
  education: string | null;
  background: string | null;
  entrepreneurial_experience: ExperienceLevel;
  business_experience: string | null;
  preferred_learning_format: LearningFormat;
  weekly_learning_minutes: number;
  language: string;
  notify_reassessment: boolean;
  notify_weekly_summary: boolean;
  goals: Goal[];
  onboarding_completed: boolean;
}

export interface Area {
  code: string;
  name: string;
  color_token: string;
}

export interface Competency {
  id: number;
  code: string;
  name: string;
  short_name: string;
  description: string;
  hint: string | null;
  importance: number;
  default_target: number;
  area: Area;
}

export interface CompetencyLevelDef {
  rank: number;
  name: Level;
  min_score: number;
  max_score: number;
  description: string;
}

export interface CompetencyCatalog {
  areas: Area[];
  competencies: Competency[];
  levels: CompetencyLevelDef[];
}

export interface CompetencyScore {
  competency_id: number;
  code: string;
  name: string;
  short_name: string;
  area_code: string;
  area_name: string;
  description: string;
  score: number | null;
  level: Level | null;
  target: number;
  gap: number | null;
  gap_band: GapBand | null;
  priority_label: string | null;
  priority_rank: number | null;
  confidence: number | null;
  explanation: string | null;
  assessed_at: string | null;
  change: number | null;
}

export interface Insight {
  headline: string;
  body: string;
  next_step: string;
  confidence: number | null;
  provider: string;
  evaluation_id: number;
  generated_at: string;
}

export interface AreaScore {
  code: string;
  name: string;
  color_token: string;
  score: number | null;
}

export interface ProfileOverview {
  has_profile: boolean;
  overall: number | null;
  level: Level | null;
  previous_overall: number | null;
  change: number | null;
  assessed_at: string | null;
  attempt_id: number | null;
  areas: AreaScore[];
  competencies: CompetencyScore[];
  strengths: CompetencyScore[];
  priority_gaps: CompetencyScore[];
  insight: Insight | null;
}

export interface CompetencyRef {
  id: number;
  code: string;
  name: string;
}

export interface AttemptSummary {
  id: number;
  scope: AttemptScope;
  competency: CompetencyRef | null;
  status: AttemptStatus;
  current_index: number;
  answered: number;
  total: number;
  sequence: number;
  overall_score: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface AssessmentOverview {
  assessment: {
    id: number;
    title: string;
    description: string;
    estimated_minutes: number;
    question_count: number;
    sections: { name: string; count: number }[];
  };
  in_progress: AttemptSummary | null;
  completed: AttemptSummary[];
}

export interface Question {
  id: number;
  index: number;
  type: QuestionType;
  section: string;
  text: string;
  help_text: string | null;
  min_length: number;
  options: { id: number; label: string }[];
}

export interface Answer {
  question_id: number;
  option_id: number | null;
  text_response: string | null;
  updated_at: string;
}

export interface AttemptState {
  attempt: AttemptSummary;
  questions: Question[];
  answers: Answer[];
}

export interface AttemptResults {
  attempt: AttemptSummary;
  profile: ProfileOverview;
  measured: CompetencyScore[];
}

export interface Gap {
  competency_id: number;
  code: string;
  name: string;
  area_name: string;
  current: number;
  target: number;
  gap: number;
  band: GapBand;
  priority_rank: number;
  priority_label: string;
  priority_score: number;
  goal_relevance: number;
  importance: number;
  learning_priority: number;
}

export interface Activity {
  id: number;
  kind: ActivityKind;
  title: string;
  status: ActivityStatus;
  locked: boolean;
  resource_id: number | null;
  task_id: number | null;
  prompt: string | null;
  response_text: string | null;
  duration_minutes: number | null;
  type: string | null;
  completed_at: string | null;
}

export interface Recommendation {
  id: number;
  priority: number;
  priority_score: number;
  status: "active" | "completed" | "superseded";
  competency_id: number;
  competency_code: string;
  competency_name: string;
  current: number;
  target: number;
  gap: number;
  band: GapBand;
  reason: string;
  goal: string | null;
  resource: { id: number; title: string; description: string; type: string; duration_minutes: number; difficulty: Difficulty } | null;
  task: { id: number; title: string; duration_minutes: number; difficulty: Difficulty } | null;
  activities: Activity[];
  progress_pct: number;
  created_at: string;
}

export interface Plan {
  recommendations: Recommendation[];
  completed: Recommendation[];
  done: number;
  total: number;
  progress_pct: number;
}

export interface Evidence {
  source: string;
  question: string;
  excerpt: string;
  tag: string;
  positive: boolean;
}

export interface RecommendedItem {
  id: number;
  kind: "resource" | "task";
  title: string;
  type: string;
  duration_minutes: number;
  difficulty: string;
  status: string | null;
}

export interface CompetencyDetail {
  competency: Competency;
  current: CompetencyScore;
  method_scores: { self: number | null; situational: number | null; open: number | null };
  explanation: string | null;
  evidence: Evidence[];
  criteria: { criterion: string; score: number }[];
  ai: {
    evaluation_id: number;
    confidence: number | null;
    provider: string;
    model: string;
    prompt_version: number | null;
    strengths: string[];
    development_areas: string[];
    explanation: string | null;
  }[];
  history: { attempt_id: number; label: string; date: string; score: number }[];
  resources: RecommendedItem[];
  tasks: RecommendedItem[];
  recommendation_id: number | null;
  reassess_question_count: number;
}

export interface Resource {
  id: number;
  slug: string;
  title: string;
  description: string;
  type: ResourceType;
  difficulty: Difficulty;
  duration_minutes: number;
  competency_id: number;
  competency_code: string;
  competency_name: string;
  status: ProgressStatus;
  progress_pct: number;
  recommended: boolean;
  started_at: string | null;
  completed_at: string | null;
}

export interface ResourceDetail extends Resource {
  content: string;
  url: string | null;
  reason: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Task {
  id: number;
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  duration_minutes: number;
  competency_id: number;
  competency_code: string;
  competency_name: string;
  status: PracticeStatus | null;
  recommended: boolean;
  feedback_score: number | null;
}

export interface Feedback {
  evaluation_id: number;
  score: number;
  level: Level;
  confidence: number | null;
  criteria: { criterion: string; rating: number; evidence: string }[];
  evidence: string[];
  strengths: string[];
  development_areas: string[];
  explanation: string | null;
  provider: string;
  created_at: string;
}

export interface TaskDetail extends Task {
  instructions: string;
  rubric: { criterion: string; description: string }[];
  min_length: number;
  response_text: string | null;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  feedback: Feedback | null;
  reason: string | null;
}

export interface Snapshot {
  attempt_id: number;
  label: string;
  scope: AttemptScope;
  competency_name: string | null;
  date: string;
  overall: number;
  ideas: number;
  resources: number;
  action: number;
  level: Level;
  completed_resources: number;
  completed_tasks: number;
}

export interface CompetencyTrend {
  competency_id: number;
  code: string;
  name: string;
  area_code: string;
  first: number;
  previous: number | null;
  current: number;
  change_since_previous: number | null;
  change_since_first: number;
  points: number[];
}

export interface ProgressOverview {
  snapshots: Snapshot[];
  trends: CompetencyTrend[];
  overall_first: number | null;
  overall_previous: number | null;
  overall_current: number | null;
  completed_resources: number;
  completed_tasks: number;
  reflections: number;
  reassessments: number;
  recent: { title: string; competency: string; type: string; date: string }[];
}

export interface Dashboard {
  user_name: string;
  onboarding_completed: boolean;
  profile: ProfileOverview;
  plan_progress_pct: number;
  plan_done: number;
  plan_total: number;
  top_recommendation: Recommendation | null;
  in_progress_attempt_id: number | null;
  next_reassessment: { ready: boolean; days: number; competency_id: number | null; competency_name: string | null } | null;
  insight: Insight | null;
  unread_notifications: number;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
