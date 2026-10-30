"""List the models the configured AI key can use, so the model is chosen from facts rather than guessed.

    python scripts/ai_models.py            # from backend/, provider resolved from the environment (.env)
    python scripts/ai_models.py groq       # force a provider: groq, openai or gemini

Reads the key from the environment only (GROQ_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / AI_API_KEY) and sends it in a
header. The key is never printed; errors show the HTTP status only. Set GROQ_MODEL (or OPENAI_MODEL / GEMINI_MODEL)
to one of the listed ids.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main(argv: list[str]) -> int:
    from app.core.config import Settings

    s = Settings(mock_ai=False, ai_provider="mock")  # read keys without config validation for a missing model
    own = {"groq": s.groq_api_key, "openai": s.openai_api_key, "gemini": s.gemini_api_key}
    provider = argv[0] if argv else next((p for p, k in own.items() if k), "")
    if provider not in ("groq", "openai", "gemini"):
        print("no AI key in the environment (GROQ_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY)", file=sys.stderr)
        return 1
    key = s.ai_key(provider)
    if not key:
        print(f"{provider}: no key in the environment", file=sys.stderr)
        return 1
    if provider == "gemini":
        url, headers = f"{s.gemini_base_url.rstrip('/')}/models", {"x-goog-api-key": key}
    else:
        base = s.groq_base_url if provider == "groq" else s.openai_base_url
        url, headers = f"{base.rstrip('/')}/models", {"Authorization": f"Bearer {key}"}
    try:
        r = httpx.get(url, headers=headers, timeout=20)
    except httpx.HTTPError as e:
        print(f"{provider}: network error ({type(e).__name__})", file=sys.stderr)
        return 2
    if r.status_code != 200:
        print(f"{provider}: HTTP {r.status_code}", file=sys.stderr)
        return 2
    data = r.json()
    if provider == "gemini":
        ids = sorted(m["name"].removeprefix("models/") for m in data.get("models", [])
                     if "generateContent" in m.get("supportedGenerationMethods", []))
    else:
        ids = sorted(m["id"] for m in data.get("data", []) if m.get("active", True))
    print(f"{provider}: {len(ids)} models available to this key")
    for model_id in ids:
        print(" ", model_id)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
