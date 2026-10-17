"""Draft → Published → Archived lifecycle shared by editable content (competencies, questions, resources, tasks).

`status` is the source of truth. Older tables also carry a boolean (`is_published` on resources/tasks, `is_active` on
questions) that existing clients still read and send; it is kept equal to `status == published` in exactly one place,
the mapper hooks below:

* a row inserted without a status gets one from the boolean (True/unset → published, False → draft);
* changing `status` rewrites the boolean;
* changing only the boolean (an older client) publishes the row, or moves a published row back to draft.

Only published rows are shown on the learner platform. Archived rows are hidden from everything new but are never
deleted while history (answers, progress, submissions, scores) refers to them.
"""

from __future__ import annotations

from typing import Any, ClassVar

from sqlalchemy import event, inspect
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from app.models.enums import ContentStatus, db_enum


class Publishable:
    # Name of the legacy boolean mirroring `status == published`, or None.
    __status_flag__: ClassVar[str | None] = None

    @declared_attr
    def status(cls) -> Mapped[ContentStatus]:  # noqa: N805
        return mapped_column(
            db_enum(ContentStatus, "content_status"),
            nullable=False,
            server_default=ContentStatus.PUBLISHED.value,
            index=True,
        )

    @property
    def is_live(self) -> bool:
        return self.status == ContentStatus.PUBLISHED

    def set_status(self, status: ContentStatus) -> None:
        self.status = status
        if self.__status_flag__:
            setattr(self, self.__status_flag__, status == ContentStatus.PUBLISHED)


@event.listens_for(Publishable, "before_insert", propagate=True)
def _before_insert(_mapper: Any, _conn: Any, target: Publishable) -> None:
    flag = target.__status_flag__
    if target.status is None:
        legacy = getattr(target, flag) if flag else None
        target.status = ContentStatus.DRAFT if legacy is False else ContentStatus.PUBLISHED
    if flag:
        setattr(target, flag, target.status == ContentStatus.PUBLISHED)


@event.listens_for(Publishable, "before_update", propagate=True)
def _before_update(_mapper: Any, _conn: Any, target: Publishable) -> None:
    flag = target.__status_flag__
    if not flag:
        return
    state = inspect(target)
    assert state is not None
    attrs = state.attrs
    if attrs.status.history.has_changes():
        setattr(target, flag, target.status == ContentStatus.PUBLISHED)
    elif attrs[flag].history.has_changes():
        if getattr(target, flag):
            target.status = ContentStatus.PUBLISHED
        elif target.status == ContentStatus.PUBLISHED:
            target.status = ContentStatus.DRAFT
