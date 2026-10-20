import QRCode from "qrcode";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const STORE_KEY = "qr-passport-demo-store";
const SESSION_KEY = "qr-passport-demo-user";
const DEMO_ASSET_ID = "demo-pole-001";

function initialDemoStore() {
  return {
    users: [
      { id: "demo-admin", name: "Администратор демо", email: "admin@demo.ru", password: "demo1234", role: "admin" },
      { id: "demo-specialist", name: "Специалист демо", email: "worker@demo.ru", password: "demo1234", role: "viewer" },
    ],
    assets: [
      {
        id: DEMO_ASSET_ID,
        kind: "pole",
        number: "О-148",
        location: "ул. Центральная, 12 · 55.7558, 37.6173",
        diagram: "Линия 4 · фидер Ф-12 · схема участка 3",
        installedAt: "2018-06-15",
        createdAt: "2024-06-15T09:00:00.000Z",
        createdBy: "demo-admin",
        entries: [
          {
            id: "demo-entry-1",
            type: "repair",
            date: "2026-08-12",
            description: "Проведён плановый осмотр опоры, проверены крепления и изоляторы.",
            executor: "Бригада № 2",
            status: "",
            photos: [],
            authorId: "demo-specialist",
            authorName: "Специалист демо",
            createdAt: "2026-08-12T10:00:00.000Z",
          },
          {
            id: "demo-entry-2",
            type: "defect",
            date: "2026-09-03",
            description: "Обнаружено повреждение защитного покрытия у основания опоры.",
            executor: "Иван Петров",
            status: "in_progress",
            photos: [],
            authorId: "demo-specialist",
            authorName: "Специалист демо",
            createdAt: "2026-09-03T10:00:00.000Z",
          },
        ],
      },
      {
        id: "demo-substation-001",
        kind: "substation",
        number: "ТП-024",
        location: "ул. Энергетиков, 8 · участок Северный",
        diagram: "ТП-024 · трансформатор ТМГ-400 · схема 7-Б",
        installedAt: "2020-03-20",
        createdAt: "2024-06-15T09:00:00.000Z",
        createdBy: "demo-admin",
        entries: [
          {
            id: "demo-entry-3",
            type: "repair",
            date: "2026-07-21",
            description: "Выполнен осмотр трансформаторной подстанции и проверка уровня масла.",
            executor: "Энергоучасток Северный",
            status: "",
            photos: [],
            authorId: "demo-specialist",
            authorName: "Специалист демо",
            createdAt: "2026-07-21T10:00:00.000Z",
          },
        ],
      },
    ],
  };
}

function readDemoStore() {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved) return JSON.parse(saved);
  const initial = initialDemoStore();
  localStorage.setItem(STORE_KEY, JSON.stringify(initial));
  return initial;
}

function writeDemoStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function currentDemoUser(store = readDemoStore()) {
  const userId = localStorage.getItem(SESSION_KEY);
  return store.users.find((user) => user.id === userId) || null;
}

const icons = {
  logo: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 2 5 13h6l-.5 9L19 10h-6l.5-8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  pole: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v18m-6-15 12 3m-12 3 12-3M8 21l4-6 4 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  substation: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20V9l8-5 8 5v11H4Zm0-8h16M9 20v-5h6v5m-5-8v-2m4 2v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

let currentUser = null;
let assets = [];
let currentAssetId = null;
let selectedPhotos = [];
let toastTimeout;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2800);
}

async function api(url, options = {}) {
  const route = new URL(url, window.location.origin).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  const store = readDemoStore();
  const user = currentDemoUser(store);
  const result = (value) => value;
  const error = (message) => { throw new Error(message); };
  const requireUser = () => user || error("Требуется войти в систему.");
  const requireAdmin = () => {
    requireUser();
    if (user.role !== "admin") error("Недостаточно прав для этого действия.");
  };

  if (route === "/api/setup-status") return result({ required: false });
  if (route === "/api/login" && options.method === "POST") {
    const candidate = store.users.find((entry) => entry.email === String(body.email || "").toLowerCase());
    if (!candidate || candidate.password !== body.password) error("Неверная почта или пароль.");
    localStorage.setItem(SESSION_KEY, candidate.id);
    return result({ user: publicDemoUser(candidate) });
  }
  if (route === "/api/me") return result({ user: publicDemoUser(requireUser()) });
  if (route === "/api/logout") {
    localStorage.removeItem(SESSION_KEY);
    return result({ ok: true });
  }
  if (route === "/api/assets") {
    if (options.method === "POST") {
      requireAdmin();
      const asset = {
        id: crypto.randomUUID(),
        kind: body.kind,
        number: String(body.number || "").trim(),
        location: String(body.location || "").trim(),
        diagram: String(body.diagram || "").trim(),
        installedAt: body.installedAt || "",
        createdAt: new Date().toISOString(),
        createdBy: user.id,
        entries: [],
      };
      if (!["pole", "substation"].includes(asset.kind) || !asset.number || !asset.location) {
        error("Проверьте тип объекта, номер и адрес.");
      }
      store.assets.unshift(asset);
      writeDemoStore(store);
      return result({ asset });
    }
    requireUser();
    return result({ assets: store.assets });
  }
  if (route === "/api/users") {
    requireAdmin();
    if (options.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      if (store.users.some((entry) => entry.email === email)) error("Пользователь с такой почтой уже существует.");
      if (!email.includes("@") || String(body.password || "").length < 8) {
        error("Укажите корректную почту и пароль не короче 8 символов.");
      }
      const addedUser = {
        id: crypto.randomUUID(),
        name: String(body.name || "").trim(),
        email,
        password: body.password,
        role: "viewer",
      };
      store.users.push(addedUser);
      writeDemoStore(store);
      return result({ user: publicDemoUser(addedUser) });
    }
    return result({ users: store.users.map(publicDemoUser) });
  }

  const assetRoute = route.match(/^\/api\/assets\/([a-z0-9-]+)(?:\/(entries))?$/i);
  if (assetRoute) {
    requireUser();
    const asset = store.assets.find((entry) => entry.id === assetRoute[1]);
    if (!asset) error("Объект не найден.");
    if (assetRoute[2] === "entries" && options.method === "POST") {
      const entry = {
        id: crypto.randomUUID(),
        type: body.type,
        date: body.date,
        description: String(body.description || "").trim(),
        executor: String(body.executor || "").trim(),
        status: body.type === "defect" ? body.status : "",
        photos: Array.isArray(body.photos) ? body.photos : [],
        authorId: user.id,
        authorName: user.name,
        createdAt: new Date().toISOString(),
      };
      if (!["repair", "defect"].includes(entry.type) || !entry.date || !entry.description || !entry.executor) {
        error("Заполните дату, описание и исполнителя.");
      }
      asset.entries.unshift(entry);
      writeDemoStore(store);
      return result({ entry });
    }
    return result({ asset });
  }
  error("Страница не найдена.");
}

function publicDemoUser(user) {
  const { password, ...safeUser } = user;
  return safeUser;
}
function brandMarkup() {
  return `<div class="brand"><span class="brand-mark">${icons.logo}</span><span>опора</span></div>`;
}

function renderAuth(isSetup = false) {
  app.innerHTML = `
    <div class="auth-shell">
      <section class="auth-visual">
        ${brandMarkup()}
        <div class="hero-copy">
          <div class="eyebrow">Управление электросетевой инфраструктурой</div>
          <h1>Вся история<br>объекта —<br>в одном коде.</h1>
          <p>Сканируйте QR-код на опоре или подстанции, чтобы открыть паспорт объекта и историю его обслуживания.</p>
          <div class="hero-facts">
            <div class="hero-fact"><strong>Опоры и ТП</strong><span>Единый реестр</span></div>
            <div class="hero-fact"><strong>Ремонты и дефекты</strong><span>История работ</span></div>
          </div>
        </div>
        <div class="auth-foot">Цифровой паспорт оборудования</div>
      </section>
      <section class="auth-panel">
        <form class="auth-card" id="auth-form">
          <h2>${isSetup ? "Создайте администратора" : "С возвращением"}</h2>
          <p>${isSetup ? "Настройте доступ к системе. Этот аккаунт получит права администратора." : "Войдите, чтобы открыть паспорта объектов и журнал работ."}</p>
          <div class="form-error" id="auth-error"></div>
          ${isSetup ? `<div class="form-field"><label for="name">Ваше имя</label><input id="name" name="name" autocomplete="name" required maxlength="100" placeholder="Например, Алексей Иванов"></div>` : ""}
          <div class="form-field"><label for="email">Электронная почта</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="name@company.ru"></div>
          <div class="form-field"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="${isSetup ? "new-password" : "current-password"}" required minlength="${isSetup ? "8" : "1"}" maxlength="200" placeholder="${isSetup ? "Не менее 8 символов" : "Введите пароль"}"></div>
          <button class="button full" type="submit">${isSetup ? "Создать администратора" : "Войти в систему"}</button>
          ${!isSetup ? `<div class="demo-credentials"><strong>Демо-доступ</strong><span>Администратор: admin@demo.ru · demo1234</span><span>Специалист: worker@demo.ru · demo1234</span><small>Данные сохраняются только в этом браузере и не видны другим посетителям. QR-коды новых объектов открываются только в этом же браузере.</small></div>` : ""}
        </form>
      </section>
    </div>`;
  document.querySelector("#auth-form").addEventListener("submit", submitAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const setup = form.querySelector("#name") !== null;
  const payload = Object.fromEntries(new FormData(form));
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = setup ? "Создаём аккаунт…" : "Входим…";
  try {
    const result = await api(setup ? "/api/setup" : "/api/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentUser = result.user;
    await loadAssets();
    renderApp();
    openAssetFromUrl();
  } catch (error) {
    const box = document.querySelector("#auth-error");
    box.textContent = error.message;
    box.classList.add("visible");
    button.disabled = false;
    button.textContent = setup ? "Создать администратора" : "Войти в систему";
  }
}

async function loadAssets() {
  const result = await api("/api/assets");
  assets = result.assets;
}

async function boot() {
  app.innerHTML = '<div class="loading">Загружаем систему…</div>';
  try {
    const setup = await api("/api/setup-status");
    if (setup.required) {
      renderAuth(true);
      return;
    }
    try {
      const result = await api("/api/me");
      currentUser = result.user;
      await loadAssets();
      renderApp();
      openAssetFromUrl();
    } catch (error) {
      if (error.message !== "Требуется войти в систему.") throw error;
      renderAuth();
    }
  } catch (error) {
    app.innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
  }
}

function renderApp() {
  const activeAsset = assets.find((asset) => asset.id === currentAssetId);
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        ${brandMarkup()}
        <div class="top-actions">
          <div class="user-chip"><div class="avatar">${escapeHtml(currentUser.name.slice(0, 1).toUpperCase())}</div><div class="user-meta"><strong>${escapeHtml(currentUser.name)}</strong><span>${currentUser.role === "admin" ? "Администратор" : "Специалист"}</span></div></div>
          <button class="button ghost" id="logout-button" type="button">Выйти</button>
        </div>
      </header>
      <div id="page-content">${activeAsset ? detailMarkup(activeAsset) : dashboardMarkup()}</div>
    </div>`;

  document.querySelector("#logout-button").addEventListener("click", logout);
  if (activeAsset) bindDetail(activeAsset);
  else bindDashboard();
}

function dashboardMarkup() {
  const query = new URLSearchParams(window.location.search).get("q") || "";
  return `
    <main class="main-content">
      <div class="page-heading">
        <div><h1>Паспорта объектов</h1><p>Реестр оборудования и его технического состояния</p></div>
        <div class="heading-actions">
          ${currentUser.role === "admin" ? '<button class="button secondary" id="users-button" type="button">Пользователи</button><button class="button" id="add-asset-button" type="button">＋ Добавить объект</button>' : ""}
        </div>
      </div>
      <div class="stats-row" id="stats-row"></div>
      <div class="toolbar">
        <div class="search-box">${icons.search}<input id="search-input" type="search" placeholder="Поиск по номеру или адресу" value="${escapeHtml(query)}"></div>
        <select class="filter-select" id="kind-filter" aria-label="Тип объекта">
          <option value="all">Все типы объектов</option><option value="pole">Опоры</option><option value="substation">Подстанции</option>
        </select>
        <select class="filter-select" id="state-filter" aria-label="Состояние">
          <option value="all">Любое состояние</option><option value="open">Есть дефекты</option><option value="clear">Без открытых дефектов</option>
        </select>
      </div>
      <div class="asset-grid" id="asset-grid"></div>
    </main>`;
}

function assetKindLabel(kind) {
  return kind === "substation" ? "Трансформаторная подстанция" : "Опора";
}

function assetIcon(kind) {
  return `<span class="asset-icon">${kind === "substation" ? icons.substation : icons.pole}</span>`;
}

function defectEntries(asset) {
  return asset.entries.filter((entry) => entry.type === "defect");
}

function openDefects(asset) {
  return defectEntries(asset).filter((entry) => entry.status !== "closed");
}

function renderDashboardAssets() {
  const search = document.querySelector("#search-input").value.trim().toLowerCase();
  const kind = document.querySelector("#kind-filter").value;
  const state = document.querySelector("#state-filter").value;
  const filtered = assets.filter((asset) => {
    const textMatches = `${asset.number} ${asset.location}`.toLowerCase().includes(search);
    const kindMatches = kind === "all" || asset.kind === kind;
    const stateMatches = state === "all" || (state === "open" ? openDefects(asset).length > 0 : openDefects(asset).length === 0);
    return textMatches && kindMatches && stateMatches;
  });
  const stats = document.querySelector("#stats-row");
  stats.innerHTML = `
    <div class="stat-card"><span>Всего объектов</span><strong>${assets.length}</strong></div>
    <div class="stat-card"><span>Опоры</span><strong>${assets.filter((asset) => asset.kind === "pole").length}</strong></div>
    <div class="stat-card"><div class="stat-dot"><span>Открытые дефекты</span><i class="dot"></i></div><strong>${assets.reduce((total, asset) => total + openDefects(asset).length, 0)}</strong></div>`;
  const grid = document.querySelector("#asset-grid");
  grid.innerHTML = filtered.length ? filtered.map((asset) => `
    <article class="asset-card" tabindex="0" role="button" data-asset-id="${escapeHtml(asset.id)}" aria-label="${escapeHtml(`${assetKindLabel(asset.kind)} ${asset.number}`)}">
      <div class="asset-type"><span>${assetIcon(asset.kind)} ${escapeHtml(assetKindLabel(asset.kind))}</span>${openDefects(asset).length ? `<span class="status-badge open">${openDefects(asset).length} дефект(а)</span>` : ""}</div>
      <h3>${escapeHtml(asset.number)}</h3>
      <div class="asset-location">${escapeHtml(asset.location)}</div>
      <div class="card-divider"></div>
      <div class="card-bottom"><span class="entry-count">${asset.entries.length ? `${asset.entries.length} записей в истории` : "История пока пуста"}</span><span>Открыть →</span></div>
    </article>`).join("") : `
      <div class="empty-state">
        <div class="empty-icon">${icons.pole}</div>
        <h3>${assets.length ? "Ничего не найдено" : "Объектов пока нет"}</h3>
        <p>${assets.length ? "Измените параметры поиска или фильтр." : currentUser.role === "admin" ? "Добавьте первый объект, чтобы создать его цифровой паспорт." : "Администратор добавит объекты в реестр."}</p>
      </div>`;
  grid.querySelectorAll("[data-asset-id]").forEach((card) => {
    const open = () => navigateToAsset(card.dataset.assetId);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
    });
  });
}

function bindDashboard() {
  renderDashboardAssets();
  document.querySelector("#search-input").addEventListener("input", renderDashboardAssets);
  document.querySelector("#kind-filter").addEventListener("change", renderDashboardAssets);
  document.querySelector("#state-filter").addEventListener("change", renderDashboardAssets);
  document.querySelector("#add-asset-button")?.addEventListener("click", showAssetModal);
  document.querySelector("#users-button")?.addEventListener("click", showUsersModal);
}

async function navigateToAsset(id) {
  currentAssetId = id;
  const url = new URL(window.location.href);
  url.searchParams.set("asset", id);
  history.pushState({}, "", url);
  renderApp();
  await loadAssetDetails(id);
  renderApp();
  window.scrollTo(0, 0);
}

async function loadAssetDetails(id) {
  const result = await api(`/api/assets/${encodeURIComponent(id)}`);
  assets = assets.map((asset) => asset.id === id ? result.asset : asset);
}

function goToDashboard() {
  currentAssetId = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("asset");
  history.pushState({}, "", url);
  renderApp();
  window.scrollTo(0, 0);
}

async function openAssetFromUrl() {
  const requested = new URLSearchParams(window.location.search).get("asset");
  if (!requested || !currentUser) return;
  if (!assets.some((asset) => asset.id === requested)) {
    showToast("Объект из QR-кода не найден.");
    return;
  }
  currentAssetId = requested;
  try {
    await loadAssetDetails(requested);
  } catch (error) {
    showToast(error.message);
    currentAssetId = null;
  }
  renderApp();
}

window.addEventListener("popstate", () => {
  const id = new URLSearchParams(window.location.search).get("asset");
  currentAssetId = assets.some((asset) => asset.id === id) ? id : null;
  if (currentUser) renderApp();
});

function detailMarkup(asset) {
  const allEntries = [...asset.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return `
    <main class="main-content">
      <button class="detail-back" id="back-button" type="button">← Все объекты</button>
      <section class="detail-header">
        <div class="detail-title">${assetIcon(asset.kind)}<div><h1>${escapeHtml(asset.number)}</h1><p>${escapeHtml(assetKindLabel(asset.kind))} · ${escapeHtml(asset.location)}</p></div></div>
        <div class="detail-actions">
          ${currentUser.role === "admin" ? `<button class="button secondary" id="show-qr-button" type="button">▦ QR-код</button>` : ""}
          <button class="button" id="add-entry-button" type="button">＋ Добавить запись</button>
        </div>
      </section>
      <section class="info-grid">
        <div class="info-card"><span>Номер объекта</span><strong>${escapeHtml(asset.number)}</strong></div>
        <div class="info-card"><span>Адрес / координаты</span><strong>${escapeHtml(asset.location)}</strong></div>
        <div class="info-card"><span>Дата установки</span><strong>${asset.installedAt ? formatDate(asset.installedAt) : "Не указана"}</strong></div>
        <div class="info-card info-card-wide"><span>Схема сети</span><strong>${asset.diagram ? escapeHtml(asset.diagram) : "Не добавлена"}</strong></div>
      </section>
      <div class="section-heading"><h2>История обслуживания</h2><span>${allEntries.length} ${plural(allEntries.length, "запись", "записи", "записей")}</span></div>
      <section class="timeline" id="timeline">
        ${allEntries.length ? allEntries.map((entry) => entryMarkup(entry)).join("") : '<div class="empty-timeline">Здесь появятся записи о ремонтах и выявленных дефектах.</div>'}
      </section>
    </main>`;
}

function entryMarkup(entry) {
  const defect = entry.type === "defect";
  const statusLabel = { open: "Открыт", in_progress: "В работе", closed: "Устранён" }[entry.status];
  return `<article class="timeline-item">
    <div class="timeline-marker">${defect ? "!" : "✓"}</div>
    <div class="timeline-main">
      <div class="timeline-meta"><strong>${defect ? "Дефект" : "Ремонт"}</strong><time>${formatDate(entry.date)}</time></div>
      <p>${escapeHtml(entry.description)}</p>
      <div class="timeline-sub"><span>Исполнитель: ${escapeHtml(entry.executor)}</span><span>·</span><span>Добавил: ${escapeHtml(entry.authorName || "Пользователь")}</span></div>
      ${entry.photos?.length ? `<div class="photo-strip">${entry.photos.map((photo) => `<a href="${escapeHtml(photo)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть фото"><img class="photo-thumb" src="${escapeHtml(photo)}" alt="Фото к записи"></a>`).join("")}</div>` : ""}
    </div>
    ${defect ? `<span class="status-badge ${escapeHtml(entry.status)}">${statusLabel}</span>` : ""}
  </article>`;
}

function bindDetail(asset) {
  document.querySelector("#back-button").addEventListener("click", goToDashboard);
  document.querySelector("#add-entry-button").addEventListener("click", () => showEntryModal(asset));
  document.querySelector("#show-qr-button")?.addEventListener("click", () => showQrModal(asset));
}

function plural(count, one, few, many) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function openModal(markup, className = "") {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal ${className}" role="dialog" aria-modal="true">${markup}</section>`;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
  backdrop.querySelector(".close-button")?.addEventListener("click", () => backdrop.remove());
  return backdrop;
}

function showAssetModal() {
  const modal = openModal(`
    <div class="modal-header"><div><h2>Новый объект</h2><p>Добавьте оборудование в реестр.</p></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div>
    <form id="asset-form">
      <div class="form-error" id="modal-error"></div>
      <div class="form-field"><label for="kind">Тип объекта</label><select id="kind" name="kind" required><option value="pole">Опора</option><option value="substation">Трансформаторная подстанция</option></select></div>
      <div class="form-field"><label for="number">Номер объекта</label><input id="number" name="number" maxlength="100" required placeholder="Например, О-148"></div>
      <div class="form-field"><label for="location">Адрес или координаты</label><input id="location" name="location" maxlength="300" required placeholder="Улица, участок или координаты"></div>
      <div class="form-field"><label for="installedAt">Дата установки</label><input id="installedAt" name="installedAt" type="date"></div>
      <div class="form-field"><label for="diagram">Схема сети</label><textarea id="diagram" name="diagram" maxlength="1000" placeholder="Ссылка, обозначение или описание схемы"></textarea><span class="form-hint">В MVP можно сохранить ссылку или краткое описание схемы.</span></div>
      <div class="modal-footer"><button class="button ghost close-button" type="button">Отмена</button><button class="button" type="submit">Создать паспорт</button></div>
    </form>`);
  modal.querySelector("#asset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const result = await api("/api/assets", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      });
      assets.unshift(result.asset);
      modal.remove();
      renderApp();
      navigateToAsset(result.asset.id);
      showToast("Паспорт объекта создан.");
    } catch (error) {
      showModalError(modal, error.message);
      button.disabled = false;
    }
  });
}

function showEntryModal(asset) {
  selectedPhotos = [];
  const modal = openModal(`
    <div class="modal-header"><div><h2>Новая запись</h2><p>${escapeHtml(asset.number)} · ремонт или дефект</p></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div>
    <form id="entry-form">
      <div class="form-error" id="modal-error"></div>
      <div class="form-field"><label for="entry-type">Тип записи</label><select id="entry-type" name="type"><option value="repair">Ремонт / обслуживание</option><option value="defect">Дефект</option></select></div>
      <div class="form-field"><label for="entry-date">Дата</label><input id="entry-date" name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
      <div class="form-field"><label for="description">Описание работ или дефекта</label><textarea id="description" name="description" maxlength="2000" required placeholder="Опишите выполненные работы или обнаруженную неисправность"></textarea></div>
      <div class="form-field"><label for="executor">Исполнитель</label><input id="executor" name="executor" maxlength="200" required placeholder="ФИО или бригада"></div>
      <div class="form-field" id="defect-status-field" hidden><label for="status">Статус дефекта</label><select id="status" name="status"><option value="open">Открыт</option><option value="in_progress">В работе</option><option value="closed">Устранён</option></select></div>
      <div class="form-field"><label for="photos">Фотографии (до 5)</label><div class="photo-picker"><input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><div class="photo-preview" id="photo-preview"></div></div><span class="form-hint">Изображения автоматически уменьшатся перед сохранением.</span></div>
      <div class="modal-footer"><button class="button ghost close-button" type="button">Отмена</button><button class="button" type="submit">Сохранить запись</button></div>
    </form>`);
  modal.querySelector("#entry-type").addEventListener("change", (event) => {
    modal.querySelector("#defect-status-field").hidden = event.target.value !== "defect";
  });
  modal.querySelector("#photos").addEventListener("change", (event) => preparePhotos(event.target.files, modal));
  modal.querySelector("#entry-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.currentTarget));
    delete formData.photos;
    formData.photos = selectedPhotos;
    const button = event.currentTarget.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const result = await api(`/api/assets/${encodeURIComponent(asset.id)}/entries`, {
        method: "POST",
        body: JSON.stringify(formData),
      });
      const entry = result.entry;
          entry.photos = selectedPhotos;
      entry.authorName = currentUser.name;
      asset.entries.unshift(entry);
      modal.remove();
      renderApp();
      showToast("Запись добавлена в историю.");
    } catch (error) {
      showModalError(modal, error.message);
      button.disabled = false;
    }
  });
}

async function preparePhotos(files, modal) {
  const error = modal.querySelector("#modal-error");
  error.classList.remove("visible");
  if (files.length > 5) {
    showModalError(modal, "Можно добавить не более 5 фотографий.");
    modal.querySelector("#photos").value = "";
    return;
  }
  try {
    selectedPhotos = await Promise.all([...files].map((file) => resizeImage(file)));
    modal.querySelector("#photo-preview").innerHTML = selectedPhotos
      .map((photo) => `<img src="${photo}" alt="Предпросмотр фото">`).join("");
  } catch (problem) {
    selectedPhotos = [];
    showModalError(modal, problem.message);
    modal.querySelector("#photos").value = "";
  }
}

function resizeImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return Promise.reject(new Error("Поддерживаются JPG, PNG и WebP."));
  }
  if (file.size > 12 * 1024 * 1024) {
    return Promise.reject(new Error("Размер одного фото не должен превышать 12 МБ."));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
    reader.onload = () => { image.src = reader.result; };
    image.onerror = () => reject(new Error("Не удалось обработать изображение."));
    image.onload = () => {
      const scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.68));
    };
    reader.readAsDataURL(file);
  });
}

async function showQrModal(asset) {
  const qrUrl = new URL("/", window.location.origin);
  qrUrl.searchParams.set("asset", asset.id);
  const modal = openModal(`
    <div class="modal-header"><div><h2>QR-паспорт</h2><p>${escapeHtml(assetKindLabel(asset.kind))} · ${escapeHtml(asset.number)}</p></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div>
    <img class="qr-code" id="qr-image" alt="QR-код объекта ${escapeHtml(asset.number)}">
    <p class="qr-caption">QR ведёт на демонстрационный паспорт. Войдите с демо-аккаунтом, чтобы открыть карточку объекта.</p>
    <button class="button full" id="download-qr" type="button">Скачать QR-код (SVG)</button>`);
  modal.querySelector("#download-qr").addEventListener("click", async () => {
    try {
      const qr = await QRCode.toString(qrUrl.toString(), { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 });
      const blob = new Blob([qr], { type: "image/svg+xml" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `qr-${asset.number.replace(/[^a-z0-9-_]/gi, "-")}.svg`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { showToast(error.message); }
  });
  try {
    const qr = await QRCode.toString(qrUrl.toString(), { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 });
    modal.querySelector("#qr-image").src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`;
  } catch (error) {
    showModalError(modal, error.message);
  }
}

async function showUsersModal() {
  let users;
  try {
    users = (await api("/api/users")).users;
  } catch (error) {
    showToast(error.message);
    return;
  }
  const modal = openModal(`
    <div class="modal-header"><div><h2>Пользователи</h2><p>Создавайте доступ для специалистов.</p></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div>
    <form id="user-form">
      <div class="form-error" id="modal-error"></div>
      <div class="form-field"><label for="user-name">Имя</label><input id="user-name" name="name" maxlength="100" required placeholder="Имя специалиста"></div>
      <div class="form-field"><label for="user-email">Электронная почта</label><input id="user-email" name="email" type="email" maxlength="254" required placeholder="name@company.ru"></div>
      <div class="form-field"><label for="user-password">Временный пароль</label><input id="user-password" name="password" type="password" minlength="8" maxlength="200" required placeholder="Не менее 8 символов"></div>
      <div class="modal-footer"><button class="button" type="submit">Создать пользователя</button></div>
    </form>
    <div class="user-list">${users.map((user) => `<div class="user-row"><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)} · ${user.role === "admin" ? "Администратор" : "Просмотр и записи"}</span></div>`).join("")}</div>`);
  modal.querySelector("#user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const result = await api("/api/users", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      });
      const row = document.createElement("div");
      row.className = "user-row";
      const name = document.createElement("strong");
      name.textContent = result.user.name;
      const details = document.createElement("span");
      details.textContent = `${result.user.email} · Просмотр и записи`;
      row.append(name, details);
      modal.querySelector(".user-list").prepend(row);
      event.currentTarget.reset();
      showToast("Учётная запись создана.");
    } catch (error) {
      showModalError(modal, error.message);
      button.disabled = false;
    }
  });
}

function showModalError(modal, message) {
  const box = modal.querySelector("#modal-error");
  box.textContent = message;
  box.classList.add("visible");
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
    currentUser = null;
    assets = [];
    currentAssetId = null;
    renderAuth();
  } catch (error) { showToast(error.message); }
}

boot();
