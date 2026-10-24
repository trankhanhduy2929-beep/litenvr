"use client";

import { useCallback, useEffect, useState } from "react";

export default function SuccessClient({ code }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!code) return;
    try {
      const response = await fetch(`/api/order?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không tải được đơn");
      setOrder(data);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [code]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function copyKey() {
    if (!order?.license_key) return;
    await navigator.clipboard.writeText(order.license_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="eyebrow">Đơn hàng</div>
      <h1 style={{ fontSize: "clamp(34px, 6vw, 54px)" }}>Cảm ơn bạn đã mua LiteNVR Pro.</h1>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {!code ? <div className="notice error">Thiếu mã đơn hàng.</div> : null}
      {order ? (
        <div className="panel" style={{ marginTop: 24 }}>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Mã đơn: <b style={{ color: "var(--text)" }}>#{order.order_code}</b> · Gói: <b style={{ color: "var(--text)" }}>{order.plan}</b>
          </p>
          {order.status === "paid" ? (
            <>
              <div className="notice ok" role="status">Thanh toán thành công. License key của bạn:</div>
              <div className="code" style={{ margin: "12px 0", fontSize: 18 }}>{order.license_key}</div>
              <button className="btn primary" onClick={copyKey} type="button">
                {copied ? "Đã sao chép" : "Sao chép key"}
              </button>
              <p style={{ color: "var(--muted)", marginBottom: 0 }}>
                Mở LiteNVR → Cài đặt → Bản quyền, dán key và bấm Kích hoạt.
              </p>
            </>
          ) : (
            <div className="notice" role="status">
              Đang chờ thanh toán. Trang tự cập nhật mỗi 5 giây. Nếu đã chuyển khoản thủ công,
              quản trị viên sẽ xác nhận và cấp key.
            </div>
          )}
        </div>
      ) : !error ? <p style={{ color: "var(--muted)" }}>Đang tải đơn hàng...</p> : null}
    </section>
  );
}
