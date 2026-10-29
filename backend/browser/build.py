"""Builds the in-browser API for the standalone (GitHub Pages) interface.

    python backend/browser/build.py frontend/dist/pyodide            # downloads Pyodide once into .cache/
    python backend/browser/build.py frontend/dist/pyodide --pyodide-dir /path/to/extracted/pyodide

Writes into the output directory:
- the Pyodide runtime and only the Pyodide packages the API needs (from the official release, self-hosted: the
  site works without any CDN);
- wheels/: the pure-Python packages from requirements.txt (PyPI);
- isker-backend-<hash>.zip: backend/app + isker_browser.py;
- manifest.json: what the browser loads (read by frontend/src/standalone/worker.ts).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

PYODIDE_VERSION = "314.0.7"
RELEASE = f"https://github.com/pyodide/pyodide/releases/download/{PYODIDE_VERSION}/pyodide-{PYODIDE_VERSION}.tar.bz2"
# Imported by the API (directly or through its dependencies); the rest of their dependencies follow from the lock.
PACKAGES = ["sqlalchemy", "pydantic", "fastapi", "bcrypt", "cryptography", "micropip", "dnspython", "idna"]
CORE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
CACHE = BACKEND.parent / ".cache" / f"pyodide-{PYODIDE_VERSION}"


def pyodide_dir(given: str | None) -> Path:
    if given:
        return Path(given)
    if not (CACHE / "pyodide" / "pyodide-lock.json").exists():
        print(f"Downloading Pyodide {PYODIDE_VERSION} (about 340 MB, once)…", flush=True)
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(RELEASE) as r, tarfile.open(fileobj=r, mode="r|bz2") as tar:
            tar.extractall(CACHE, filter="data")
    return CACHE / "pyodide"


def closure(lock: dict, names: list[str]) -> list[str]:
    seen: set[str] = set()
    todo = [n.lower().replace("_", "-") for n in names]
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        todo += [d.lower().replace("_", "-") for d in lock[name]["depends"]]
    return sorted(seen)


def backend_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted((BACKEND / "app").rglob("*.py")):
            z.write(path, path.relative_to(BACKEND).as_posix())
        z.write(HERE / "isker_browser.py", "isker_browser.py")
    return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--pyodide-dir")
    args = ap.parse_args()
    src = pyodide_dir(args.pyodide_dir)
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "wheels").mkdir(parents=True)

    for name in CORE:
        shutil.copy2(src / name, out / name)
    lock = json.loads((src / "pyodide-lock.json").read_text())["packages"]
    packages = closure(lock, PACKAGES)
    for name in packages:
        shutil.copy2(src / lock[name]["file_name"], out / lock[name]["file_name"])

    pip = [sys.executable, "-m", "pip", "download", "--quiet", "--no-deps", "--only-binary=:all:",
           "-r", str(HERE / "requirements.txt"), "-d", str(out / "wheels")]
    subprocess.run(pip, check=True)  # noqa: S603 - fixed arguments, no user input
    wheels = sorted(p.name for p in (out / "wheels").glob("*.whl"))

    data = backend_zip()
    backend = f"isker-backend-{hashlib.sha256(data).hexdigest()[:12]}.zip"
    (out / backend).write_bytes(data)
    (out / "manifest.json").write_text(json.dumps(
        {"pyodide": PYODIDE_VERSION, "packages": packages, "wheels": wheels, "backend": backend}, indent=2))
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"In-browser API: {len(packages)} Pyodide packages, {len(wheels)} wheels, {size / 1e6:.1f} MB → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
