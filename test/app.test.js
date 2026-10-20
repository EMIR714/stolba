const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qr-passport-test-"));
let server;
let baseUrl;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
      cwd: projectRoot,
      env: { ...process.env, DATA_DIR: dataDir, HOST: "127.0.0.1", PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 5000);
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        baseUrl = `http://127.0.0.1:${match[1]}`;
        resolve();
      }
    });
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      if (!baseUrl) {
        clearTimeout(timeout);
        reject(new Error(`Server exited before startup (${code}): ${output}`));
      }
    });
  });
}

async function request(route, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  return {
    response,
    body: contentType.includes("application/json") ? await response.json() : await response.text(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

before(startServer);
after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("administrator and specialist can complete the QR passport workflow", async () => {
  const setupStatus = await request("/api/setup-status");
  assert.deepEqual(setupStatus.body, { required: true });

  const setup = await request("/api/setup", {
    method: "POST",
    body: { name: "Администратор", email: "admin@example.ru", password: "secure-test-pass" },
  });
  assert.equal(setup.response.status, 201);
  assert.equal(setup.body.user.role, "admin");
  const adminCookie = setup.cookie;

  const createdAsset = await request("/api/assets", {
    method: "POST",
    cookie: adminCookie,
    body: {
      kind: "pole",
      number: "О-148",
      location: "Улица Тестовая, 1",
      diagram: "Схема линии 4",
      installedAt: "2020-05-10",
    },
  });
  assert.equal(createdAsset.response.status, 201);
  const assetId = createdAsset.body.asset.id;

  const qr = await request(`/api/assets/${assetId}/qr.svg`, { cookie: adminCookie });
  assert.equal(qr.response.status, 200);
  assert.match(qr.response.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(qr.body, /<svg/);

  const createdUser = await request("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Специалист", email: "worker@example.ru", password: "worker-test-pass" },
  });
  assert.equal(createdUser.response.status, 201);
  assert.equal(createdUser.body.user.role, "viewer");
  const login = await request("/api/login", {
    method: "POST",
    body: { email: "worker@example.ru", password: "worker-test-pass" },
  });
  assert.equal(login.response.status, 200);

  const unauthorizedCreate = await request("/api/assets", {
    method: "POST",
    cookie: login.cookie,
    body: { kind: "pole", number: "О-149", location: "Вторая улица" },
  });
  assert.equal(unauthorizedCreate.response.status, 403);

  const entry = await request(`/api/assets/${assetId}/entries`, {
    method: "POST",
    cookie: login.cookie,
    body: {
      type: "defect",
      date: "2026-10-20",
      description: "Повреждена изоляция",
      executor: "Бригада 2",
      status: "in_progress",
      photos: ["data:image/jpeg;base64,AA=="],
    },
  });
  assert.equal(entry.response.status, 201);

  const detail = await request(`/api/assets/${assetId}`, { cookie: login.cookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.asset.entries[0].description, "Повреждена изоляция");
  assert.equal(detail.body.asset.entries[0].authorName, "Специалист");
  assert.equal(detail.body.asset.entries[0].photos.length, 1);

  const forbiddenQr = await request(`/api/assets/${assetId}/qr.svg`, { cookie: login.cookie });
  assert.equal(forbiddenQr.response.status, 403);
});
