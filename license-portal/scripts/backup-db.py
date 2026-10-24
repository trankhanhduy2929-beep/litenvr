#!/usr/bin/env python3
import gzip
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
BACKUP_DIR = Path.home() / ".local/share/litenvr-license/backups"
MARIADB = Path("/var/tmp/litenvr-mariadb/root")


def load_env():
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key] = value.strip()
    return values


def main():
    env = load_env()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"litenvr-{time.strftime('%Y%m%d-%H%M%S')}.sql.gz"
    result = subprocess.run(
        [
            str(MARIADB / "usr/bin/mariadb-dump"),
            "--no-defaults",
            "--protocol=tcp",
            f"-h{env['DB_HOST']}",
            f"-P{env['DB_PORT']}",
            f"-u{env['DB_USER']}",
            "--single-transaction",
            "--no-tablespaces",
            env["DB_NAME"],
        ],
        env={
            **os.environ,
            "MYSQL_PWD": env["DB_PASSWORD"],
            "LD_LIBRARY_PATH": f"{MARIADB}/usr/lib/x86_64-linux-gnu:{MARIADB}/lib/x86_64-linux-gnu",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.decode("utf-8", "replace").strip())
    with gzip.open(target, "wb") as handle:
        handle.write(result.stdout)
    cutoff = time.time() - 14 * 86400
    for old in BACKUP_DIR.glob("litenvr-*.sql.gz"):
        if old.stat().st_mtime < cutoff:
            old.unlink()
    print(target)


if __name__ == "__main__":
    main()
