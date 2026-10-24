import BuyButton from "@/components/BuyButton";
import { PLANS, formatVnd } from "@/lib/plans";

export default function HomePage() {
  const plans = Object.values(PLANS);
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">License chính hãng</div>
          <h1>Mở khoá <span>Telegram</span> và trí tuệ nhân tạo cho LiteNVR.</h1>
          <p className="lead">
            LiteNVR Pro giúp camera an ninh tự mô tả người, xe, hành động bằng tiếng Việt,
            gửi ảnh hoặc video ngắn qua Telegram và tìm lại sự kiện bằng câu mô tả.
          </p>
          <div className="cta-row">
            <a className="btn primary" href="#pricing">Xem bảng giá</a>
            <a className="btn" href="/auth?next=/%23pricing">Tạo tài khoản</a>
            <a className="btn" href="#activate">Đã có key? Kích hoạt</a>
          </div>
        </div>
        <aside className="hero-card">
          <h2>Tính năng Pro</h2>
          <ul className="check-list">
            <li>Mô tả mỗi snapshot bằng AI tiếng Việt</li>
            <li>Gửi Telegram kèm ảnh hoặc clip ngắn</li>
            <li>Tìm sự kiện theo mô tả: “người áo đỏ”, “xe tải”</li>
            <li>Một key dùng cho một thiết bị LiteNVR</li>
            <li>Dùng thử 1 ngày, gói 7 ngày hoặc vĩnh viễn</li>
          </ul>
        </aside>
      </section>

      <section id="pricing">
        <div className="section-head">
          <h2>Bảng giá</h2>
          <p>Dùng thử miễn phí 1 ngày. Tạo tài khoản bằng email hoặc số điện thoại, không cần OTP.</p>
        </div>
        <div className="plans">
          {plans.map((plan, index) => (
            <article className={`plan${index === plans.length - 1 ? " featured" : ""}`} key={plan.id}>
              {plan.badge ? <span className="plan-badge">{plan.badge}</span> : null}
              <h3>{plan.name}</h3>
              <div className="price">
                {formatVnd(plan.price)} <small>/ {plan.period}</small>
              </div>
              <ul>
                <li>Đầy đủ tính năng Telegram + AI</li>
                <li>Không giới hạn số camera trên thiết bị</li>
                <li>Gia hạn bằng key mới hoặc hỗ trợ cộng ngày</li>
                <li>Dùng offline tối đa 7 ngày nếu mất mạng</li>
              </ul>
              <BuyButton plan={plan} featured={index === plans.length - 1} />
            </article>
          ))}
        </div>
      </section>

      <section id="activate">
        <div className="section-head">
          <h2>Kích hoạt trong LiteNVR</h2>
          <p>Key được gắn với “Mã cài đặt” của từng thiết bị để tránh dùng chung.</p>
        </div>
        <div className="activate-grid">
          <div className="panel">
            <h3>Các bước</h3>
            <ol>
              <li>Mở LiteNVR → Cài đặt → <b>Bản quyền</b>.</li>
              <li>Sao chép <b>Mã cài đặt</b> (installation ID).</li>
              <li>Nhập license key và bấm <b>Kích hoạt</b>.</li>
              <li>Bật lại Telegram và mô tả AI sau khi trạng thái chuyển xanh.</li>
            </ol>
          </div>
          <div className="panel">
            <h3>Cần chuyển máy?</h3>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              Gửi mã cài đặt cũ và mới cho quản trị viên. Hệ thống sẽ gỡ liên kết thiết bị cũ
              trước khi kích hoạt lại. Không chia sẻ license key công khai.
            </p>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              License server: <span className="code">/api/license/activate</span>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
