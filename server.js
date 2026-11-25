const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ROOT_DIR = __dirname;
const STATS_FILE = path.join(ROOT_DIR, "stats.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

let pgPool = null;
let dbReadyPromise = null;

function initPostgres() {
  if (!DATABASE_URL) return null;
  if (dbReadyPromise) return dbReadyPromise;

  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  dbReadyPromise = (async () => {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS site_visits (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS site_orders (
        id SERIAL PRIMARY KEY,
        order_number TEXT,
        full_name TEXT,
        email TEXT,
        phone TEXT,
        package_type TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
        delivery_method TEXT NOT NULL,
        pickup_location TEXT,
        street TEXT,
        postal_code TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pgPool.query(`
      ALTER TABLE site_orders
        ADD COLUMN IF NOT EXISTS order_number TEXT,
        ADD COLUMN IF NOT EXISTS full_name TEXT,
        ADD COLUMN IF NOT EXISTS email TEXT,
        ADD COLUMN IF NOT EXISTS phone TEXT,
        ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS pickup_location TEXT,
        ADD COLUMN IF NOT EXISTS street TEXT,
        ADD COLUMN IF NOT EXISTS postal_code TEXT,
        ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
  })();

  return dbReadyPromise;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadLocalStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
      return {
        totalVisits: Number(parsed.totalVisits) || 0,
        uniqueVisitors: Array.isArray(parsed.uniqueVisitors) ? parsed.uniqueVisitors : [],
        dailyVisits: parsed.dailyVisits && typeof parsed.dailyVisits === "object" ? parsed.dailyVisits : {},
        totalOrders: Number(parsed.totalOrders) || 0,
        recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
      };
    }
  } catch (err) {
    console.error("Fout bij laden van stats.json:", err);
  }
  return {
    totalVisits: 0,
    uniqueVisitors: [],
    dailyVisits: {},
    totalOrders: 0,
    recentEvents: [],
  };
}

function saveLocalStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  cookieHeader.split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (key) {
      cookies[key] = decodeURIComponent(rest.join("="));
    }
  });
  return cookies;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function recordVisit(visitorId) {
  if (DATABASE_URL) {
    await initPostgres();
    await pgPool.query("INSERT INTO site_visits (visitor_id) VALUES ($1)", [visitorId]);
    const countRes = await pgPool.query("SELECT COUNT(*)::int AS total FROM site_visits");
    return countRes.rows[0].total;
  }

  const stats = loadLocalStats();
  const today = getTodayKey();
  stats.totalVisits += 1;
  stats.dailyVisits[today] = (stats.dailyVisits[today] || 0) + 1;
  if (!stats.uniqueVisitors.includes(visitorId)) {
    stats.uniqueVisitors.push(visitorId);
  }
  stats.recentEvents.unshift({
    type: "visit",
    timestamp: new Date().toISOString(),
  });
  stats.recentEvents = stats.recentEvents.slice(0, 25);
  saveLocalStats(stats);
  return stats.totalVisits;
}

async function recordOrder(orderData) {
  const {
    orderNumber = "",
    fullName = "",
    email = "",
    phone = "",
    packageType = "Kerstpakket",
    quantity = 1,
    totalPrice = 0,
    deliveryMethod = "pickup",
    pickupLocation = "",
    street = "",
    postalCode = "",
    notes = "",
  } = orderData;

  if (DATABASE_URL) {
    await initPostgres();
    await pgPool.query(
      `INSERT INTO site_orders (
        order_number, full_name, email, phone, package_type, quantity,
        total_price, delivery_method, pickup_location, street, postal_code, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        orderNumber,
        fullName,
        email,
        phone,
        packageType,
        quantity,
        totalPrice,
        deliveryMethod,
        pickupLocation,
        street,
        postalCode,
        notes,
      ]
    );
    const countRes = await pgPool.query("SELECT COUNT(*)::int AS total FROM site_orders");
    return countRes.rows[0].total;
  }

  const stats = loadLocalStats();
  stats.totalOrders += 1;
  stats.orders = Array.isArray(stats.orders) ? stats.orders : [];
  stats.orders.unshift({
    orderNumber,
    fullName,
    email,
    phone,
    packageType,
    quantity,
    totalPrice,
    deliveryMethod,
    pickupLocation,
    street,
    postalCode,
    notes,
    timestamp: new Date().toISOString(),
  });
  stats.orders = stats.orders.slice(0, 100);
  stats.recentEvents.unshift({
    type: "order",
    packageType,
    deliveryMethod,
    timestamp: new Date().toISOString(),
  });
  stats.recentEvents = stats.recentEvents.slice(0, 25);
  saveLocalStats(stats);
  return stats.totalOrders;
}

async function fetchStats() {
  if (DATABASE_URL) {
    await initPostgres();
    const [summaryRes, ordersRes, dailyRes, recentRes, ordersListRes] = await Promise.all([
      pgPool.query(`
        SELECT
          COUNT(*)::int AS "totalVisits",
          COUNT(DISTINCT visitor_id)::int AS "uniqueVisitors",
          COUNT(*) FILTER (WHERE visit_date = CURRENT_DATE)::int AS "visitsToday"
        FROM site_visits
      `),
      pgPool.query(`SELECT COUNT(*)::int AS "totalOrders" FROM site_orders`),
      pgPool.query(`
        SELECT TO_CHAR(visit_date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
        FROM site_visits
        GROUP BY visit_date
        ORDER BY visit_date DESC
        LIMIT 14
      `),
      pgPool.query(`
        SELECT type, "packageType", "deliveryMethod", timestamp
        FROM (
          SELECT 'visit' AS type, NULL::text AS "packageType", NULL::text AS "deliveryMethod", created_at AS timestamp
          FROM site_visits
          UNION ALL
          SELECT 'order' AS type, package_type AS "packageType", delivery_method AS "deliveryMethod", created_at AS timestamp
          FROM site_orders
        ) combined
        ORDER BY timestamp DESC
        LIMIT 20
      `),
      pgPool.query(`
        SELECT
          order_number AS "orderNumber",
          full_name AS "fullName",
          email,
          phone,
          package_type AS "packageType",
          quantity,
          total_price AS "totalPrice",
          delivery_method AS "deliveryMethod",
          pickup_location AS "pickupLocation",
          street,
          postal_code AS "postalCode",
          notes,
          created_at AS timestamp
        FROM site_orders
        ORDER BY created_at DESC
        LIMIT 50
      `),
    ]);

    const dailyVisits = {};
    dailyRes.rows.forEach((row) => {
      dailyVisits[row.day] = row.count;
    });

    return {
      totalVisits: summaryRes.rows[0]?.totalVisits || 0,
      uniqueVisitors: summaryRes.rows[0]?.uniqueVisitors || 0,
      visitsToday: summaryRes.rows[0]?.visitsToday || 0,
      totalOrders: ordersRes.rows[0]?.totalOrders || 0,
      dailyVisits,
      recentEvents: recentRes.rows,
      orders: ordersListRes.rows,
      storage: "neon-postgres",
    };
  }

  const stats = loadLocalStats();
  const today = getTodayKey();
  return {
    totalVisits: stats.totalVisits,
    uniqueVisitors: stats.uniqueVisitors.length,
    visitsToday: stats.dailyVisits[today] || 0,
    totalOrders: stats.totalOrders,
    dailyVisits: stats.dailyVisits,
    recentEvents: stats.recentEvents,
    orders: Array.isArray(stats.orders) ? stats.orders : [],
    storage: "local-json",
  };
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  try {
    if (req.method === "POST" && urlPath === "/api/visit") {
      const cookies = parseCookies(req.headers.cookie);
      let visitorId = cookies.mekanders_vid;
      const headers = {};

      if (!visitorId) {
        visitorId = crypto.randomUUID();
        headers["Set-Cookie"] = `mekanders_vid=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }

      const totalVisits = await recordVisit(visitorId);
      sendJson(res, 200, { ok: true, totalVisits }, headers);
      return;
    }

    if (req.method === "POST" && urlPath === "/api/order") {
      const body = await readJsonBody(req);
      const orderData = {
        orderNumber: String(body.orderNumber || "").slice(0, 40),
        fullName: String(body.fullName || "").slice(0, 120),
        email: String(body.email || "").slice(0, 150),
        phone: String(body.phone || "").slice(0, 50),
        packageType: String(body.packageType || "Kerstpakket").slice(0, 80),
        quantity: Math.max(1, Math.min(20, Number(body.quantity) || 1)),
        totalPrice: Number(body.totalPrice) || 0,
        deliveryMethod: String(body.deliveryMethod || "pickup").slice(0, 30),
        pickupLocation: String(body.pickupLocation || "").slice(0, 150),
        street: String(body.street || "").slice(0, 150),
        postalCode: String(body.postalCode || "").slice(0, 60),
        notes: String(body.notes || "").slice(0, 500),
      };
      const totalOrders = await recordOrder(orderData);
      sendJson(res, 200, { ok: true, totalOrders });
      return;
    }

    if (req.method === "GET" && urlPath === "/api/stats") {
      const data = await fetchStats();
      sendJson(res, 200, data);
      return;
    }
  } catch (err) {
    console.error("API fout:", err);
    sendJson(res, 500, { ok: false, error: "Serverfout" });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolvedPath = path.normalize(path.join(ROOT_DIR, safePath));

  if (
    !resolvedPath.startsWith(ROOT_DIR) ||
    ["stats.json", "server.js", "package.json", "package-lock.json", ".gitignore"].includes(
      path.basename(resolvedPath)
    )
  ) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Niet gevonden");
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Mekanders website draait op http://localhost:${PORT}`);
  console.log(`Opslagmodus: ${DATABASE_URL ? "Neon PostgreSQL" : "Lokaal (stats.json)"}`);
});
