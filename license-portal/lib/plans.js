export const PLANS = {
  trial: {
    id: "trial",
    name: "Dùng thử",
    days: 1,
    period: "1 ngày",
    badge: "Miễn phí",
    price: 0,
  },
  weekly: {
    id: "weekly",
    name: "Gói 7 ngày",
    days: 7,
    period: "7 ngày",
    price: Number(process.env.NEXT_PUBLIC_PRICE_WEEKLY || 50000),
  },
  lifetime: {
    id: "lifetime",
    name: "Vĩnh viễn",
    days: 0,
    lifetime: true,
    period: "vĩnh viễn",
    badge: "Tiết kiệm",
    price: Number(process.env.NEXT_PUBLIC_PRICE_LIFETIME || 200000),
  },
};

export function getPlan(id) {
  return PLANS[String(id || "").toLowerCase()] || null;
}

export function formatVnd(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0)) + "đ";
}
