from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.results import InsightOut, ProfileOverview, RecommendationOut


class SnapshotOut(BaseModel):
    attempt_id: int
    label: str
    scope: str
    competency_name: str | None
    date: datetime
    overall: int
    ideas: int
    resources: int
    action: int
    level: str
    completed_resources: int
    completed_tasks: int


class CompetencyTrend(BaseModel):
    competency_id: int
    code: str
    name: str
    area_code: str
    first: int
    previous: int | None
    current: int
    change_since_previous: int | None
    change_since_first: int
    points: list[int]


class ActivityLogItem(BaseModel):
    title: str
    competency: str
    type: str
    date: datetime


class ProgressOverview(BaseModel):
    snapshots: list[SnapshotOut]
    trends: list[CompetencyTrend]
    overall_first: int | None
    overall_previous: int | None
    overall_current: int | None
    completed_resources: int
    completed_tasks: int
    reflections: int
    reassessments: int
    recent: list[ActivityLogItem]


class DashboardOut(BaseModel):
    user_name: str
    onboarding_completed: bool
    profile: ProfileOverview
    plan_progress_pct: int
    plan_done: int
    plan_total: int
    top_recommendation: RecommendationOut | None
    in_progress_attempt_id: int | None
    next_reassessment: dict | None
    insight: InsightOut | None
    unread_notifications: int


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str | None
    link: str | None
    is_read: bool
    created_at: datetime
