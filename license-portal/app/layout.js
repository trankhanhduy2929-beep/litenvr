import "./globals.css";

export const metadata = {
  title: "LiteNVR Pro - Bản quyền",
  description: "Mua và kích hoạt license LiteNVR Pro cho Telegram và mô tả sự kiện AI.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <header className="site-header">
          <a className="brand" href="/">
            Lite<span>NVR</span> <small>Pro</small>
          </a>
          <nav aria-label="Điều hướng chính">
            <a href="/#pricing">Bảng giá</a>
            <a href="/account">Tài khoản</a>
            <a href="/#activate">Kích hoạt</a>
            <a href="/admin">Quản trị</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <span>LiteNVR Pro · License server</span>
          <a href={process.env.NEXT_PUBLIC_LITENVR_URL || "#"}>Tài liệu LiteNVR</a>
        </footer>
      </body>
    </html>
  );
}
