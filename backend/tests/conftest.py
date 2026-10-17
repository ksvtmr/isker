from __future__ import annotations

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="isker-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["ENVIRONMENT"] = "test"
os.environ["MOCK_AI"] = "true"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.context import language_var  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.main import app  # noqa: E402
from app.seed.run import seed_reference  # noqa: E402

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class BrowserClient(TestClient):
    """Behaves like the SPA: echoes the readable CSRF cookie in X-CSRF-Token on unsafe requests."""

    def request(self, method, url, *args, **kwargs):  # type: ignore[override]
        token = self.cookies.get("isker_csrf")
        if method.upper() in UNSAFE and token:
            headers = dict(kwargs.pop("headers", None) or {})
            headers.setdefault("X-CSRF-Token", token)
            kwargs["headers"] = headers
        return super().request(method, url, *args, **kwargs)


# Most assertions read English text; localization tests ask for ru/kk explicitly.
EN = {"Accept-Language": "en"}


@pytest.fixture(autouse=True)
def _english():
    token = language_var.set("en")
    yield
    language_var.reset(token)


@pytest.fixture(autouse=True)
def _schema():
    limiter.reset()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    seed_reference(db)
    db.commit()
    db.close()
    yield


@pytest.fixture
def db() -> Session:
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def client() -> TestClient:
    return BrowserClient(app, headers=EN)


@pytest.fixture
def raw_client() -> TestClient:
    """A client that does NOT send the CSRF header (simulates a cross-site request)."""
    return TestClient(app, headers=EN)


def register(
    client: TestClient, email: str = "learner@example.com", password: str = "Secret123", name: str = "Dana Learner"
) -> dict:
    r = client.post(
        "/api/auth/register", json={"email": email, "password": password, "full_name": name, "accept_terms": True}
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_user(db: Session, email: str, roles: tuple[str, ...] = ("user",), password: str = "Secret123", **kw):
    """Create an account directly with the given roles (staff accounts can't self-register)."""
    from app.core.security import hash_password
    from app.models import User, UserProfile
    from app.services.permissions import give_role

    u = User(email=email, password_hash=hash_password(password), full_name=kw.pop("full_name", email.split("@")[0]),
             onboarding_completed=True, **kw)
    u.profile = UserProfile()
    db.add(u)
    db.flush()
    for r in roles:
        give_role(db, u, r)
    db.commit()
    db.refresh(u)
    return u


def login(client: TestClient, email: str, password: str = "Secret123") -> dict:
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def onboard(client: TestClient, goals: list[str] | None = None) -> dict:
    r = client.post(
        "/api/profile/onboarding",
        json={
            "full_name": "Dana Learner",
            "education": "Bachelor, 2nd year",
            "background": "CS student",
            "entrepreneurial_experience": "side_project",
            "business_experience": "Small online shop",
            "goal_codes": goals or ["launch-startup"],
            "preferred_learning_format": "article",
            "weekly_learning_minutes": 60,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


OPEN_ANSWER = (
    "First I would list the assumptions behind the idea and test the riskiest one. I would interview ten "
    "customers about the problem, run a free landing page as a cheap prototype, measure sign-ups and learn "
    "from the result to adjust the next step. We kept going after a failed test and I realised my strength is "
    "preparing evidence. Students struggle with this problem; the solution is a new service where customers pay "
    "a small fee per order, so revenue covers the cost."
)


def answer_all(client: TestClient, attempt_id: int, choice_index: int = 1, text: str = OPEN_ANSWER) -> dict:
    state = client.get(f"/api/assessments/attempts/{attempt_id}").json()
    for q in state["questions"]:
        if q["options"]:
            body = {"option_id": q["options"][min(choice_index, len(q["options"]) - 1)]["id"], "position": q["index"]}
        else:
            body = {"text_response": text, "position": q["index"]}
        r = client.put(f"/api/assessments/attempts/{attempt_id}/answers/{q['id']}", json=body)
        assert r.status_code == 200, r.text
    return state
