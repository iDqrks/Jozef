const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
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

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadStats() {
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

function saveStats(stats) {
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

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "POST" && urlPath === "/api/visit") {
    const stats = loadStats();
    const cookies = parseCookies(req.headers.cookie);
    let visitorId = cookies.mekanders_vid;
    const headers = {};

    if (!visitorId) {
      visitorId = crypto.randomUUID();
      headers["Set-Cookie"] = `mekanders_vid=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }

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

    saveStats(stats);
    sendJson(res, 200, { ok: true, totalVisits: stats.totalVisits }, headers);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/order") {
    const body = await readJsonBody(req);
    const stats = loadStats();
    stats.totalOrders += 1;
    stats.recentEvents.unshift({
      type: "order",
      packageType: String(body.packageType || "Kerstpakket").slice(0, 80),
      deliveryMethod: String(body.deliveryMethod || "pickup").slice(0, 30),
      timestamp: new Date().toISOString(),
    });
    stats.recentEvents = stats.recentEvents.slice(0, 25);
    saveStats(stats);
    sendJson(res, 200, { ok: true, totalOrders: stats.totalOrders });
    return;
  }

  if (req.method === "GET" && urlPath === "/api/stats") {
    const stats = loadStats();
    const today = getTodayKey();
    sendJson(res, 200, {
      totalVisits: stats.totalVisits,
      uniqueVisitors: stats.uniqueVisitors.length,
      visitsToday: stats.dailyVisits[today] || 0,
      totalOrders: stats.totalOrders,
      dailyVisits: stats.dailyVisits,
      recentEvents: stats.recentEvents,
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolvedPath = path.normalize(path.join(ROOT_DIR, safePath));

  if (!resolvedPath.startsWith(ROOT_DIR) || path.basename(resolvedPath) === "stats.json" || path.basename(resolvedPath) === "server.js") {
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
  console.log(`Bezoekersstatistieken: http://localhost:${PORT}/stats.html`);
});
