#!/usr/bin/env python3
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
PUBLIC_URL_FILE = Path.home() / ".local/state/litenvr-license/public-url"
PORTAL_SERVICE = "litenvr-portal.service"
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def load_env():
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key] = value.strip()
    return values


def update_env(updates):
    lines = ENV_FILE.read_text().splitlines()
    seen = set()
    output = []
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0]
            if key in updates:
                output.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        output.append(line)
    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={value}")
    fd, temp = tempfile.mkstemp(dir=ENV_FILE.parent, prefix=".env.", text=True)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write("\n".join(output) + "\n")
        os.chmod(temp, 0o600)
        os.replace(temp, ENV_FILE)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def wait_for_health():
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:3000/api/health", timeout=2) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def confirm_webhook(public_url, env):
    payload = json.dumps({"webhookUrl": f"{public_url}/api/payment/payos"}).encode()
    request = urllib.request.Request(
        "https://api-merchant.payos.vn/confirm-webhook",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-client-id": env["PAYOS_CLIENT_ID"],
            "x-api-key": env["PAYOS_API_KEY"],
            "User-Agent": "LiteNVR-License/1.0",
        },
    )
    for attempt in range(10):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = json.loads(response.read())
                if body.get("code") == "00":
                    return True
                print(f"confirm-webhook lỗi: {body.get('desc')}", file=sys.stderr)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
                print(f"confirm-webhook HTTP {error.code}: {body.get('desc') or body.get('data')}", file=sys.stderr)
            except Exception:
                print(f"confirm-webhook HTTP {error.code}", file=sys.stderr)
        except Exception as error:
            print(f"confirm-webhook lỗi kết nối: {error}", file=sys.stderr)
        time.sleep(3)
    return False


def apply_url(public_url):
    env = load_env()
    updates = {
        "PAYOS_RETURN_URL": f"{public_url}/success",
        "PAYOS_CANCEL_URL": f"{public_url}/?canceled=1",
    }
    changed = any(env.get(key) != value for key, value in updates.items())
    if changed:
        update_env(updates)
        subprocess.run(["systemctl", "--user", "restart", PORTAL_SERVICE], check=False)
    if not wait_for_health():
        print("Portal chưa sẵn sàng sau khi đổi URL", file=sys.stderr)
        return False
    PUBLIC_URL_FILE.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_URL_FILE.write_text(f"{public_url}\n")
    ok = confirm_webhook(public_url, env)
    print(f"{public_url} -> {'OK' if ok else 'CHƯA XÁC THỰC'}", flush=True)
    return ok


def main():
    process = subprocess.Popen(
        ["/usr/local/bin/cloudflared", "tunnel", "--url", "http://127.0.0.1:3000", "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    def stop(signum, _frame):
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    for line in process.stdout:
        match = URL_RE.search(line)
        if match:
            apply_url(match.group(0))
            break
    else:
        return process.wait()

    for _line in process.stdout:
        pass
    return process.wait()


if __name__ == "__main__":
    sys.exit(main())
