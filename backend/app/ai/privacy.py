"""What learner text may look like before it reaches an AI provider.

Free-text answers are the learner's data, not instructions. Before they leave the server they are:
* redacted: e-mail addresses, links, phone numbers and long digit runs (IINs, card or account numbers) and the
  learner's own name are replaced by placeholders such as [email];
* cleaned: control characters removed, quote fences that could close the prompt's data block neutralised;
* truncated to a fixed length.
Prompts put such text inside a JSON data block and tell the model to ignore instructions found in it
(prompts.UNTRUSTED_DATA_RULE). This lowers, but does not remove, the risk of prompt injection: every model output is
still validated against the facts (app/ai/analysis.py), and the model never sets a score.
"""

from __future__ import annotations

import re
import unicodedata

MAX_ANSWER_CHARS = 600
MAX_QUESTION_CHARS = 300

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", re.UNICODE)
_URL = re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE)
_PHONE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)")
_LONG_NUMBER = re.compile(r"\d{7,}")
_FENCE = re.compile(r"(\"\"\"|```|'''|<\s*/?\s*(system|assistant|user|facts)\b[^>]*>)", re.IGNORECASE)


def _clean(text: str) -> str:
    text = "".join(ch if ch in "\n\t" or unicodedata.category(ch)[0] != "C" else " " for ch in text)
    return re.sub(r"[ \t]+", " ", text).strip()


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def redact(text: str | None, names: tuple[str, ...] = (), limit: int = MAX_ANSWER_CHARS) -> str:
    """The learner's free text, safe to send: personal identifiers replaced, prompt fences removed, length capped."""
    if not text:
        return ""
    out = _clean(text)
    out = _EMAIL.sub("[email]", out)
    out = _URL.sub("[link]", out)
    out = _LONG_NUMBER.sub("[number]", out)
    out = _PHONE.sub("[phone]", out)
    for name in names:
        for part in {p for p in re.split(r"\s+", name or "") if len(p) >= 3}:
            out = re.sub(rf"(?<!\w){re.escape(part)}(?!\w)", "[name]", out, flags=re.IGNORECASE)
    out = _FENCE.sub(" ", out)
    return truncate(out, limit)
