export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only the sync client with the shared secret may use this API.
    const suppliedKey = request.headers.get("X-Sync-Key") || "";
    if (!env.SYNC_KEY || suppliedKey !== env.SYNC_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/menu") {
        const result = await env.DB.prepare(`
          SELECT
            id, name_en, category, dine_in_price, takeaway_price,
            is_available, source_type, source_item_id
          FROM menu_items
          ORDER BY id ASC
        `).all();

        return json(result.results || []);
      }

      if (request.method === "POST" && url.pathname === "/api/menu") {
        const body = await request.json();

        const sourceType = String(body.source_type ?? "vizposfnb");
        const sourceItemId = Number(body.source_item_id);
        const nameEn = String(body.name_en ?? "");
        const category = String(body.category ?? "");
        const dine = Number(body.dine_in_price ?? 0);
        const take = Number(body.takeaway_price ?? 0);
        const isAvailable = Number(body.is_available ?? 1) ? 1 : 0;

        if (!Number.isInteger(sourceItemId) || !nameEn.trim()) {
          return json({ error: "Invalid source_item_id or name_en" }, 400);
        }

        // Safety: do not create a duplicate managed source item.
        const existing = await env.DB.prepare(`
          SELECT id
          FROM menu_items
          WHERE source_type = ? AND source_item_id = ?
          LIMIT 1
        `).bind(sourceType, sourceItemId).first();

        if (existing) {
          return json({ error: "source_item_id already exists", id: existing.id }, 409);
        }

        const result = await env.DB.prepare(`
          INSERT INTO menu_items
            (name_en, category, dine_in_price, takeaway_price,
             is_available, source_type, source_item_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          nameEn,
          category,
          dine,
          take,
          isAvailable,
          sourceType,
          sourceItemId
        ).run();

        return json({
          ok: true,
          id: result.meta?.last_row_id ?? null
        }, 201);
      }

      const match = url.pathname.match(/^\/api\/menu\/(\d+)$/);

      if (match && request.method === "PATCH") {
        const id = Number(match[1]);
        const body = await request.json();

        const allowed = [
          "name_en",
          "category",
          "dine_in_price",
          "takeaway_price",
          "source_type",
          "source_item_id",
          "is_available"
        ];

        const sets = [];
        const values = [];

        for (const key of allowed) {
          if (Object.prototype.hasOwnProperty.call(body, key)) {
            sets.push(`${key} = ?`);
            values.push(body[key]);
          }
        }

        if (!sets.length) {
          return json({ ok: true, changed: false });
        }

        // Keep updated_at current without touching any other D1-only fields.
        sets.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);

        const result = await env.DB.prepare(`
          UPDATE menu_items
          SET ${sets.join(", ")}
          WHERE id = ?
        `).bind(...values).run();

        return json({
          ok: true,
          changed: (result.meta?.changes ?? 0) > 0
        });
      }

      if (match && request.method === "DELETE") {
        const id = Number(match[1]);

        const result = await env.DB.prepare(`
          DELETE FROM menu_items
          WHERE id = ?
        `).bind(id).run();

        return json({
          ok: true,
          deleted: (result.meta?.changes ?? 0) > 0
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({
        error: "Server error",
        message: String(err?.message || err)
      }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
