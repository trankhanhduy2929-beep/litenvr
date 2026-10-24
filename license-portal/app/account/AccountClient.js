"use client";

import { useEffect, useState } from "react";

const PLAN_LABELS = {
  trial: "Dùng thử 1 ngày",
  weekly: "Gói 7 ngày",
  lifetime: "Vĩnh viễn",
};

function formatDate(value) {
  if (!value) return "Vĩnh viễn";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

function formatMoney(value) {
  return Number(value) === 0 ? "Miễn phí" : `${new Intl.NumberFormat("vi-VN").format(Number(value))}đ`;
}

export default function AccountClient() {
  const [account, setAccount] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [passwords, setPasswords] = useState({ current_password: "", new_password: "" });
  const [passwordMessage, setPasswordMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/auth?next=/account";
          return null;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không tải được tài khoản");
        return data;
      })
      .then((data) => {
        if (!data) return;
        setAccount(data.account);
        setOrders(data.orders || []);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function copyKey(key) {
    await navigator.clipboard.writeText(key);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  }

  async function changePassword(event) {
    event.preventDefault();
    setBusy(true);
    setPasswordMessage(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwords),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đổi được mật khẩu");
      setPasswordMessage({ type: "ok", text: "Đã đổi mật khẩu" });
      setPasswords({ current_password: "", new_password: "" });
    } catch (err) {
      setPasswordMessage({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (error) {
    return (
      <section style={{ maxWidth: 720, margin: "30px auto" }}>
        <div className="notice error" role="alert">{error}</div>
        <p><a href="/auth?next=/account">Đăng nhập</a></p>
      </section>
    );
  }

  if (!account) {
    return <p style={{ color: "var(--muted)" }}>Đang tải tài khoản...</p>;
  }

  return (
    <section style={{ maxWidth: 920, margin: "0 auto" }}>
      <div className="eyebrow">Tài khoản LiteNVR</div>
      <h1 style={{ fontSize: "clamp(34px, 6vw, 50px)" }}>Xin chào.</h1>
      <p style={{ color: "var(--muted)" }}>
        {account.identifier} · {account.role === "admin" ? "Quản trị viên" : "Khách hàng"}
      </p>

      <div className="cta-row">
        <a className="btn primary" href="/#pricing">Mua hoặc gia hạn</a>
        {account.role === "admin" ? <a className="btn" href="/admin">Trang quản trị</a> : null}
        <button className="btn" type="button" onClick={logout}>Đăng xuất</button>
      </div>

      <h2 style={{ marginTop: 48 }}>License của bạn</h2>
      {orders.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Chưa có đơn hàng. Bạn có thể nhận dùng thử 1 ngày miễn phí.</p>
      ) : (
        <div className="account-list">
          {orders.map((order) => (
            <article className="panel" key={order.order_code}>
              <div className="account-order-head">
                <div>
                  <strong>{PLAN_LABELS[order.plan] || order.plan}</strong>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    Đơn #{order.order_code} · {formatMoney(order.amount)} · {formatDate(order.created_at)}
                  </div>
                </div>
                <span className={`status-pill ${order.status}`}>{order.status}</span>
              </div>
              {order.status === "paid" && order.license_key ? (
                <>
                  <div className="code" style={{ margin: "12px 0" }}>{order.license_key}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    Hạn dùng: {formatDate(order.expires_at)}
                    {order.installation_id ? ` · Thiết bị: ${order.installation_id}` : ""}
                  </div>
                  <button className="btn small" type="button" style={{ marginTop: 10 }} onClick={() => copyKey(order.license_key)}>
                    {copied === order.license_key ? "Đã sao chép" : "Sao chép key"}
                  </button>
                </>
              ) : (
                <p style={{ color: "var(--muted)", marginBottom: 0 }}>
                  {order.status === "pending" ? "Đang chờ thanh toán hoặc xác nhận." : "Đơn đã huỷ."}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 48 }}>Đổi mật khẩu</h2>
      <form className="panel" onSubmit={changePassword} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <label>
          Mật khẩu hiện tại
          <input
            type="password"
            value={passwords.current_password}
            onChange={(event) => setPasswords({ ...passwords, current_password: event.target.value })}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          Mật khẩu mới
          <input
            type="password"
            value={passwords.new_password}
            onChange={(event) => setPasswords({ ...passwords, new_password: event.target.value })}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Đang lưu..." : "Đổi mật khẩu"}
        </button>
        {passwordMessage ? (
          <div className={`notice ${passwordMessage.type}`} role={passwordMessage.type === "error" ? "alert" : "status"}>
            {passwordMessage.text}
          </div>
        ) : null}
      </form>
    </section>
  );
}
