import { batch, clearGuard, d1Enabled, getPool, guard, query } from "./db";
import { D1ConflictError } from "./d1";
import { generateLicenseKey } from "./license";
import { getPlan } from "./plans";

function expiryFor(plan) {
  if (!plan || plan.lifetime || Number(plan.days) <= 0) return null;
  return new Date(Date.now() + Number(plan.days) * 86400000);
}

async function currentOrder(orderCode) {
  const rows = await query(
    "SELECT id, order_code, plan, amount, status, license_key FROM orders WHERE order_code = ? LIMIT 1",
    [orderCode],
  );
  return rows[0] || null;
}

async function settleD1(orderCode, order, { amount, rawPayload, note }) {
  const expiresAt = expiryFor(getPlan(order.plan));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const licenseKey = generateLicenseKey();
    const statements = [
      guard("EXISTS(SELECT 1 FROM orders WHERE order_code = ? AND status != 'paid' AND amount = ?)", [
        orderCode,
        amount,
      ]),
      {
        sql: "INSERT INTO licenses (license_key, plan, expires_at, note) VALUES (?, ?, ?, ?)",
        params: [licenseKey, order.plan, expiresAt, note],
      },
      {
        sql: "UPDATE orders SET status = 'paid', license_key = ?, paid_at = ?, raw_payload = ? WHERE order_code = ? AND status != 'paid'",
        params: [licenseKey, new Date(), rawPayload, orderCode],
      },
      clearGuard,
    ];
    try {
      await batch(statements);
      return { status: "paid", licenseKey };
    } catch (error) {
      if (!(error instanceof D1ConflictError)) throw error;
      const latest = await currentOrder(orderCode);
      if (!latest) return { status: "missing" };
      if (latest.status === "paid") return { status: "duplicate", licenseKey: latest.license_key };
      if (Number(latest.amount) !== Number(amount)) return { status: "amount_mismatch" };
    }
  }
  throw new Error("Không tạo được license key");
}

async function settleMysql(orderCode, { amount, rawPayload, note }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const licenseKey = generateLicenseKey();
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        "SELECT id, plan, amount, status, license_key FROM orders WHERE order_code = ? FOR UPDATE",
        [orderCode],
      );
      const order = rows[0];
      if (!order) {
        await conn.rollback();
        return { status: "missing" };
      }
      if (order.status === "paid") {
        await conn.commit();
        return { status: "duplicate", licenseKey: order.license_key };
      }
      if (Number(amount) !== Number(order.amount)) {
        await conn.rollback();
        return { status: "amount_mismatch" };
      }
      await conn.execute(
        "INSERT INTO licenses (license_key, plan, expires_at, note) VALUES (?, ?, ?, ?)",
        [licenseKey, order.plan, expiryFor(getPlan(order.plan)), note],
      );
      await conn.execute(
        "UPDATE orders SET status = 'paid', license_key = ?, paid_at = ?, raw_payload = ? WHERE id = ?",
        [licenseKey, new Date(), rawPayload, order.id],
      );
      await conn.commit();
      return { status: "paid", licenseKey };
    } catch (error) {
      await conn.rollback();
      if (error?.code === "ER_DUP_ENTRY") continue;
      throw error;
    } finally {
      conn.release();
    }
  }
  throw new Error("Không tạo được license key");
}

export async function settlePayosOrder({ orderCode, amount, rawPayload }) {
  const order = await currentOrder(orderCode);
  if (!order) return { status: "missing" };
  if (order.status === "paid") return { status: "duplicate", licenseKey: order.license_key };
  if (Number(amount) !== Number(order.amount)) return { status: "amount_mismatch" };
  const options = {
    amount: order.amount,
    rawPayload: JSON.stringify(rawPayload),
    note: `PayOS order ${orderCode}`,
  };
  return d1Enabled()
    ? settleD1(orderCode, order, options)
    : settleMysql(orderCode, options);
}

async function markPaidD1(orderCode, order) {
  const expiresAt = expiryFor(getPlan(order.plan));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const licenseKey = generateLicenseKey();
    try {
      await batch([
        guard("EXISTS(SELECT 1 FROM orders WHERE order_code = ? AND status != 'paid')", [orderCode]),
        {
          sql: "INSERT INTO licenses (license_key, plan, expires_at, note) VALUES (?, ?, ?, ?)",
          params: [licenseKey, order.plan, expiresAt, `Manual order ${orderCode}`],
        },
        {
          sql: "UPDATE orders SET status = 'paid', license_key = ?, paid_at = ? WHERE order_code = ? AND status != 'paid'",
          params: [licenseKey, new Date(), orderCode],
        },
        clearGuard,
      ]);
      return { status: "paid", licenseKey };
    } catch (error) {
      if (!(error instanceof D1ConflictError)) throw error;
      const latest = await currentOrder(orderCode);
      if (!latest) return { status: "missing" };
      if (latest.status === "paid") return { status: "duplicate", licenseKey: latest.license_key };
    }
  }
  throw new Error("Không tạo được license key");
}

async function markPaidMysql(orderCode) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const licenseKey = generateLicenseKey();
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        "SELECT id, plan, status, license_key FROM orders WHERE order_code = ? FOR UPDATE",
        [orderCode],
      );
      const order = rows[0];
      if (!order) {
        await conn.rollback();
        return { status: "missing" };
      }
      if (order.status === "paid") {
        await conn.commit();
        return { status: "duplicate", licenseKey: order.license_key };
      }
      await conn.execute(
        "INSERT INTO licenses (license_key, plan, expires_at, note) VALUES (?, ?, ?, ?)",
        [licenseKey, order.plan, expiryFor(getPlan(order.plan)), `Manual order ${orderCode}`],
      );
      await conn.execute(
        "UPDATE orders SET status = 'paid', license_key = ?, paid_at = ? WHERE id = ?",
        [licenseKey, new Date(), order.id],
      );
      await conn.commit();
      return { status: "paid", licenseKey };
    } catch (error) {
      await conn.rollback();
      if (error?.code === "ER_DUP_ENTRY") continue;
      throw error;
    } finally {
      conn.release();
    }
  }
  throw new Error("Không tạo được license key");
}

export async function markOrderPaid(orderCode) {
  const order = await currentOrder(orderCode);
  if (!order) return { status: "missing" };
  if (order.status === "paid") return { status: "duplicate", licenseKey: order.license_key };
  return d1Enabled() ? markPaidD1(orderCode, order) : markPaidMysql(orderCode);
}
