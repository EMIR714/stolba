const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const STORE_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const STORE_FILE = path.join(STORE_DIR, "store.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_SIZE = 5 * 1024 * 1024;
const sessions = new Map();

fs.mkdirSync(STORE_DIR, { recursive: true });

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") return { users: [], assets: [] };
    throw error;
  }
}

let store = readStore();

function saveStore() {
  const temporaryFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, STORE_FILE);
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = crypto.scryptSync(password, user.salt, 64);
  const saved = Buffer.from(user.passwordHash, "hex");
  return saved.length === candidate.length && crypto.timingSafeEqual(candidate, saved);
}

function getSession(request) {
  const cookie = request.headers.cookie || "";
  const token = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("session="))?.slice("session=".length);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_MAX_AGE;
  return { token, user: store.users.find((user) => user.id === session.userId) };
}

function requireUser(request, response) {
  const session = getSession(request);
  if (!session?.user) {
    sendJson(response, 401, { error: "Требуется войти в систему." });
    return null;
  }
  return session;
}

function requireAdmin(session, response) {
  if (session.user.role !== "admin") {
    sendJson(response, 403, { error: "Недостаточно прав для этого действия." });
    return false;
  }
  return true;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (body === null) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        body = null;
        reject(Object.assign(new Error("Запрос слишком большой."), { status: 413 }));
      }
    });
    request.on("end", () => {
      if (body === null) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Некорректный JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function requiredText(value, label, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw Object.assign(new Error(`Проверьте поле «${label}».`), { status: 400 });
  }
  return value.trim();
}

function validateEmail(value) {
  const email = requiredText(value, "электронная почта", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Введите корректный адрес электронной почты."), { status: 400 });
  }
  return email;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw Object.assign(new Error("Пароль должен содержать не менее 8 символов."), { status: 400 });
  }
  return value;
}

function createUser(name, email, password, role) {
  const { salt, hash } = hashPassword(password);
  return {
    id: crypto.randomUUID(),
    name,
    email,
    role,
    salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
}

function createAsset(body, user) {
  const kind = body.kind;
  if (!["pole", "substation"].includes(kind)) {
    throw Object.assign(new Error("Выберите тип объекта."), { status: 400 });
  }
  const asset = {
    id: crypto.randomUUID(),
    kind,
    number: requiredText(body.number, "номер объекта", 100),
    location: requiredText(body.location, "адрес или координаты", 300),
    diagram: typeof body.diagram === "string" ? body.diagram.trim().slice(0, 1000) : "",
    installedAt: typeof body.installedAt === "string" ? body.installedAt.slice(0, 10) : "",
    createdAt: new Date().toISOString(),
    createdBy: user.id,
    entries: [],
  };
  return asset;
}

function createEntry(body, user) {
  if (!["repair", "defect"].includes(body.type)) {
    throw Object.assign(new Error("Выберите тип записи."), { status: 400 });
  }
  const date = requiredText(body.date, "дату", 10);
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error("Укажите корректную дату."), { status: 400 });
  }
  const photos = body.photos === undefined ? [] : body.photos;
  if (!Array.isArray(photos) || photos.length > 5 || photos.some((photo) =>
    typeof photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(photo) ||
    photo.length > 1_500_000
  )) {
    throw Object.assign(new Error("Добавьте не более 5 фотографий в формате JPG, PNG или WebP."), { status: 400 });
  }
  return {
    id: crypto.randomUUID(),
    type: body.type,
    date,
    description: requiredText(body.description, "описание", 2000),
    executor: requiredText(body.executor, "исполнителя", 200),
    status: body.type === "defect"
      ? (["open", "in_progress", "closed"].includes(body.status) ? body.status : "open")
      : "",
    photos,
    authorId: user.id,
    createdAt: new Date().toISOString(),
  };
}

function findAsset(id) {
  return store.assets.find((asset) => asset.id === id);
}

function getBaseUrl(request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = request.headers.host;
  if (!host || /[\s/\\]/.test(host)) {
    throw Object.assign(new Error("Не удалось определить адрес сайта."), { status: 400 });
  }
  return `${request.socket.encrypted ? "https" : "http"}://${host}`;
}

async function handleApi(request, response, url) {
  const route = url.pathname;

  if (request.method === "GET" && route === "/api/setup-status") {
    return sendJson(response, 200, { required: store.users.length === 0 });
  }

  if (request.method === "POST" && route === "/api/setup") {
    if (store.users.length) return sendJson(response, 409, { error: "Настройка уже выполнена." });
    const body = await readJson(request);
    if (store.users.length) return sendJson(response, 409, { error: "Настройка уже выполнена." });
    const user = createUser(
      requiredText(body.name, "имя", 100),
      validateEmail(body.email),
      validatePassword(body.password),
      "admin",
    );
    store.users.push(user);
    saveStore();
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_MAX_AGE });
    return sendJson(response, 201, { user: publicUser(user) }, {
      "Set-Cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}`,
    });
  }

  if (request.method === "POST" && route === "/api/login") {
    const body = await readJson(request);
    const email = validateEmail(body.email);
    const user = store.users.find((candidate) => candidate.email === email);
    if (!user || typeof body.password !== "string" || body.password.length > 200 ||
        !verifyPassword(body.password, user)) {
      return sendJson(response, 401, { error: "Неверная почта или пароль." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_MAX_AGE });
    return sendJson(response, 200, { user: publicUser(user) }, {
      "Set-Cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}`,
    });
  }

  if (request.method === "POST" && route === "/api/logout") {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
  }

  const session = requireUser(request, response);
  if (!session) return;

  if (request.method === "GET" && route === "/api/me") {
    return sendJson(response, 200, { user: publicUser(session.user) });
  }

  if (request.method === "GET" && route === "/api/assets") {
    const assets = store.assets.map((asset) => ({
      ...asset,
      entries: asset.entries.map(({ photos, authorId, ...entry }) => ({
        ...entry,
        authorName: store.users.find((user) => user.id === authorId)?.name || "Пользователь",
        photosCount: photos.length,
      })),
    }));
    return sendJson(response, 200, { assets });
  }

  if (request.method === "POST" && route === "/api/assets") {
    if (!requireAdmin(session, response)) return;
    const asset = createAsset(await readJson(request), session.user);
    store.assets.unshift(asset);
    saveStore();
    return sendJson(response, 201, { asset });
  }

  if (request.method === "GET" && route === "/api/users") {
    if (!requireAdmin(session, response)) return;
    return sendJson(response, 200, { users: store.users.map(publicUser) });
  }

  if (request.method === "POST" && route === "/api/users") {
    if (!requireAdmin(session, response)) return;
    const body = await readJson(request);
    const email = validateEmail(body.email);
    if (store.users.some((user) => user.email === email)) {
      return sendJson(response, 409, { error: "Пользователь с такой почтой уже существует." });
    }
    const user = createUser(
      requiredText(body.name, "имя", 100),
      email,
      validatePassword(body.password),
      "viewer",
    );
    store.users.push(user);
    saveStore();
    return sendJson(response, 201, { user: publicUser(user) });
  }

  const assetRoute = route.match(/^\/api\/assets\/([0-9a-f-]+)(?:\/(qr\.svg|entries))?$/i);
  if (assetRoute) {
    const asset = findAsset(assetRoute[1]);
    if (!asset) return sendJson(response, 404, { error: "Объект не найден." });

    if (request.method === "GET" && !assetRoute[2]) {
      return sendJson(response, 200, {
        asset: {
          ...asset,
          entries: asset.entries.map((entry) => ({
            ...entry,
            authorName: store.users.find((user) => user.id === entry.authorId)?.name || "Пользователь",
          })),
        },
      });
    }

    if (request.method === "GET" && assetRoute[2] === "qr.svg") {
      if (!requireAdmin(session, response)) return;
      const code = await QRCode.toString(`${getBaseUrl(request)}/?asset=${encodeURIComponent(asset.id)}`, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
      });
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="qr-${asset.id}.svg"`,
      });
      return response.end(code);
    }

    if (request.method === "POST" && assetRoute[2] === "entries") {
      const entry = createEntry(await readJson(request), session.user);
      asset.entries.unshift(entry);
      saveStore();
      return sendJson(response, 201, { entry: { ...entry, photosCount: entry.photos.length } });
    }
  }

  return sendJson(response, 404, { error: "Страница не найдена." });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      return response.end("Not found");
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET" || request.method === "HEAD") {
      serveStatic(request, response, url);
    } else {
      sendJson(response, 405, { error: "Метод не поддерживается." });
    }
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    if (error.status) return sendJson(response, error.status, { error: error.message });
    console.error(error);
    return sendJson(response, 500, { error: "Внутренняя ошибка сервера." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QR-паспорта доступны: http://${HOST}:${server.address().port}`);
});
