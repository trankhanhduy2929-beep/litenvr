export default {
  async fetch(request, env) {
    const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!env.GATEWAY_SECRET || request.method !== "POST" || new URL(request.url).pathname !== "/batch") {
      return reply({ error: "not_found" }, 404);
    }
    const encoder = new TextEncoder();
    const expected = await crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${env.GATEWAY_SECRET}`));
    const actual = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(request.headers.get("authorization") || ""),
    );
    const left = new Uint8Array(expected);
    const right = new Uint8Array(actual);
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    if (difference) return reply({ error: "forbidden" }, 403);

    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "invalid_body" }, 400);
    let size = 0;
    const chunks = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 131072) {
        await reader.cancel();
        return reply({ error: "body_too_large" }, 413);
      }
      chunks.push(chunk.value);
    }

    let statements;
    try {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      statements = JSON.parse(new TextDecoder().decode(bytes)).statements;
      if (
        !Array.isArray(statements) ||
        !statements.length ||
        statements.length > 30 ||
        statements.some(
          (item) =>
            typeof item.sql !== "string" ||
            item.sql.length > 20000 ||
            (item.params && !Array.isArray(item.params)),
        )
      ) {
        throw new Error();
      }
    } catch {
      return reply({ error: "invalid_body" }, 400);
    }

    try {
      const results = await env.DB.batch(
        statements.map((item) => env.DB.prepare(item.sql).bind(...(item.params || []))),
      );
      return reply({ results: results.map((item) => ({ rows: item.results || [] })) });
    } catch (error) {
      if (/constraint/i.test(String(error))) return reply({ error: "transaction_conflict" }, 409);
      return reply({ error: "database_unavailable" }, 503);
    }
  },
};
