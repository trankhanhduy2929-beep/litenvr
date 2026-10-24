"use client";

import { useCallback, useEffect, useState } from "react";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

const PLAN_DAYS = { trial: 1, weekly: 7, lifetime: 0 };

export default function AdminPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [licenses, setLicenses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [created, setCreated] = useState([]);
  const [form, setForm] = useState({ plan: "trial", days: 1, count: 1, note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin/keys", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setAuthed(false);
      return;
    }
    const ordersResponse = await fetch("/api/admin/orders", { cache: "no-store" });
    const ordersData = ordersResponse.ok ? await ordersResponse.json() : { orders: [] };
    setAuthed(true);
    setLicenses(data.licenses || []);
    setOrders(ordersData.orders || []);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.account?.role === "admin") {
          setAuthed(true);
          return load();
        }
        return null;
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [load]);

  async function login(event) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đăng nhập được");
      if (data.account?.role !== "admin") {
        throw new Error("Tài khoản này không có quyền quản trị");
      }
      setAuthed(true);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthed(false);
    setIdentifier("");
    setPassword("");
  }

  async function createKeys(event) {
    event.preventDefault();
    setBusy(true);
    setCreated([]);
    try {
      const response = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không tạo được key");
      setCreated(data.keys || []);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function action(key, body, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    const response = await fetch(`/api/admin/keys/${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Không cập nhật được license");
      return;
    }
    await load();
  }

  async function orderAction(code, actionName, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    const response = await fetch(`/api/admin/orders/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Không cập nhật được đơn");
      return;
    }
    await load();
  }

  if (checking) {
    return <p style={{ color: "var(--muted)" }}>Đang kiểm tra đăng nhập...</p>;
  }

  if (!authed) {
    return (
      <section style={{ maxWidth: 520, margin: "40px auto" }}>
        <div className="eyebrow">Quản trị</div>
        <h1 style={{ fontSize: 42 }}>Đăng nhập quản trị</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Dùng tài khoản quản trị bằng email/số điện thoại và mật khẩu.
        </p>
        <form className="panel" onSubmit={login} style={{ display: "grid", gap: 12 }}>
          <label>
            Email hoặc số điện thoại
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn primary" type="submit">Đăng nhập</button>
          {error ? <div className="notice error" role="alert">{error}</div> : null}
        </form>
      </section>
    );
  }

  return (
    <>
      <div className="eyebrow">Quản trị</div>
      <h1 style={{ fontSize: 46 }}>License keys</h1>
      <p style={{ color: "var(--muted)" }}>Tạo key, thu hồi, cộng ngày hoặc gỡ liên kết thiết bị.</p>
      <div className="cta-row">
        <a className="btn small" href="/account">Đổi mật khẩu</a>
        <button className="btn small" type="button" onClick={logout}>Đăng xuất</button>
      </div>

      <form className="panel" onSubmit={createKeys} style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Tạo key mới</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <label>
            Gói
            <select
              value={form.plan}
              onChange={(event) => setForm({
                ...form,
                plan: event.target.value,
                days: PLAN_DAYS[event.target.value] ?? form.days,
              })}
            >
              <option value="trial">Dùng thử 1 ngày</option>
              <option value="weekly">Gói 7 ngày</option>
              <option value="lifetime">Vĩnh viễn</option>
            </select>
          </label>
          <label>
            Số ngày (0 = vĩnh viễn)
            <input type="number" min="0" max="3650" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </label>
          <label>
            Số lượng
            <input type="number" min="1" max="100" value={form.count} onChange={(event) => setForm({ ...form, count: event.target.value })} />
          </label>
          <label>
            Ghi chú
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Khách hàng / đơn hàng" />
          </label>
        </div>
        <div className="cta-row" style={{ marginTop: 14 }}>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Đang tạo..." : "Tạo key"}</button>
          <button className="btn" type="button" onClick={() => load()}>Làm mới danh sách</button>
        </div>
        {created.length ? (
          <div className="notice ok" role="status">
            <strong>Đã tạo {created.length} key:</strong>
            {created.map((key) => <div className="code" key={key} style={{ marginTop: 8 }}>{key}</div>)}
          </div>
        ) : null}
        {error ? <div className="notice error" role="alert">{error}</div> : null}
      </form>

      <div className="section-head" style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 30 }}>Đơn hàng</h2>
        <p>Đơn chờ thanh toán có thể được xác nhận thủ công để cấp key ngay.</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mã đơn</th><th>Gói</th><th>Số tiền</th><th>Email</th><th>Trạng thái</th><th>Key</th><th>Tạo lúc</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.order_code}>
                <td><code>{order.order_code}</code></td>
                <td>{order.plan}</td>
                <td>{new Intl.NumberFormat("vi-VN").format(order.amount)}đ</td>
                <td>{order.email || "—"}</td>
                <td>{order.status}</td>
                <td>{order.license_key ? <code>{order.license_key}</code> : "—"}</td>
                <td>{formatDate(order.created_at)}</td>
                <td>
                  {order.status === "pending" ? (
                    <div className="row-actions">
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => orderAction(order.order_code, "mark_paid", "Xác nhận đã nhận tiền và cấp key?")}
                      >
                        Xác nhận + cấp key
                      </button>
                      <button
                        className="btn small danger"
                        type="button"
                        onClick={() => orderAction(order.order_code, "cancel", "Huỷ đơn này?")}
                      >
                        Huỷ
                      </button>
                    </div>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {!orders.length ? (
              <tr><td colSpan="8" style={{ color: "var(--muted)" }}>Chưa có đơn hàng.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="section-head" style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 30 }}>License đã cấp</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key</th><th>Gói</th><th>Trạng thái</th><th>Hết hạn</th><th>Thiết bị</th><th>Ghi chú</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((license) => (
              <tr key={license.license_key}>
                <td><code>{license.license_key}</code></td>
                <td>{license.plan}</td>
                <td><span className={`status-pill ${license.status}`}>{license.status}</span></td>
                <td>{formatDate(license.expires_at)}</td>
                <td>
                  <code>{license.installation_id || "—"}</code>
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>Kích hoạt: {formatDate(license.activated_at)}</div>
                </td>
                <td>{license.note || ""}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn small" type="button" onClick={() => action(license.license_key, { add_days: 30 })}>+30 ngày</button>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() => action(license.license_key, { reset_installation: true }, "Gỡ liên kết thiết bị của key này?")}
                    >
                      Gỡ máy
                    </button>
                    {license.status === "active" ? (
                      <button
                        className="btn small danger"
                        type="button"
                        onClick={() => action(license.license_key, { status: "revoked" }, "Thu hồi license này?")}
                      >
                        Thu hồi
                      </button>
                    ) : (
                      <button className="btn small" type="button" onClick={() => action(license.license_key, { status: "active" })}>Mở lại</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!licenses.length ? (
              <tr><td colSpan="7" style={{ color: "var(--muted)" }}>Chưa có license.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
