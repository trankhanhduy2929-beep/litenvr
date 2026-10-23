#!/usr/bin/env python3
"""Home Assistant entrypoint for the LiteNVR add-on.

Reads /data/options.json, maps the add-on options to LiteNVR environment
variables, points LiteNVR storage at a persistent location, then starts the
LiteNVR web app (uvicorn) in the foreground.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

DATA_DIR = pathlib.Path("/data")
OPTIONS_FILE = DATA_DIR / "options.json"
STORAGE_LINK = pathlib.Path("/storage")
STORAGE_TARGETS = {
    "data": DATA_DIR,
    "media": pathlib.Path("/media"),
    "share": pathlib.Path("/share"),
}
APP_DIR = "/app"
PORT = 3333


def load_options() -> dict:
    try:
        data = json.loads(OPTIONS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def link_storage(location: str) -> pathlib.Path:
    base = STORAGE_TARGETS.get(str(location or "media"), DATA_DIR)
    target = base / "litenvr"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"[LiteNVR] Không tạo được thư mục lưu trữ {target}: {exc}", flush=True)
        target = DATA_DIR / "litenvr"
        target.mkdir(parents=True, exist_ok=True)

    if STORAGE_LINK.is_symlink():
        try:
            if pathlib.Path(os.readlink(STORAGE_LINK)) == target:
                return target
        except OSError:
            pass
        STORAGE_LINK.unlink()
    elif STORAGE_LINK.is_dir():
        return STORAGE_LINK

    try:
        STORAGE_LINK.symlink_to(target)
    except OSError as exc:
        print(f"[LiteNVR] Không tạo được symlink /storage: {exc}", flush=True)
    return target


def ensure_shm() -> None:
    try:
        pathlib.Path("/dev/shm").mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


def build_env(opts: dict) -> dict:
    env = os.environ.copy()
    env["NVR_AUTH"] = "on" if opts.get("auth_enabled", True) else "off"

    username = str(opts.get("username") or "").strip()
    if username:
        env["NVR_USER"] = username
    password = str(opts.get("password") or "")
    if password:
        env["NVR_PASS"] = password

    env["NVR_IFRAME"] = "on" if opts.get("iframe", True) else "off"
    env["GO2RTC"] = str(opts.get("go2rtc") or "auto")
    env["FFMPEG_THREADS"] = str(int(opts.get("ffmpeg_threads") or 2))
    env["LIVE_MAX_HEIGHT"] = str(int(opts.get("live_max_height") or 720))

    tz = str(opts.get("timezone") or "").strip()
    if tz:
        env["TZ"] = tz
    return env


def main() -> int:
    opts = load_options()
    target = link_storage(str(opts.get("storage_location") or "media"))
    ensure_shm()
    print(f"[LiteNVR] Thư mục lưu trữ: {target}", flush=True)

    env = build_env(opts)
    level = str(opts.get("log_level") or "info")
    os.chdir(APP_DIR)
    os.execvpe(
        "uvicorn",
        ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(PORT), "--log-level", level],
        env,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
