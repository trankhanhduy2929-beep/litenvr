import base64
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
SRC = os.path.join(APP_DIR, "main.py")


def load_app(env=None):
    os.environ["GO2RTC"] = "off"
    os.environ["NVR_AUTH"] = "on"
    os.environ["NVR_USER"] = "user1"
    os.environ["NVR_PASS"] = "pass1"
    if env:
        os.environ.update(env)
    sandbox = tempfile.mkdtemp(prefix="litenvr_test_")
    shm = os.path.join(sandbox, "shm")
    os.makedirs(shm, exist_ok=True)
    with open(SRC, encoding="utf-8") as f:
        src = f.read()
    src = src.replace('STORAGE_DIR = "/storage"', f'STORAGE_DIR = {sandbox!r}')
    src = src.replace('HLS_DIR = "/dev/shm/hls"', f'HLS_DIR = {os.path.join(shm, "hls")!r}')
    src = src.replace('BUFFER_DIR = "/dev/shm/buffer"', f'BUFFER_DIR = {os.path.join(shm, "buffer")!r}')
    mod_path = os.path.join(sandbox, "main.py")
    with open(mod_path, "w", encoding="utf-8") as f:
        f.write(src)
    static_src = os.path.join(APP_DIR, "static")
    if os.path.isdir(static_src):
        shutil.copytree(static_src, os.path.join(sandbox, "static"))
    cwd = os.getcwd()
    os.chdir(APP_DIR)
    try:
        spec = importlib.util.spec_from_file_location("litenvr_test_main", mod_path)
        m = importlib.util.module_from_spec(spec)
        sys.modules["litenvr_test_main"] = m
        spec.loader.exec_module(m)
    finally:
        os.chdir(cwd)
    return sandbox, m


def auth(u="user1", p="pass1"):
    tok = base64.b64encode(f"{u}:{p}".encode()).decode()
    return {"Authorization": f"Basic {tok}"}


class _AppCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sandbox, cls.m = load_app()
        from fastapi.testclient import TestClient
        cls.client = TestClient(cls.m.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)


class ApiTests(_AppCase):
    def test_health_and_auth(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get("/api/system").status_code, 401)
        self.assertEqual(self.client.get("/api/system", headers=auth("user1", "wrong")).status_code, 401)
        self.assertEqual(self.client.get("/api/system", headers=auth()).status_code, 200)
        self.assertEqual(self.client.get("/").status_code, 401)

    def test_camera_lifecycle(self):
        payload = {"cam_id": "cam1", "name": "Cam", "brand": "custom",
                   "rtsp_url": "rtsp://127.0.0.1:1/x", "record_mode": "continuous"}
        self.assertEqual(self.client.post("/api/cameras", json=payload, headers=auth()).status_code, 200)
        self.assertIn("cam1", self.client.get("/api/cameras", headers=auth()).json())
        self.assertEqual(self.client.delete("/api/cameras/cam1", headers=auth()).status_code, 200)
        self.assertEqual(self.client.get("/api/cameras", headers=auth()).json(), {})

    def test_storage_motion_timeline(self):
        payload = {"cam_id": "cam1", "name": "Cam", "rtsp_url": "rtsp://127.0.0.1:1/x",
                   "record_mode": "motion", "video_codec": "h264"}
        self.client.post("/api/cameras", json=payload, headers=auth())
        r = self.client.post("/api/storage", json={"retention_days": 3, "max_storage_gb": 1,
                                                   "max_disk_percent": 90, "post_motion_sec": 30},
                             headers=auth())
        self.assertEqual(r.status_code, 200)
        r = self.client.post("/api/motion", json={"cam_id": "cam1", "label": "test"}, headers=auth())
        self.assertEqual(r.json()["pre_roll_sec"], 10)
        d = time.strftime("%Y-%m-%d")
        r = self.client.get(f"/api/timeline/cam1?date={d}", headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertIn("segments", r.json())

    def test_motion_preroll_promotes_completed_buffer(self):
        cam = "preroll-test"
        bdir = os.path.join(self.m.buffer_root(), cam)
        rdir = os.path.join(self.m.RECORDINGS_DIR, cam)
        os.makedirs(bdir, exist_ok=True)
        now = time.time()
        paths = {}
        for offset, key in ((-30, "old"), (-15, "recent"), (0, "active")):
            t = datetime.fromtimestamp(now + offset)
            name = t.strftime("%Y-%m-%d_%H-%M-%S") + ".mp4"
            path = os.path.join(bdir, name)
            with open(path, "wb") as f:
                f.write(b"x")
            os.utime(path, (now + offset, now + offset))
            paths[key] = path

        moved = self.m.promote_motion_buffer(cam, now - self.m.MOTION_PREROLL_SEC)
        self.assertEqual(moved, 1)
        self.assertTrue(os.path.isfile(os.path.join(rdir, os.path.basename(paths["recent"]))))
        self.assertTrue(os.path.isfile(paths["active"]))
        self.assertTrue(os.path.isfile(paths["old"]))

        self.m.promote_motion_buffer(cam)
        self.assertTrue(os.path.isfile(os.path.join(rdir, os.path.basename(paths["old"]))))
        self.assertTrue(os.path.isfile(paths["active"]))
        shutil.rmtree(bdir, ignore_errors=True)
        shutil.rmtree(rdir, ignore_errors=True)

    def test_play_missing_and_status(self):
        payload = {"cam_id": "cam1", "name": "Cam", "rtsp_url": "rtsp://127.0.0.1:1/x",
                   "record_mode": "off"}
        self.client.post("/api/cameras", json=payload, headers=auth())
        r = self.client.get("/api/status/cam1", headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertIn("running", r.json())
        self.assertEqual(self.client.get("/api/play/cam1/nope.mp4", headers=auth()).status_code, 404)

    def test_recording_days_and_camera_test_api(self):
        payload = {"cam_id": "calcam", "name": "Cal", "rtsp_url": "rtsp://127.0.0.1:1/x",
                   "record_mode": "off"}
        self.assertEqual(self.client.post("/api/cameras", json=payload, headers=auth()).status_code, 200)
        cam_dir = os.path.join(self.m.RECORDINGS_DIR, "calcam")
        os.makedirs(cam_dir, exist_ok=True)
        fname = "2026-05-04_08-00-00.mp4"
        with open(os.path.join(cam_dir, fname), "wb") as f:
            f.write(b"")
        r = self.client.get("/api/recording_days/calcam?month=2026-05", headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["days"], ["2026-05-04"])
        self.assertEqual(self.client.get("/api/recording_days/calcam?month=2026-13",
                                         headers=auth()).status_code, 400)
        self.assertEqual(self.client.post("/api/cameras/test", json={"rtsp_url": ""},
                                          headers=auth()).status_code, 400)
        self.assertEqual(self.client.post("/api/cameras/test", json={"rtsp_url": "ftp://x"},
                                          headers=auth()).status_code, 400)
        self.assertFalse(self.m.camera_offline_state("calcam")["expected"])
        self.client.delete("/api/cameras/calcam", headers=auth())

    def test_stats(self):
        r = self.client.get("/api/stats", headers=auth())
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertIn("mem_total_mb", j)
        self.assertTrue(0 <= j["mem_percent"] <= 100)
        self.assertTrue(0 <= j["disk_percent"] <= 100)

    def test_viewer_playback_permission(self):
        self.client.post("/api/cameras", json={"cam_id": "cam1", "name": "Cam",
                                               "rtsp_url": "rtsp://127.0.0.1:1/x"}, headers=auth())
        r = self.client.post("/api/users", json={
            "username": "viewer1", "password": "secret1", "role": "user",
            "perms": {"live": True, "playback": False, "events": False, "export": False, "ptz": False, "lock": False},
        }, headers=auth())
        self.assertEqual(r.status_code, 200)
        v = auth("viewer1", "secret1")
        self.assertEqual(self.client.get("/api/cameras", headers=v).status_code, 200)
        self.assertEqual(self.client.get("/api/drive/play/cam1/x.mp4", headers=v).status_code, 403)

    def test_config_export_import(self):
        self.assertEqual(self.client.get("/api/config/export", headers=auth()).status_code, 200)

    def test_camera_hass_entities_persist(self):
        payload = {"cam_id": "mo1", "name": "M", "rtsp_url": "rtsp://127.0.0.1:1/x",
                   "hass_entities": ["binary_sensor.cong", "binary_sensor.cong", " binary_sensor.san ",
                                     {"entity_id": "device_tracker.dt", "state": "home", "label": "Ai đó về"}]}
        self.client.post("/api/cameras", json=payload, headers=auth())
        stored = self.client.get("/api/cameras", headers=auth()).json()["mo1"]
        self.assertEqual([e["entity_id"] for e in stored["hass_entities"]],
                         ["binary_sensor.cong", "binary_sensor.san", "device_tracker.dt"])
        self.assertEqual(stored["hass_entities"][2]["state"], "home")
        self.client.delete("/api/cameras/mo1", headers=auth())

    def test_hass_entity_helpers(self):
        self.assertEqual(self.m._default_active_state("binary_sensor.x"), "on")
        self.assertEqual(self.m._default_active_state("device_tracker.x"), "home")
        self.assertEqual(self.m._default_active_state("sensor.x"), "")
        self.assertEqual(self.m._hass_state_options("binary_sensor.x"), ["on", "off"])
        self.assertEqual(self.m._hass_state_options("person.a"), ["home", "not_home"])
        self.assertEqual(self.m._hass_state_options("sensor.x"), [])
        self.assertIsNone(self.m._norm_hass_entity(""))
        self.assertEqual(self.m._norm_hass_entity("binary_sensor.a"),
                         {"entity_id": "binary_sensor.a", "state": "", "label": ""})
        saved = self.m.CONFIG.get("cameras")
        self.m.CONFIG["cameras"] = {"c1": {"hass_entities": [
            {"entity_id": "binary_sensor.m", "state": "on", "label": "Cổng"}]}}
        try:
            rules = self.m._hass_rules({})
            self.assertEqual(rules["binary_sensor.m"],
                             {"cam_id": "c1", "state": "on", "label": "Cổng"})
        finally:
            self.m.CONFIG["cameras"] = saved

    def test_ai_detect_creates_labelled_event(self):
        payload = {"cam_id": "aicam", "name": "AI", "rtsp_url": "rtsp://127.0.0.1:1/x",
                   "record_mode": "motion"}
        self.client.post("/api/cameras", json=payload, headers=auth())
        r = self.client.post("/api/ai/detect", json={"cam_id": "aicam", "objects": ["person", "car", "car"],
                                                     "snapshot_url": "ftp://nope/x.jpg"}, headers=auth())
        self.assertEqual(r.status_code, 200)
        conn = self.m.db_conn()
        row = conn.execute("SELECT label FROM events WHERE cam_id='aicam' ORDER BY timestamp DESC").fetchone()
        self.assertEqual(row[0], "AI: Người, Xe")
        conn.execute("DELETE FROM events WHERE cam_id='aicam'")
        conn.commit()
        self.client.delete("/api/cameras/aicam", headers=auth())

    def test_ai_event_label_mapping(self):
        self.assertEqual(self.m.ai_event_label(["truck", "unknown_obj"]), "AI: Xe tải, unknown_obj")
        self.assertEqual(self.m.ai_event_label([], "Tùy chỉnh"), "Tùy chỉnh")
        self.assertEqual(self.m.ai_event_label([]), "AI: đối tượng")

    def test_notify_disk_alert_settings_persist(self):
        r = self.client.post("/api/notify", json={"disk_alert_enabled": True, "disk_warn_percent": 80,
                                                  "disk_crit_percent": 90,
                                                  "public_url": "http://192.168.5.63:9895/"}, headers=auth())
        self.assertEqual(r.status_code, 200)
        j = self.client.get("/api/notify", headers=auth()).json()
        self.assertTrue(j["disk_alert_enabled"])
        self.assertEqual(j["disk_warn_percent"], 80)
        self.assertEqual(j["disk_crit_percent"], 90)
        self.assertEqual(j["public_url"], "http://192.168.5.63:9895")
        self.client.post("/api/notify", json={"disk_alert_enabled": False}, headers=auth())

    def test_backup_settings_persist(self):
        r = self.client.post("/api/backup", json={"enabled": True, "kind": "folder",
                                                  "folder_path": "/mnt/backup", "mode": "move",
                                                  "cameras": ["cam1"]}, headers=auth())
        self.assertEqual(r.status_code, 200)
        j = self.client.get("/api/backup", headers=auth()).json()
        self.assertTrue(j["enabled"])
        self.assertEqual(j["folder_path"], "/mnt/backup")
        self.assertEqual(j["mode"], "move")
        self.assertEqual(j["cameras"], ["cam1"])
        self.client.post("/api/backup", json={"enabled": False}, headers=auth())

    def test_events_search(self):
        os.makedirs(self.m.SNAPSHOTS_DIR, exist_ok=True)
        for name in ("s.jpg", "t.jpg"):
            with open(os.path.join(self.m.SNAPSHOTS_DIR, name), "wb") as f:
                f.write(b"x")
        conn = self.m.db_conn()
        conn.execute("INSERT INTO events (cam_id, timestamp, date_str, time_str, label, snapshot) "
                     "VALUES (?,?,?,?,?,?)", ("camS", 100, "2026-01-02", "10-00-00", "Người lạ", "s.jpg"))
        conn.execute("INSERT INTO events (cam_id, timestamp, date_str, time_str, label, snapshot) "
                     "VALUES (?,?,?,?,?,?)", ("camT", 200, "2026-02-03", "11-00-00", "Người quen", "t.jpg"))
        conn.commit()
        j = self.client.get("/api/events?cam_id=camS", headers=auth()).json()
        self.assertEqual(j["count"], 1)
        self.assertEqual(j["events"][0]["label"], "Người lạ")
        self.assertEqual(j["events"][0]["snapshot"], "snapshots/s.jpg")
        self.assertEqual(j["events"][0]["time"], "10:00:00")
        self.assertEqual(j["events"][0]["sec_of_day"], 36000)
        self.assertEqual(self.client.get("/api/events?q=Người", headers=auth()).json()["count"], 2)
        self.assertEqual(self.client.get("/api/events?q=khong-co", headers=auth()).json()["count"], 0)
        j = self.client.get("/api/events?date_from=2026-02-01&date_to=2026-02-28", headers=auth()).json()
        self.assertEqual(j["count"], 1)
        self.assertEqual(j["events"][0]["cam_id"], "camT")
        self.assertEqual(j["total"], 1)
        self.assertEqual(j["offset"], 0)

    def test_events_hide_missing_snapshot(self):
        conn = self.m.db_conn()
        conn.execute("INSERT INTO events (cam_id, timestamp, date_str, time_str, label, snapshot) "
                     "VALUES (?,?,?,?,?,?)",
                     ("camV", 300, "2026-03-04", "12-00-00", "test", "missing.jpg"))
        conn.commit()
        j = self.client.get("/api/events?cam_id=camV", headers=auth()).json()
        self.assertEqual(j["count"], 1)
        self.assertEqual(j["events"][0]["snapshot"], "")

    def test_events_star_and_label_filter(self):
        conn = self.m.db_conn()
        conn.execute("INSERT INTO events (cam_id, timestamp, date_str, time_str, label, snapshot) "
                     "VALUES (?,?,?,?,?,?)", ("camStar", 300, "2026-03-01", "09-00-00", "Xe tải", "x.jpg"))
        conn.commit()
        eid = conn.execute("SELECT id FROM events WHERE cam_id='camStar'").fetchone()[0]
        r = self.client.post(f"/api/events/{eid}/star", json={"starred": True}, headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["starred"])
        only = self.client.get("/api/events?cam_id=camStar&starred=1", headers=auth()).json()
        self.assertEqual(only["count"], 1)
        self.assertTrue(only["events"][0]["starred"])
        none = self.client.get("/api/events?cam_id=camStar&starred=1&label=Không có", headers=auth()).json()
        self.assertEqual(none["count"], 0)
        self.assertEqual(self.client.post(f"/api/events/{eid}/star", json={"starred": False},
                                          headers=auth()).status_code, 200)
        self.assertEqual(self.client.get("/api/events?cam_id=camStar&starred=1", headers=auth()).json()["count"], 0)
        self.assertIn("Xe tải", self.client.get("/api/events/labels", headers=auth()).json()["labels"])
        self.assertEqual(self.client.post("/api/events/99999999/star", json={"starred": True},
                                          headers=auth()).status_code, 404)

    def test_events_pagination(self):
        conn = self.m.db_conn()
        for i in range(5):
            conn.execute("INSERT INTO events (cam_id, timestamp, date_str, time_str, label, snapshot) "
                         "VALUES (?,?,?,?,?,?)",
                         ("camPage", 1000 + i, "2026-04-01", "08:00:0%d" % i, "L%d" % i, ""))
        conn.commit()
        page = self.client.get("/api/events?cam_id=camPage&limit=2&offset=0", headers=auth()).json()
        self.assertEqual(page["count"], 2)
        self.assertEqual(page["total"], 5)
        page2 = self.client.get("/api/events?cam_id=camPage&limit=2&offset=2", headers=auth()).json()
        self.assertEqual(page2["count"], 2)
        self.assertNotEqual(page["events"][0]["id"], page2["events"][0]["id"])

    def test_camera_max_gb_and_min_free_percent(self):
        r = self.client.post("/api/cameras", json={"cam_id": "camGB", "name": "GB",
                                                   "rtsp_url": "rtsp://127.0.0.1:1/x", "max_gb": 5},
                             headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.m.CONFIG["cameras"]["camGB"]["max_gb"], 5.0)
        r = self.client.post("/api/storage", json={"retention_days": 7, "max_storage_gb": 0,
                                                   "max_disk_percent": 85, "post_motion_sec": 60,
                                                   "ram_buffer": True, "min_free_percent": 4}, headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.m.CONFIG["min_free_percent"], 4.0)
        sysinfo = self.client.get("/api/system", headers=auth()).json()
        self.assertEqual(sysinfo["min_free_percent"], 4.0)
        self.assertIn("recording_paused", sysinfo)
        self.client.delete("/api/cameras/camGB", headers=auth())

    def test_session_list_and_revoke(self):
        self.m.create_session("user1", "10.0.0.1")
        self.m.create_session("user1", "10.0.0.2")
        j = self.client.get("/api/me/sessions", headers=auth()).json()
        self.assertGreaterEqual(j["count"], 2)
        self.assertFalse(any(s["current"] for s in j["sessions"]))
        r = self.client.post("/api/me/sessions/revoke", headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(r.json()["revoked"], 2)
        self.assertEqual(self.client.get("/api/me/sessions", headers=auth()).json()["count"], 0)

    def test_login_page_cache_headers(self):
        r = self.client.get("/login")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("cache-control"), "no-store")
        self.assertIn("Đăng nhập", r.text)
        r2 = self.client.get("/", headers=auth())
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.headers.get("cache-control"), "no-store")

    def test_thumbnail_validation(self):
        self.assertEqual(self.client.get("/api/thumb/nope/x.mp4", headers=auth()).status_code, 404)
        self.client.post("/api/cameras", json={"cam_id": "camThumb", "name": "T", "rtsp_url": "rtsp://x"},
                         headers=auth())
        self.assertEqual(self.client.get("/api/thumb/camThumb/bad.txt", headers=auth()).status_code, 400)
        self.assertEqual(self.client.get("/api/thumb/camThumb/missing.mp4", headers=auth()).status_code, 404)
        self.client.delete("/api/cameras/camThumb", headers=auth())

    def test_thumbnail_generation(self):
        if subprocess.call(["ffmpeg", "-version"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL) != 0:
            self.skipTest("ffmpeg không có sẵn")
        self.client.post("/api/cameras", json={"cam_id": "camThumb2", "name": "T2", "rtsp_url": "rtsp://x"},
                         headers=auth())
        rec = os.path.join(self.m.RECORDINGS_DIR, "camThumb2")
        os.makedirs(rec, exist_ok=True)
        subprocess.check_call(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=5",
                               "-t", "2", "-pix_fmt", "yuv420p", os.path.join(rec, "2026-01-01_00-00-00.mp4")],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        r = self.client.get("/api/thumb/camThumb2/2026-01-01_00-00-00.mp4", headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "image/jpeg")
        self.assertGreater(len(r.content), 0)
        self.client.delete("/api/cameras/camThumb2", headers=auth())

    def test_motion_fallback_snapshot(self):
        d = self.m.SNAPSHOTS_DIR
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "camF_1.jpg"), "w") as f:
            f.write("x")
        self.m.CONFIG.setdefault("cameras", {})["camF"] = {
            "name": "F", "rtsp_url": "rtsp://x", "record_mode": "motion"}
        acquired = 0
        while self.m._snapshot_slots.acquire(blocking=False):
            acquired += 1
        try:
            self.m.handle_motion("camF", "test")
        finally:
            for _ in range(acquired):
                self.m._snapshot_slots.release()
            self.m.CONFIG["cameras"].pop("camF", None)
        row = self.m.db_conn().execute(
            "SELECT snapshot FROM events WHERE cam_id='camF' ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(row[0], "camF_1.jpg")

    def test_latest_snapshot_fallback(self):
        d = self.m.SNAPSHOTS_DIR
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "camX_100.jpg")
        with open(p, "w") as f:
            f.write("x")
        self.assertEqual(self.m._latest_snapshot("camX"), p)
        self.assertEqual(self.m._latest_snapshot("nope"), "")

    def test_snapshot_ignores_empty_and_partial_files(self):
        d = self.m.SNAPSHOTS_DIR
        os.makedirs(d, exist_ok=True)
        good = os.path.join(d, "camZ_1.jpg")
        empty = os.path.join(d, "camZ_2.jpg")
        partial = os.path.join(d, "camZ_3.jpg.part")
        for path, data in ((good, b"ok"), (empty, b""), (partial, b"ok")):
            with open(path, "wb") as f:
                f.write(data)
        self.assertEqual(self.m._latest_snapshot("camZ"), good)
        self.assertFalse(self.m._valid_snapshot(empty))

    def test_snapshot_capture_updates_event_after_file_ready(self):
        conn = self.m.db_conn()
        cur = conn.execute("INSERT INTO events (cam_id, timestamp, date_str, time_str, label) "
                           "VALUES (?,?,?,?,?)", ("camY", 1, "2026-01-01", "00-00-01", "test"))
        conn.commit()
        event_id = cur.lastrowid
        target = os.path.join(self.m.SNAPSHOTS_DIR, "camY_capture.jpg")

        class FakeProc:
            returncode = 0
            def __init__(self, cmd, **kwargs):
                with open(cmd[-1], "wb") as f:
                    f.write(b"jpg")
            def wait(self, timeout=None):
                return 0
            def poll(self):
                return 0
            def terminate(self):
                pass
            def kill(self):
                pass

        real = subprocess.Popen
        self.assertTrue(self.m._snapshot_slots.acquire(blocking=False))
        subprocess.Popen = FakeProc
        try:
            self.m._capture_snapshot("camY", {"rtsp_url": "rtsp://x"}, target, event_id)
        finally:
            subprocess.Popen = real
        self.assertTrue(self.m._valid_snapshot(target))
        self.assertFalse(os.path.exists(target + ".part"))
        row = conn.execute("SELECT snapshot FROM events WHERE id=?", (event_id,)).fetchone()
        self.assertEqual(row[0], "camY_capture.jpg")

    def test_motion_without_snapshot_does_not_store_missing_path(self):
        self.m.CONFIG.setdefault("cameras", {})["camG"] = {
            "name": "G", "rtsp_url": "rtsp://x", "record_mode": "motion"}
        acquired = 0
        while self.m._snapshot_slots.acquire(blocking=False):
            acquired += 1
        try:
            self.m.handle_motion("camG", "test")
        finally:
            for _ in range(acquired):
                self.m._snapshot_slots.release()
            self.m.CONFIG["cameras"].pop("camG", None)
        row = self.m.db_conn().execute(
            "SELECT snapshot FROM events WHERE cam_id='camG' ORDER BY id DESC LIMIT 1").fetchone()
        self.assertIsNone(row[0])

    def test_camera_retention_api(self):
        self.client.post("/api/cameras", json={"cam_id": "camRet", "name": "R", "rtsp_url": "rtsp://x",
                                               "retention_days": 3}, headers=auth())
        cams = self.client.get("/api/cameras", headers=auth()).json()
        self.assertEqual(cams["camRet"]["retention_days"], 3)
        self.client.post("/api/cameras", json={"cam_id": "camRet", "name": "R", "rtsp_url": "rtsp://x",
                                               "retention_days": -5}, headers=auth())
        self.assertEqual(self.client.get("/api/cameras", headers=auth()).json()["camRet"]["retention_days"], 0)
        self.client.delete("/api/cameras/camRet", headers=auth())

    def test_cam_retention_days(self):
        self.m.CONFIG["retention_days"] = 7
        self.m.CONFIG.setdefault("cameras", {})["cA"] = {"retention_days": 2}
        self.m.CONFIG["cameras"]["cB"] = {}
        self.assertEqual(self.m.cam_retention_days("cA"), 2)
        self.assertEqual(self.m.cam_retention_days("cB"), 7)
        self.assertEqual(self.m.cam_retention_days("missing"), 7)
        self.m.CONFIG["cameras"].pop("cA"); self.m.CONFIG["cameras"].pop("cB")

    def test_per_camera_cleanup(self):
        cfg = self.m.CONFIG
        orig = (cfg.get("retention_days"), cfg.get("max_storage_gb"), cfg.get("max_disk_percent"))
        cfg["retention_days"] = 7
        cfg["max_storage_gb"] = 0
        cfg["max_disk_percent"] = 0
        cfg.setdefault("cameras", {})["camLong"] = {"retention_days": 30}
        cfg["cameras"]["camTiny"] = {"retention_days": 1}
        try:
            old = time.time() - 3 * 86400
            for cid in ("camLong", "camTiny"):
                d = os.path.join(self.m.RECORDINGS_DIR, cid)
                os.makedirs(d, exist_ok=True)
                p = os.path.join(d, "clip.mp4")
                with open(p, "w") as f:
                    f.write("x")
                os.utime(p, (old, old))
            self.m.run_cleanup_now()
            self.assertTrue(os.path.exists(os.path.join(self.m.RECORDINGS_DIR, "camLong", "clip.mp4")))
            self.assertFalse(os.path.exists(os.path.join(self.m.RECORDINGS_DIR, "camTiny", "clip.mp4")))
        finally:
            cfg["retention_days"], cfg["max_storage_gb"], cfg["max_disk_percent"] = orig
            cfg["cameras"].pop("camLong", None); cfg["cameras"].pop("camTiny", None)


class _FakeOnvifHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, text, status=200):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/soap+xml; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        host, port = self.server.server_address[0], self.server.server_port
        base = f"http://{host}:{port}"
        if "GetSystemDateAndTime" in body:
            self._send('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
                       '<s:Body><tds:GetSystemDateAndTimeResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>'
                       '</s:Body></s:Envelope>')
        elif "GetDeviceInformation" in body:
            self._send('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
                       '<s:Body><tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">'
                       '<tds:Manufacturer>Dahua</tds:Manufacturer><tds:Model>Cam X</tds:Model>'
                       '</tds:GetDeviceInformationResponse></s:Body></s:Envelope>')
        elif "GetCapabilities" in body:
            self._send(f'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
                       f'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" '
                       f'xmlns:tt="http://www.onvif.org/ver10/schema">'
                       f'<s:Body><tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media>'
                       f'<tt:XAddr>{base}/onvif/Media</tt:XAddr>'
                       f'</tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse></s:Body></s:Envelope>')
        elif "GetProfiles" in body:
            self._send('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
                       'xmlns:trt="http://www.onvif.org/ver10/media/wsdl" '
                       'xmlns:tt="http://www.onvif.org/ver10/schema">'
                       '<s:Body><trt:GetProfilesResponse>'
                       '<trt:Profiles token="MainTok"><tt:Name>Main</tt:Name>'
                       '<tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding>'
                       '<tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution>'
                       '</tt:VideoEncoderConfiguration></trt:Profiles>'
                       '<trt:Profiles token="SubTok"><tt:Name>Sub</tt:Name>'
                       '<tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding>'
                       '<tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution>'
                       '</tt:VideoEncoderConfiguration></trt:Profiles>'
                       '</trt:GetProfilesResponse></s:Body></s:Envelope>')
        elif "GetStreamUri" in body:
            token = re.search(r"ProfileToken>([^<]+)<", body)
            stream = "main" if token and token.group(1) == "MainTok" else "sub"
            self._send('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
                       'xmlns:trt="http://www.onvif.org/ver10/media/wsdl" '
                       'xmlns:tt="http://www.onvif.org/ver10/schema">'
                       '<s:Body><trt:GetStreamUriResponse><trt:MediaUri>'
                       f'<tt:Uri>rtsp://{host}:8554/{stream}</tt:Uri>'
                       '</trt:MediaUri></trt:GetStreamUriResponse></s:Body></s:Envelope>')
        else:
            self._send('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
                       '<s:Body><s:Fault><s:Reason><s:Text>Unknown action</s:Text></s:Reason></s:Fault>'
                       '</s:Body></s:Envelope>', status=400)


class _FakeAuthHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_POST(self):
        if getattr(self.server, "mode", "") == "digest":
            body = b'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"/>'
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Digest realm="onvif", nonce="abc"')
            self.send_header("Content-Type", "application/soap+xml")
        else:
            body = b'{"error":"Unauthorized"}'
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class OnvifTests(_AppCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.onvif = ThreadingHTTPServer(("127.0.0.2", 0), _FakeOnvifHandler)
        cls.onvif_port = cls.onvif.server_port
        cls.auth_json = ThreadingHTTPServer(("127.0.0.2", 0), _FakeAuthHandler)
        cls.auth_json.mode = "json"
        cls.auth_digest = ThreadingHTTPServer(("127.0.0.2", 0), _FakeAuthHandler)
        cls.auth_digest.mode = "digest"
        cls.onvif_thread = threading.Thread(target=cls.onvif.serve_forever, daemon=True)
        cls.onvif_thread.start()
        for srv in (cls.auth_json, cls.auth_digest):
            threading.Thread(target=srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for srv in (cls.onvif, cls.auth_json, cls.auth_digest):
            srv.shutdown()
            srv.server_close()
        super().tearDownClass()

    def test_discovery_parser_and_scan_validation(self):
        sample = (
            '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" '
            'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
            '<e:Body><d:ProbeMatches><d:ProbeMatch>'
            '<d:XAddrs>http://192.168.5.8/onvif/device_service</d:XAddrs>'
            '<d:Scopes>onvif://www.onvif.org/name/Front%20Gate</d:Scopes>'
            '</d:ProbeMatch></d:ProbeMatches></e:Body></e:Envelope>'
        ).encode()
        dev = self.m._parse_discovery_response(sample, "192.168.5.8")
        self.assertEqual(dev["name"], "Front Gate")
        self.assertEqual(dev["ip"], "192.168.5.8")
        self.assertEqual(dev["port"], 80)
        self.assertTrue(dev["xaddr"].endswith("/onvif/device_service"))
        self.assertEqual(self.m._onvif_guess_brand("HANET", "IP Camera"), "hanet")
        self.assertEqual(
            self.m.mask_secrets("rtsp://admin:pw@192.168.5.9:554/live"),
            "rtsp://***:***@192.168.5.9:554/live",
        )
        self.assertEqual(
            self.m.mask_secrets("rtsp://192.168.5.184:554/user:admin;pwd:s3cret"),
            "rtsp://192.168.5.184:554/user:***;pwd:***",
        )
        hosts, label = self.m._parse_scan_targets("127.0.0.2/32")
        self.assertEqual(hosts, ["127.0.0.2"])
        self.assertEqual(label, "127.0.0.2/32")
        with self.assertRaises(ValueError):
            self.m._parse_scan_targets("8.8.8.0/24")
        with self.assertRaises(ValueError):
            self.m._parse_scan_targets("10.0.0.0/8")

    def test_profile_pick_by_resolution(self):
        profiles = [
            {"token": "a", "name": "HD", "width": 1920, "height": 1080, "uri": "rtsp://a"},
            {"token": "b", "name": "Low", "width": 640, "height": 360, "uri": "rtsp://b"},
        ]
        main, sub = self.m._onvif_pick_profiles(profiles)
        self.assertEqual(main["token"], "a")
        self.assertEqual(sub["token"], "b")

    def test_probe_profiles_and_auth_urls(self):
        d = self.m.onvif_probe("127.0.0.2", self.onvif_port, "user", "pa:ss@word")
        self.assertEqual(d["brand"], "imou")
        self.assertEqual(d["onvif_port"], self.onvif_port)
        self.assertIn("rtsp://user:pa%3Ass%40word@127.0.0.2:8554/main", d["main_rtsp_url"])
        self.assertIn("rtsp://user:pa%3Ass%40word@127.0.0.2:8554/sub", d["sub_rtsp_url"])
        self.assertEqual(len(d["profiles"]), 2)

    def test_scan_unicast(self):
        d = self.m.onvif_scan_network("127.0.0.2/32", timeout=1.0, ports=[self.onvif_port])
        self.assertEqual(d["scanned"], 1)
        self.assertEqual(len(d["devices"]), 1)
        self.assertEqual(d["devices"][0]["name"], "Dahua Cam X")

    def test_scan_rejects_plain_401_and_accepts_digest(self):
        bad = self.m.onvif_scan_network("127.0.0.2/32", timeout=1.0, ports=[self.auth_json.server_port])
        self.assertEqual(bad["devices"], [])
        good = self.m.onvif_scan_network("127.0.0.2/32", timeout=1.0, ports=[self.auth_digest.server_port])
        self.assertEqual(len(good["devices"]), 1)
        self.assertTrue(good["devices"][0]["auth_required"])

    def test_auto_add_and_duplicate(self):
        payload = {
            "devices": [{"host": "127.0.0.2", "port": self.onvif_port,
                         "xaddr": f"http://127.0.0.2:{self.onvif_port}/onvif/device_service",
                         "name": "Fake cam"}],
            "username": "admin", "password": "pw",
            "record_mode": "off", "storage_target": "hdd", "room": "Test", "tags": "onvif",
        }
        r = self.client.post("/api/onvif/auto_add", json=payload, headers=auth())
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertEqual(j["added"], 1, j)
        cam_id = j["cam_ids"][0]
        cam = self.m.CONFIG["cameras"][cam_id]
        self.assertEqual(cam["brand"], "imou")
        self.assertEqual(cam["record_mode"], "off")
        self.assertEqual(cam["room"], "Test")
        self.assertIn("rtsp://admin:pw@127.0.0.2:8554/main", cam["rtsp_url"])
        r2 = self.client.post("/api/onvif/auto_add", json=payload, headers=auth())
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertEqual(r2.json()["added"], 0)
        self.assertEqual(r2.json()["results"][0]["status"], "skipped")
        self.client.delete(f"/api/cameras/{cam_id}", headers=auth())


class BuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sandbox, cls.m = load_app()

    def _cam(self, **kw):
        cam = {"name": "C", "rtsp_url": "rtsp://cam.invalid/main", "sub_rtsp_url": "rtsp://cam.invalid/sub",
               "record_mode": "continuous", "video_codec": "auto"}
        cam.update(kw)
        return cam

    def _values(self, cmd, flag):
        return [cmd[i + 1] for i, a in enumerate(cmd) if a == flag]

    def test_filter_and_decoder_threads(self):
        base = self.m._ffmpeg_base_args()
        self.assertEqual(self._values(base, "-filter_threads"), ["2"])
        self.assertEqual(self._values(base, "-filter_complex_threads"), ["2"])
        opts = self.m._input_args("rtsp://cam.invalid/main", {"rtsp_transport": "udp"})
        self.assertEqual(self._values(opts, "-threads"), ["2"])
        self.assertEqual(self._values(opts, "-rtsp_transport"), ["udp"])
        self.assertNotIn("-rtsp_transport", self.m._input_args("http://cam.invalid/x", {}))

    def test_only_required_sources(self):
        base = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="continuous", video_codec="copy"), include_live=False)
        self.assertEqual(base.count("-i"), 1)
        off = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="off", video_codec="copy"), include_live=True)
        self.assertEqual(off.count("-i"), 1)
        self.assertIn("sub", off[off.index("-i") + 1])

    def test_runtime_live_downscale(self):
        cmd = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="copy", video_codec="h264"))
        self.assertIn("-vf", cmd)
        vf = self._values(cmd, "-vf")[0]
        self.assertIn("min(", vf)
        self.assertIn("720", vf)
        self.assertIn("ih", vf)

    def test_stream_health_progress(self):
        self.m.cam_health.clear()
        self.assertTrue(self.m._note_progress("fps=25.0", "c1"))
        self.assertTrue(self.m._note_progress("frame=120", "c1"))
        self.assertTrue(self.m._note_progress("progress=continue", "c1"))
        self.assertFalse(self.m._note_progress("some rtsp error", "c1"))
        snap = self.m.health_snapshot()
        self.assertEqual(snap["c1"]["fps"], 25.0)
        self.assertEqual(snap["c1"]["state"], "continue")
        self.assertIsNotNone(snap["c1"]["age_sec"])
        self.assertIn("-progress", self.m.build_ffmpeg_cmd("cam", self._cam()))

    def test_hls_low_latency_flags(self):
        cmd = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="copy", video_codec="copy"), include_live=True)
        flags = self._values(cmd, "-hls_flags")[0]
        self.assertIn("independent_segments", flags)
        self.assertIn("delete_segments", flags)
        self.assertIn("temp_file", flags)
        self.assertEqual(self._values(cmd, "-hls_time"), [str(self.m.LIVE_HLS_TIME)])
        self.assertEqual(self._values(cmd, "-hls_list_size"), [str(self.m.LIVE_HLS_LIST)])
        self.assertEqual(self._values(cmd, "-hls_delete_threshold"), ["1"])
        self.assertEqual(self._values(cmd, "-hls_allow_cache"), ["0"])
        self.assertLessEqual(self.m.LIVE_HLS_TIME, 1)
        self.assertLessEqual(self.m.LIVE_HLS_LIST, 4)

    def test_transcoded_live_forces_segment_keyframes(self):
        cmd = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="copy", video_codec="h264"), include_live=True)
        self.assertIn(f"n_forced*{self.m.LIVE_HLS_TIME}", self._values(cmd, "-force_key_frames")[0])
        copy_cmd = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="copy", video_codec="copy"), include_live=True)
        self.assertNotIn("-force_key_frames", copy_cmd)

    def test_hass_rules_merges_camera_entities(self):
        saved = self.m.CONFIG.get("cameras")
        self.m.CONFIG["cameras"] = {"c1": {"hass_entities": ["binary_sensor.a"]}}
        try:
            rules = self.m._hass_rules({"c2": [{"entity_id": "binary_sensor.b", "label": "x"}]})
        finally:
            self.m.CONFIG["cameras"] = saved
        self.assertEqual(rules["binary_sensor.a"]["cam_id"], "c1")
        self.assertEqual(rules["binary_sensor.b"]["cam_id"], "c2")
        self.assertEqual(rules["binary_sensor.b"]["label"], "x")

    def test_hass_motion_triggered_only_on_edge(self):
        f = self.m._hass_motion_triggered
        self.assertTrue(f({"state": "on"}, "binary_sensor.x", "on", "off"))
        self.assertFalse(f({"state": "on"}, "binary_sensor.x", "on", "on"))
        self.assertFalse(f({"state": "on"}, "binary_sensor.x", "off", "on"))
        self.assertTrue(f({"state": ""}, "binary_sensor.x", "on", "off"))
        self.assertFalse(f({"state": ""}, "binary_sensor.x", "on", "on"))
        self.assertTrue(f({}, "device_tracker.x", "home", "not_home"))
        self.assertFalse(f({}, "device_tracker.x", "not_home", "home"))
        self.assertFalse(f({"state": "on"}, "binary_sensor.x", "ON", "ON"))

    def test_disk_health_and_alert_level(self):
        h = self.m.disk_health()
        self.assertIn("percent", h)
        self.assertTrue(h["writable"])
        self.assertIn("smart", h)
        self.assertEqual(self.m.disk_alert_level(50, 85, 95), "")
        self.assertEqual(self.m.disk_alert_level(90, 85, 95), "warn")
        self.assertEqual(self.m.disk_alert_level(99, 85, 95), "crit")

    def test_backup_scan_and_folder_copy(self):
        m = self.m
        dest = os.path.join(m.STORAGE_DIR, "backupdest")
        os.makedirs(dest, exist_ok=True)
        rec = os.path.join(m.RECORDINGS_DIR, "camB")
        os.makedirs(rec, exist_ok=True)
        fname = "2026-01-01_00-00-00.mp4"
        fpath = os.path.join(rec, fname)
        with open(fpath, "wb") as f:
            f.write(b"video")
        old = time.time() - 3600
        os.utime(fpath, (old, old))
        m.CONFIG["backup"] = {"enabled": True, "kind": "folder", "folder_path": dest,
                              "mode": "copy", "cameras": ["camB"]}
        files = m.backup_scan()
        self.assertIn(f"camB/{fname}", files)
        m._backup_file(f"camB/{fname}")
        self.assertTrue(os.path.isfile(os.path.join(dest, "camB", fname)))
        self.assertIn(f"camB/{fname}", m._backup_done())
        self.assertTrue(os.path.isfile(fpath))
        m.CONFIG["backup"]["enabled"] = False

    def test_backup_scan_skips_locked_and_recent(self):
        m = self.m
        rec = os.path.join(m.RECORDINGS_DIR, "camC")
        os.makedirs(rec, exist_ok=True)
        recent = os.path.join(rec, "2026-01-01_01-00-00.mp4")
        locked = os.path.join(rec, "2026-01-01_02-00-00.mp4")
        for p in (recent, locked):
            with open(p, "wb") as f:
                f.write(b"v")
        old = time.time() - 3600
        os.utime(locked, (old, old))
        m.CONFIG["backup"] = {"enabled": True, "kind": "folder",
                              "folder_path": os.path.join(m.STORAGE_DIR, "backupdest"),
                              "cameras": ["camC"]}
        fonts = m.locked_paths
        m.locked_paths = lambda: {"camC/2026-01-01_02-00-00.mp4"}
        try:
            files = m.backup_scan()
        finally:
            m.locked_paths = fonts
        self.assertNotIn("camC/2026-01-01_01-00-00.mp4", files)
        self.assertNotIn("camC/2026-01-01_02-00-00.mp4", files)
        m.CONFIG["backup"]["enabled"] = False

    def test_event_link_builds_playback_url(self):
        m = self.m
        m.CONFIG["notify"] = {"public_url": "http://192.168.5.63:9895/"}
        link = m._event_link("cam x", datetime(2026, 10, 18, 7, 5, 9))
        self.assertIn("http://192.168.5.63:9895/?cam=cam%20x", link)
        self.assertIn("date=2026-10-18", link)
        self.assertIn("t=25509", link)
        m.CONFIG["notify"] = {"public_url": ""}
        self.assertEqual(m._event_link("c", datetime(2026, 1, 1)), "")

    def test_explicit_h264_recording_uses_h264_while_live_copy(self):
        cmd = self.m.build_ffmpeg_cmd("cam", self._cam(record_mode="continuous", video_codec="copy"), video_codec="h264")
        self.assertIn("libx264", cmd)
        self.assertIn("copy", cmd)


class LifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sandbox, cls.m = load_app()

    def test_terminate_process_reaps(self):
        proc = subprocess.Popen([sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM, lambda *a: None); time.sleep(60)"])
        self.m._terminate_process(proc, timeout=2)
        self.assertIsNotNone(proc.poll())

    def test_snapshot_slots_bounded(self):
        m = self.m
        m.cam_source_urls = lambda cam_id, cam_info: (cam_info["rtsp_url"], cam_info["rtsp_url"])
        lock = threading.Lock()
        state = {"active": 0, "max": 0}

        class FakeProc:
            def __init__(self, *a, **k):
                with lock:
                    state["active"] += 1
                    state["max"] = max(state["max"], state["active"])
                self.returncode = None
            def poll(self):
                return self.returncode
            def wait(self, timeout=None):
                time.sleep(0.05)
                with lock:
                    if self.returncode is None:
                        state["active"] -= 1
                self.returncode = 0
                return 0
            def terminate(self):
                self.returncode = 0
            def kill(self):
                self.returncode = 0

        real = subprocess.Popen
        subprocess.Popen = FakeProc
        try:
            started = [m._start_snapshot(f"cam{i}", {"rtsp_url": "rtsp://x"}, os.path.join(self.sandbox, f"s{i}.jpg"))
                       for i in range(5)]
            self.assertGreaterEqual(started.count(False), 2)
            deadline = time.time() + 3
            while time.time() < deadline and (m._snapshot_active or m._snapshot_processes):
                time.sleep(0.05)
            self.assertEqual(m._snapshot_active, {})
            self.assertLessEqual(state["max"], 2)
            for _ in range(2):
                m._snapshot_slots.acquire(blocking=False)
            for _ in range(2):
                m._snapshot_slots.release()
        finally:
            subprocess.Popen = real


class _FakeDriveHandler(BaseHTTPRequestHandler):
    """Google Drive giả: /token + /files/<id>?alt=media, hỗ trợ Range và tự ngắt giữa chừng 1 lần."""
    DATA = bytes((i * 7) % 251 for i in range(30000))
    drop_after = 10000
    hits = []
    dropped = False

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path.endswith("/token"):
            body = b'{"access_token":"tok1","expires_in":3600}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def do_GET(self):
        if "/files/" not in self.path:
            self.send_error(404)
            return
        start = 0
        m = re.match(r"bytes=(\d+)-", self.headers.get("Range") or "")
        if m:
            start = int(m.group(1))
        type(self).hits.append(start)
        data = self.DATA[start:]
        body_len = len(data)
        self.send_response(206 if start else 200)
        self.send_header("Content-Type", "video/mp4")
        if start:
            self.send_header("Content-Range", f"bytes {start}-{len(self.DATA) - 1}/{len(self.DATA)}")
        self.send_header("Content-Length", str(body_len))
        self.end_headers()
        if not start and not type(self).dropped:
            type(self).dropped = True
            self.wfile.write(data[:self.drop_after])
            self.wfile.flush()
            self.close_connection = True  # ngắt kết nối giữa chừng
            return
        self.wfile.write(data)
        self.wfile.flush()


class DrivePlaybackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._env_backup = {k: os.environ.get(k) for k in ("NVR_DRIVE_API_BASE", "NVR_DRIVE_OAUTH_BASE")}
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), _FakeDriveHandler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        cls.sandbox, cls.m = load_app({"NVR_DRIVE_API_BASE": base + "/drive/v3",
                                       "NVR_DRIVE_OAUTH_BASE": base})
        from fastapi.testclient import TestClient
        cls.client = TestClient(cls.m.app)
        cls.client.__enter__()
        cls.m.gd_cfg().update({"client_id": "cid", "client_secret": "sec", "refresh_token": "rt"})

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.srv.shutdown()
        cls.srv.server_close()
        for k, v in cls._env_backup.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def setUp(self):
        _FakeDriveHandler.hits = []
        _FakeDriveHandler.dropped = False
        name = f"2026-10-19_{self._testMethodName[:12]}.mp4"
        self.cam, self.name = "cam9", name
        self.rel = f"{self.cam}/{self.name}"
        self.path = os.path.join(self.m.RECORDINGS_DIR, self.cam, self.name)
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        for p in (self.path, self.path + ".part"):
            try:
                os.remove(p)
            except OSError:
                pass
        conn = self.m.db_conn()
        conn.execute("DELETE FROM drive_uploads WHERE path=?", (self.rel,))
        conn.execute("INSERT INTO drive_uploads(path, cam_id, name, status, drive_id) VALUES(?,?,?,?,?)",
                     (self.rel, self.cam, self.name, "done", "fid1"))
        conn.commit()
        self.m._drive_fetch_prog.pop(self.rel, None)

    def test_drive_download_resumes_after_connection_drop(self):
        prog = {"state": "downloading", "done": 0, "total": 0}
        n = self.m.drive_download_file("fid1", self.path, 0, prog)
        self.assertEqual(n, len(_FakeDriveHandler.DATA))
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), _FakeDriveHandler.DATA)
        self.assertEqual(_FakeDriveHandler.hits, [0, 10000])
        self.assertEqual(prog["done"], len(_FakeDriveHandler.DATA))
        self.assertFalse(os.path.exists(self.path + ".part"))

    def test_play_status_starts_fetch_without_video_request(self):
        r = self.client.get(f"/api/drive/play/{self.cam}/{self.name}", headers=auth())
        self.assertEqual(r.status_code, 200)
        self.assertIn(r.json()["state"], ("downloading", "done", "local"))
        deadline = time.time() + 5
        while time.time() < deadline and not os.path.isfile(self.path):
            time.sleep(0.02)
        self.assertTrue(os.path.isfile(self.path))
        self.assertEqual(self.client.get(f"/api/drive/play/{self.cam}/{self.name}",
                                         headers=auth()).json()["state"], "local")

    def test_play_status_error_visible_until_retry(self):
        self.m._drive_fetch_prog[self.rel] = {"state": "error", "error": "mạng lỗi",
                                              "done": 3, "total": 10}
        j = self.client.get(f"/api/drive/play/{self.cam}/{self.name}", headers=auth()).json()
        self.assertEqual(j["state"], "error")
        self.assertIn("mạng lỗi", j["error"])
        j = self.client.get(f"/api/drive/play/{self.cam}/{self.name}?retry=1", headers=auth()).json()
        self.assertIn(j["state"], ("downloading", "done", "local"))
        deadline = time.time() + 5
        while time.time() < deadline and not os.path.isfile(self.path):
            time.sleep(0.02)
        self.assertTrue(os.path.isfile(self.path))


if __name__ == "__main__":
    unittest.main(verbosity=2)
