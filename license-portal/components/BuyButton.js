"use client";

import { useState } from "react";

export default function BuyButton({ plan, featured }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const isFree = Number(plan.price) <= 0;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.id }),
      });
      const data = await response.json();
      if (response.status === 401) {
        window.location.href = `/auth?next=${encodeURIComponent("/#pricing")}`;
        return;
      }
      if (!response.ok) throw new Error(data.error || "Không tạo được đơn hàng");
      if (data.status === "payos" && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      setMessage({ type: "ok", data });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <button className={featured ? "btn primary" : "btn"} type="submit" disabled={loading}>
        {loading ? "Đang tạo..." : isFree ? "Nhận key dùng thử" : "Thanh toán"}
      </button>
      {message?.type === "error" ? (
        <div className="notice error" role="alert">{message.text}</div>
      ) : null}
      {message?.type === "ok" && message.data.status === "free" ? (
        <div className="notice ok" role="status">
          <strong>Key dùng thử {message.data.days} ngày</strong>
          <div className="code">{message.data.license_key}</div>
          <p>Mở LiteNVR → Cài đặt → Bản quyền, dán key và kích hoạt.</p>
          <p><a href="/account">Xem key trong tài khoản</a></p>
        </div>
      ) : null}
      {message?.type === "ok" && message.data.status !== "free" ? (
        <div className="notice ok" role="status">
          <strong>Đơn #{message.data.order_code}</strong>
          <p>Chuyển khoản <b>{new Intl.NumberFormat("vi-VN").format(message.data.amount)}đ</b> với nội dung:</p>
          <div className="code">{message.data.note}</div>
          {message.data.bank?.account ? (
            <p>
              {message.data.bank.name} · STK <b>{message.data.bank.account}</b>
              {message.data.bank.owner ? ` · ${message.data.bank.owner}` : ""}
            </p>
          ) : (
            <p>Chưa cấu hình thông tin ngân hàng. Liên hệ {message.data.support || "quản trị viên"}.</p>
          )}
          <p>Sau khi thanh toán, quản trị viên sẽ cấp key. Bạn có thể xem lại trong tài khoản.</p>
        </div>
      ) : null}
    </form>
  );
}
