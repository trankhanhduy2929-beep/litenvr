"use client";

import { useState } from "react";

export default function AuthClient({ next }) {
  const [mode, setMode] = useState("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đăng nhập được");
      window.location.href = data.account?.role === "admin" ? "/admin" : next;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 520, margin: "30px auto" }}>
      <div className="eyebrow">Tài khoản LiteNVR</div>
      <h1 style={{ fontSize: "clamp(34px, 6vw, 50px)" }}>
        {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Chỉ cần email hoặc số điện thoại và mật khẩu. Không cần OTP.
      </p>

      <div className="auth-tabs" role="tablist" aria-label="Đăng nhập hoặc tạo tài khoản">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          className={`btn small${mode === "login" ? " primary" : ""}`}
          onClick={() => { setMode("login"); setError(""); }}
        >
          Đăng nhập
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={`btn small${mode === "register" ? " primary" : ""}`}
          onClick={() => { setMode("register"); setError(""); }}
        >
          Tạo tài khoản
        </button>
      </div>

      <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Email hoặc số điện thoại
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="ban@example.com hoặc 0912345678"
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
            placeholder="Tối thiểu 8 ký tự"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
        </button>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          {mode === "login"
            ? "Chưa có tài khoản? Bấm Tạo tài khoản ở trên."
            : "Mỗi tài khoản chỉ được dùng thử miễn phí 1 ngày một lần."}
        </p>
      </form>
    </section>
  );
}
