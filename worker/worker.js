var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-RMP-API-Key, X-RMP-Staff-Token, X-Sync-Key"
};
function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}
__name(json, "json");
function isAuthorized(request, env) {
  const key = request.headers.get("X-RMP-API-Key");
  return Boolean(env.RMP_API_SECRET && key && key === env.RMP_API_SECRET);
}
function isSyncAuthorized(request, env) {
  const key = request.headers.get("X-Sync-Key");
  return Boolean(env.SYNC_KEY && key && key === env.SYNC_KEY);
}
__name(isAuthorized, "isAuthorized");
var DATA_TABLES = /* @__PURE__ */ new Set([
  "app_settings",
  "attendance",
  "customer_calls",
  "customers",
  "email_recipients",
  "invoices",
  "item_description",
  "kitchen_section_categories",
  "kitchen_sections",
  "menu_items",
  "menu_schedule_category_tags",
  "menu_schedule_group_time_slots",
  "menu_schedule_groups",
  "menu_schedule_item_tags",
  "menu_schedules",
  "modifiers",
  "order_item_add_requests",
  "order_items",
  "orders",
  "profiles",
  "shift_closures",
  "system_settings"
]);
var PUBLIC_READ_TABLES = /* @__PURE__ */ new Set(["menu_items", "menu_schedules", "menu_schedule_groups", "menu_schedule_group_time_slots", "menu_schedule_category_tags", "menu_schedule_item_tags", "modifiers", "item_description", "app_settings", "kitchen_sections", "kitchen_section_categories"]);
var CUSTOMER_BRIDGE_TABLES = /* @__PURE__ */ new Set(["customers", "orders", "order_items", "order_item_add_requests", "customer_calls", "invoices"]);
var ident = /* @__PURE__ */ __name((x) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(x || "")) ? String(x) : null, "ident");
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(b64url, "b64url");
async function staffToken(env, user) {
  const exp = Date.now() + 12 * 60 * 60 * 1e3;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ id: user.id, email: user.email, role: user.role, exp })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.RMP_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return payload + "." + b64url(sig);
}
__name(staffToken, "staffToken");
async function validStaff(request, env) {
  try {
    const tok = request.headers.get("X-RMP-Staff-Token") || "";
    const [payload, sig] = tok.split(".");
    if (!payload || !sig || !env.RMP_API_SECRET) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.RMP_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const raw = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((sig.length + 3) % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", key, raw, new TextEncoder().encode(payload));
    if (!ok) return false;
    const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4)), (c) => c.charCodeAt(0))));
    return Number(obj.exp) > Date.now();
  } catch {
    return false;
  }
}
__name(validStaff, "validStaff");
function cleanRow(row) {
  if (row && typeof row === "object") {
    const x = { ...row };
    delete x.password;
    return x;
  }
  return row;
}
__name(cleanRow, "cleanRow");
function parseSelectColumns(sel) {
  if (!sel || sel === "*") return "*";
  const cols = String(sel).split(",").map((x) => x.trim().split(/[ (]/)[0]).filter(Boolean);
  if (!cols.length || cols.some((c) => !ident(c))) return "*";
  return cols.join(",");
}
__name(parseSelectColumns, "parseSelectColumns");
function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
__name(positiveInteger, "positiveInteger");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "RMP POS API", status: "running" });
      }
      if (url.pathname === "/api/db-test" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT COUNT(*) AS total_menu_items,
                 SUM(CASE WHEN image_url IS NOT NULL AND TRIM(image_url) <> '' THEN 1 ELSE 0 END) AS items_with_images
          FROM menu_items
        `).first();
        return json({
          ok: true,
          database: "rmp_soloutions",
          total_menu_items: result?.total_menu_items ?? 0,
          items_with_images: result?.items_with_images ?? 0
        });
      }
      if (url.pathname === "/api/menu" && request.method === "GET") {
        const category = url.searchParams.get("category");
        const available = url.searchParams.get("available");
        let sql = `SELECT * FROM menu_items WHERE 1 = 1`;
        const params = [];
        if (category) {
          sql += ` AND category = ?`;
          params.push(category);
        }
        if (available === "1" || available === "true") {
          sql += ` AND is_available = 1`;
        }
        sql += `
          ORDER BY COALESCE(category_sort_order, 999999),
                   category,
                   COALESCE(item_sort_order, 999999),
                   id
        `;
        const stmt = env.DB.prepare(sql);
        const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
        return json({
          ok: true,
          count: result.results?.length ?? 0,
          items: result.results ?? []
        });
      }
      if (/^\/api\/menu\/\d+$/.test(url.pathname) && request.method === "GET") {
        const id = positiveInteger(url.pathname.split("/").pop());
        if (!id) return json({ ok: false, error: "Invalid menu item ID" }, 400);
        const item = await env.DB.prepare(`
          SELECT * FROM menu_items WHERE id = ? LIMIT 1
        `).bind(id).first();
        if (!item) return json({ ok: false, error: "Menu item not found" }, 404);
        return json({ ok: true, item });
      }
      if (/^\/api\/admin\/menu\/\d+\/availability$/.test(url.pathname) && request.method === "PATCH") {
        if (!isAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const id = positiveInteger(url.pathname.split("/")[4]);
        if (!id) return json({ ok: false, error: "Invalid menu item ID" }, 400);
        const body = await request.json();
        if (typeof body.is_available !== "boolean") {
          return json({ ok: false, error: "is_available must be true or false" }, 400);
        }
        const result = await env.DB.prepare(`
          UPDATE menu_items SET is_available = ? WHERE id = ?
        `).bind(body.is_available ? 1 : 0, id).run();
        if (!result.meta?.changes) {
          return json({ ok: false, error: "Menu item not found" }, 404);
        }
        return json({ ok: true, id, is_available: body.is_available });
      }
      if (/^\/api\/admin\/menu\/\d+$/.test(url.pathname) && request.method === "PATCH") {
        if (!isAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const id = positiveInteger(url.pathname.split("/").pop());
        if (!id) return json({ ok: false, error: "Invalid menu item ID" }, 400);
        const body = await request.json();
        const allowedFields = [
          "name_en",
          "name_ms",
          "name_en_us",
          "name_bn",
          "name_hi",
          "name_ta",
          "name_ar",
          "name_zh",
          "category",
          "category_ms",
          "category_en_us",
          "category_bn",
          "category_hi",
          "category_ta",
          "category_ar",
          "category_zh",
          "dine_in_price",
          "takeaway_price",
          "translations",
          "image_url",
          "kitchen_section_id",
          "is_popular",
          "is_available",
          "sold_quantity",
          "translation_status",
          "translation_source_hash",
          "translated_at",
          "translation_error",
          "category_sort_order",
          "item_sort_order",
          "source_type",
          "source_item_id"
        ];
        const updates = [];
        const values = [];
        for (const field of allowedFields) {
          if (Object.prototype.hasOwnProperty.call(body, field)) {
            updates.push(`${field} = ?`);
            if (field === "is_available" || field === "is_popular") {
              values.push(body[field] ? 1 : 0);
            } else {
              values.push(body[field]);
            }
          }
        }
        if (!updates.length) {
          return json({ ok: false, error: "No valid fields supplied" }, 400);
        }
        values.push(id);
        const result = await env.DB.prepare(`
          UPDATE menu_items SET ${updates.join(", ")} WHERE id = ?
        `).bind(...values).run();
        if (!result.meta?.changes) {
          return json({ ok: false, error: "Menu item not found or not updated" }, 404);
        }
        const item = await env.DB.prepare(`
          SELECT * FROM menu_items WHERE id = ?
        `).bind(id).first();
        return json({ ok: true, item });
      }
      if (url.pathname === "/api/auth/staff-login" && request.method === "POST") {
        const b = await request.json();
        const email = String(b.email || "").trim();
        const password = String(b.password || "");
        if (!email || !password) {
          return json({ ok: false, error: "Email and password are required" }, 400);
        }
        const user = await env.DB.prepare(`
          SELECT id, full_name, name, email, password, role, phone,
                 passport, passport_number, employment_id, joining_date,
                 created_at, updated_at
          FROM profiles
          WHERE lower(email) = lower(?)
          LIMIT 1
        `).bind(email).first();
        if (!user || String(user.password ?? "") !== password) {
          return json({ ok: false, error: "Invalid email or password" }, 401);
        }
        if (!env.RMP_API_SECRET) {
          return json({ ok: false, error: "Staff session secret is not configured" }, 500);
        }
        const safeUser = cleanRow(user);
        const token = await staffToken(env, safeUser);
        return json({ ok: true, user: safeUser, token });
      }
      if (url.pathname === "/api/auth/customer-login" && request.method === "POST") {
        const b = await request.json();
        const user = await env.DB.prepare(`SELECT * FROM customers WHERE lower(email)=lower(?) AND password=? LIMIT 1`).bind(String(b.email || "").trim(), String(b.password || "")).first();
        if (!user) return json({ ok: false, error: "Invalid email or password" }, 401);
        return json({ ok: true, user: cleanRow(user) });
      }
      // ViZPOS -> D1 sync API. Protected separately with SYNC_KEY.
      if (url.pathname === "/api/sync/menu" && request.method === "GET") {
        if (!isSyncAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
        const result = await env.DB.prepare(`
          SELECT id, name_en, category, dine_in_price, takeaway_price,
                 is_available, source_type, source_item_id
          FROM menu_items
          ORDER BY id ASC
        `).all();
        return json({ ok: true, count: result.results?.length ?? 0, items: result.results ?? [] });
      }

      if (url.pathname === "/api/sync/menu" && request.method === "POST") {
        if (!isSyncAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
        const b = await request.json();
        const sourceType = String(b.source_type || "vizposfnb").trim();
        const sourceItemId = Number(b.source_item_id);
        const nameEn = String(b.name_en || "").trim();
        const category = String(b.category || "").trim();
        const dine = Number(b.dine_in_price ?? 0);
        const take = Number(b.takeaway_price ?? 0);
        const forceUnavailable = b.force_unavailable === true || Number(b.is_available) === 0;

        if (!sourceType || !Number.isInteger(sourceItemId) || sourceItemId <= 0 || !nameEn) {
          return json({ ok: false, error: "Invalid source_type, source_item_id, or name_en" }, 400);
        }
        if (!Number.isFinite(dine) || !Number.isFinite(take)) {
          return json({ ok: false, error: "Invalid price" }, 400);
        }

        const existing = await env.DB.prepare(`
          SELECT id, is_available
          FROM menu_items
          WHERE source_type = ? AND source_item_id = ?
          LIMIT 1
        `).bind(sourceType, sourceItemId).first();

        if (existing) {
          return json({ ok: false, error: "source_item_id already exists", id: existing.id }, 409);
        }

        const result = await env.DB.prepare(`
          INSERT INTO menu_items
            (name_en, category, dine_in_price, takeaway_price, is_available, source_type, source_item_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id, name_en, category, dine_in_price, takeaway_price, is_available, source_type, source_item_id
        `).bind(
          nameEn, category, dine, take, forceUnavailable ? 0 : 1, sourceType, sourceItemId
        ).first();

        return json({ ok: true, item: result }, 201);
      }

      if (/^\/api\/sync\/menu\/\d+$/.test(url.pathname) && request.method === "PATCH") {
        if (!isSyncAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
        const id = positiveInteger(url.pathname.split("/").pop());
        if (!id) return json({ ok: false, error: "Invalid D1 menu ID" }, 400);
        const b = await request.json();
        const updates = [];
        const values = [];

        if (Object.prototype.hasOwnProperty.call(b, "name_en")) { updates.push("name_en = ?"); values.push(String(b.name_en ?? "").trim()); }
        if (Object.prototype.hasOwnProperty.call(b, "category")) { updates.push("category = ?"); values.push(String(b.category ?? "").trim()); }
        if (Object.prototype.hasOwnProperty.call(b, "dine_in_price")) { updates.push("dine_in_price = ?"); values.push(Number(b.dine_in_price)); }
        if (Object.prototype.hasOwnProperty.call(b, "takeaway_price")) { updates.push("takeaway_price = ?"); values.push(Number(b.takeaway_price)); }
        if (Object.prototype.hasOwnProperty.call(b, "source_type")) { updates.push("source_type = ?"); values.push(String(b.source_type || "vizposfnb")); }
        if (Object.prototype.hasOwnProperty.call(b, "source_item_id")) { updates.push("source_item_id = ?"); values.push(Number(b.source_item_id)); }
        // Availability is changed ONLY when PS1 explicitly sends force_unavailable=true.
        if (b.force_unavailable === true) { updates.push("is_available = ?"); values.push(0); }

        if (!updates.length) return json({ ok: true, changed: false });
        updates.push("updated_at = CURRENT_TIMESTAMP");
        values.push(id);

        const result = await env.DB.prepare(`UPDATE menu_items SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
        if (!result.meta?.changes) return json({ ok: false, error: "Menu item not found or not updated" }, 404);
        const item = await env.DB.prepare(`SELECT id, name_en, category, dine_in_price, takeaway_price, is_available, source_type, source_item_id FROM menu_items WHERE id = ?`).bind(id).first();
        return json({ ok: true, changed: true, item });
      }

      if (/^\/api\/sync\/menu\/\d+$/.test(url.pathname) && request.method === "DELETE") {
        if (!isSyncAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
        const id = positiveInteger(url.pathname.split("/").pop());
        if (!id) return json({ ok: false, error: "Invalid D1 menu ID" }, 400);
        const result = await env.DB.prepare(`DELETE FROM menu_items WHERE id = ? AND source_type = 'vizposfnb'`).bind(id).run();
        return json({ ok: true, deleted: (result.meta?.changes ?? 0) > 0 });
      }

      if (url.pathname === "/api/data" && request.method === "POST") {
        const b = await request.json();
        const table = ident(b.table);
        const op = String(b.operation || "select");
        if (!table || !DATA_TABLES.has(table)) return json({ ok: false, error: "Table not allowed" }, 400);
        const staff = await validStaff(request, env);
        if (!staff && op === "select" && !PUBLIC_READ_TABLES.has(table) && !CUSTOMER_BRIDGE_TABLES.has(table)) return json({ ok: false, error: "Staff login required" }, 401);
        if (!staff && op !== "select" && !CUSTOMER_BRIDGE_TABLES.has(table)) return json({ ok: false, error: "Staff login required" }, 401);
        const filters = Array.isArray(b.filters) ? b.filters : [];
        const vals = [];
        const where = [];
        for (const f of filters) {
          const c = ident(f.column);
          if (!c) return json({ ok: false, error: "Invalid filter column" }, 400);
          const o = String(f.op || "eq");
          if (o === "eq") {
            where.push(`${c} = ?`);
            vals.push(f.value);
          } else if (o === "neq") {
            where.push(`${c} <> ?`);
            vals.push(f.value);
          } else if (o === "gte") {
            where.push(`${c} >= ?`);
            vals.push(f.value);
          } else if (o === "lte") {
            where.push(`${c} <= ?`);
            vals.push(f.value);
          } else if (o === "ilike") {
            where.push(`lower(${c}) LIKE lower(?)`);
            vals.push(f.value);
          } else if (o === "in") {
            const a = Array.isArray(f.value) ? f.value : [];
            if (!a.length) {
              where.push("1=0");
            } else {
              where.push(`${c} IN (${a.map(() => "?").join(",")})`);
              vals.push(...a);
            }
          } else if (o === "is") {
            if (f.value === null) where.push(`${c} IS NULL`);
            else {
              where.push(`${c} IS ?`);
              vals.push(f.value);
            }
          } else if (o === "not") {
            if (f.extra === "is" && f.value === null) where.push(`${c} IS NOT NULL`);
            else {
              where.push(`${c} <> ?`);
              vals.push(f.value);
            }
          }
        }
        const W = where.length ? ` WHERE ${where.join(" AND ")}` : "";
        if (op === "select") {
          let sql = `SELECT ${parseSelectColumns(b.select)} FROM ${table}${W}`;
          const orders = Array.isArray(b.orders) ? b.orders : [];
          if (orders.length) {
            const oo = orders.map((o) => {
              const c = ident(o.column);
              return c ? `${c} ${o.ascending === false ? "DESC" : "ASC"}` : null;
            }).filter(Boolean);
            if (oo.length) sql += ` ORDER BY ${oo.join(",")}`;
          }
          const lim = Math.min(Math.max(Number(b.limit) || 500, 1), 2e3);
          sql += ` LIMIT ${lim}`;
          const r = await env.DB.prepare(sql).bind(...vals).all();
          let rows = (r.results || []).map(cleanRow);
          if (b.mode === "single") {
            if (rows.length !== 1) return json({ ok: false, error: "Expected one row" }, 406);
            return json({ ok: true, data: rows[0] });
          }
          if (b.mode === "maybeSingle") return json({ ok: true, data: rows[0] || null });
          return json({ ok: true, data: rows, count: rows.length });
        }
        const payload = Array.isArray(b.payload) ? b.payload : [b.payload || {}];
        if (op === "insert" || op === "upsert") {
          const out = [];
          for (const row of payload) {
            const keys = Object.keys(row).filter(ident);
            if (!keys.length) continue;
            const q = keys.map(() => "?").join(",");
            const verb = op === "upsert" ? "INSERT OR REPLACE" : "INSERT";
            const rr = await env.DB.prepare(`${verb} INTO ${table} (${keys.join(",")}) VALUES (${q}) RETURNING *`).bind(...keys.map((k) => typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k])).first();
            out.push(cleanRow(rr));
          }
          return json({ ok: true, data: b.mode === "single" ? out[0] || null : out });
        }
        if (op === "update") {
          const row = b.payload || {};
          const keys = Object.keys(row).filter(ident);
          if (!keys.length) return json({ ok: false, error: "No fields" }, 400);
          const set = keys.map((k) => `${k}=?`).join(",");
          const vv = keys.map((k) => typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k]);
          const r = await env.DB.prepare(`UPDATE ${table} SET ${set}${W} RETURNING *`).bind(...vv, ...vals).all();
          const rows = (r.results || []).map(cleanRow);
          return json({ ok: true, data: b.mode === "single" ? rows[0] || null : rows });
        }
        if (op === "delete") {
          const r = await env.DB.prepare(`DELETE FROM ${table}${W} RETURNING *`).bind(...vals).all();
          return json({ ok: true, data: (r.results || []).map(cleanRow) });
        }
        return json({ ok: false, error: "Operation not allowed" }, 400);
      }
      if (url.pathname === "/api/storage/upload" && request.method === "POST") {
        if (!await validStaff(request, env)) return json({ ok: false, error: "Staff login required" }, 401);
        const fd = await request.formData();
        const file = fd.get("file");
        let path = String(fd.get("path") || "").replace(/^\/+/, "").replace(/\.\./g, "");
        if (!file || !path) return json({ ok: false, error: "File/path required" }, 400);
        await env.MENU_IMAGES.put(path, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" } });
        return json({ ok: true, data: { path } });
      }
      if (url.pathname === "/api/storage/remove" && request.method === "POST") {
        if (!await validStaff(request, env)) return json({ ok: false, error: "Staff login required" }, 401);
        const b = await request.json();
        const paths = (Array.isArray(b.paths) ? b.paths : []).map((x) => String(x).replace(/^\/+/, "").replace(/\.\./g, ""));
        if (paths.length) await env.MENU_IMAGES.delete(paths);
        return json({ ok: true, data: { removed: paths.length } });
      }
      if (url.pathname === "/api/customer/orders" && request.method === "POST") {
        const body = await request.json();
        const customerId = Number(body.customer_id);
        const customerName = String(body.customer_name || "").trim();
        const customerPhone = String(body.customer_phone || "").trim();
        const orderType = String(body.order_type || "").trim();
        const section = body.section == null ? null : String(body.section).trim();
        const tableId = body.table_id == null ? null : String(body.table_id).trim();
        const tableNo = body.table_no == null ? null : String(body.table_no).trim();
        const subtotal = String(body.subtotal ?? "0");
        const sstTax = String(body.sst_tax ?? "0");
        const totalAmount = Number(body.total_amount);
        const orderNote = body.order_note == null ? null : String(body.order_note);
        const items = Array.isArray(body.items) ? body.items : [];
        if (!Number.isInteger(customerId) || customerId <= 0) {
          return json({ ok: false, error: "Customer login is required." }, 400);
        }
        if (!customerName) {
          return json({ ok: false, error: "Customer name is required." }, 400);
        }
        if (!orderType) {
          return json({ ok: false, error: "Order type is required." }, 400);
        }
        if (!Number.isFinite(totalAmount) || totalAmount < 0) {
          return json({ ok: false, error: "Invalid total amount." }, 400);
        }
        if (!items.length) {
          return json({ ok: false, error: "Order cart is empty." }, 400);
        }
        const customer = await env.DB.prepare(`
          SELECT id FROM customers WHERE id = ? LIMIT 1
        `).bind(customerId).first();
        if (!customer) {
          return json({ ok: false, error: "Customer not found." }, 404);
        }
        for (const item of items) {
          const menuItemId = Number(item.menu_item_id);
          const quantity = Number(item.quantity ?? 1);
          const price = Number(item.price);
          if (!Number.isInteger(menuItemId) || menuItemId <= 0 || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
            return json({ ok: false, error: "Invalid order item." }, 400);
          }
        }
        const uniqueMenuIds = [...new Set(items.map((i) => Number(i.menu_item_id)))];
        const placeholders = uniqueMenuIds.map(() => "?").join(",");
        const menuCheck = await env.DB.prepare(`
          SELECT id FROM menu_items WHERE id IN (${placeholders})
        `).bind(...uniqueMenuIds).all();
        const existingIds = new Set(
          (menuCheck.results || []).map((row) => Number(row.id))
        );
        for (const id of uniqueMenuIds) {
          if (!existingIds.has(id)) {
            return json({ ok: false, error: `Menu item ${id} not found.` }, 400);
          }
        }
        const orderInsert = await env.DB.prepare(`
          INSERT INTO orders (
            customer_id, customer_name, customer_phone,
            order_type, section, table_id, table_no,
            status, payment_status,
            subtotal, sst_tax, total_amount, order_note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, ?, ?, ?)
          RETURNING id
        `).bind(
          customerId,
          customerName,
          customerPhone || null,
          orderType,
          section,
          tableId,
          tableNo,
          subtotal,
          sstTax,
          totalAmount,
          orderNote
        ).first();
        const orderId = Number(orderInsert?.id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          throw new Error("Order ID could not be created.");
        }
        const itemStatements = items.map((item) => {
          let modifiers = item.modifiers ?? [];
          if (typeof modifiers !== "string") modifiers = JSON.stringify(modifiers);
          return env.DB.prepare(`
            INSERT INTO order_items (
              order_id, menu_item_id, price, quantity, modifiers
            )
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            orderId,
            Number(item.menu_item_id),
            Number(item.price),
            Number(item.quantity ?? 1),
            modifiers
          );
        });
        try {
          if (itemStatements.length) await env.DB.batch(itemStatements);
        } catch (err) {
          await env.DB.prepare(`DELETE FROM orders WHERE id = ?`).bind(orderId).run();
          throw err;
        }
        return json({
          ok: true,
          order_id: orderId,
          status: "pending",
          payment_status: "unpaid"
        }, 201);
      }
      if (url.pathname === "/api/orders" && request.method === "GET") {
        if (!isAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const status = url.searchParams.get("status");
        const paymentStatus = url.searchParams.get("payment_status");
        const tableId = url.searchParams.get("table_id");
        let sql = `SELECT * FROM orders WHERE 1 = 1`;
        const params = [];
        if (status) {
          sql += ` AND status = ?`;
          params.push(status);
        }
        if (paymentStatus) {
          sql += ` AND payment_status = ?`;
          params.push(paymentStatus);
        }
        if (tableId) {
          sql += ` AND table_id = ?`;
          params.push(tableId);
        }
        sql += ` ORDER BY created_at DESC, id DESC LIMIT 500`;
        const stmt = env.DB.prepare(sql);
        const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
        return json({
          ok: true,
          count: result.results?.length ?? 0,
          orders: result.results ?? []
        });
      }
      if (/^\/api\/orders\/\d+\/items$/.test(url.pathname) && request.method === "GET") {
        if (!isAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const orderId = positiveInteger(url.pathname.split("/")[3]);
        if (!orderId) return json({ ok: false, error: "Invalid order ID" }, 400);
        const order = await env.DB.prepare(`
          SELECT id FROM orders WHERE id = ? LIMIT 1
        `).bind(orderId).first();
        if (!order) return json({ ok: false, error: "Order not found" }, 404);
        const result = await env.DB.prepare(`
          SELECT oi.*, mi.name_en, mi.category, mi.image_url
          FROM order_items oi
          LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
          WHERE oi.order_id = ?
          ORDER BY oi.id
        `).bind(orderId).all();
        return json({
          ok: true,
          count: result.results?.length ?? 0,
          items: result.results ?? []
        });
      }
      if (/^\/api\/orders\/\d+$/.test(url.pathname) && request.method === "GET") {
        if (!isAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const orderId = positiveInteger(url.pathname.split("/").pop());
        if (!orderId) return json({ ok: false, error: "Invalid order ID" }, 400);
        const order = await env.DB.prepare(`
          SELECT * FROM orders WHERE id = ? LIMIT 1
        `).bind(orderId).first();
        if (!order) return json({ ok: false, error: "Order not found" }, 404);
        const items = await env.DB.prepare(`
          SELECT oi.*, mi.name_en, mi.category, mi.image_url
          FROM order_items oi
          LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
          WHERE oi.order_id = ?
          ORDER BY oi.id
        `).bind(orderId).all();
        return json({ ok: true, order, items: items.results ?? [] });
      }
      if (/^\/api\/orders\/\d+$/.test(url.pathname) && request.method === "PATCH") {
        if (!isAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        const orderId = positiveInteger(url.pathname.split("/").pop());
        if (!orderId) return json({ ok: false, error: "Invalid order ID" }, 400);
        const body = await request.json();
        const allowedFields = [
          "status",
          "payment_status",
          "customer_name",
          "customer_phone",
          "section",
          "table_id",
          "table_no",
          "subtotal",
          "sst_tax",
          "total_amount",
          "decline_reason",
          "order_note",
          "accepted_by_id",
          "accepted_by_name",
          "accepted_by_email",
          "accepted_by_role",
          "accepted_at",
          "declined_by_id",
          "declined_by_name",
          "declined_by_email",
          "declined_by_role",
          "declined_at",
          "cancelled_by_id",
          "cancelled_by_name",
          "cancelled_by_email",
          "cancelled_by_role",
          "cancelled_at",
          "cancel_reason"
        ];
        const updates = [];
        const values = [];
        for (const field of allowedFields) {
          if (Object.prototype.hasOwnProperty.call(body, field)) {
            updates.push(`${field} = ?`);
            values.push(body[field]);
          }
        }
        if (!updates.length) {
          return json({ ok: false, error: "No valid fields supplied" }, 400);
        }
        values.push(orderId);
        const result = await env.DB.prepare(`
          UPDATE orders SET ${updates.join(", ")} WHERE id = ?
        `).bind(...values).run();
        if (!result.meta?.changes) {
          return json({ ok: false, error: "Order not found or not updated" }, 404);
        }
        const order = await env.DB.prepare(`
          SELECT * FROM orders WHERE id = ?
        `).bind(orderId).first();
        return json({ ok: true, order });
      }
      return json({ ok: false, error: "Route not found" }, 404);
    } catch (error) {
      return json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
