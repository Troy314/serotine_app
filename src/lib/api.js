/**
 * api.js — thin fetch wrapper. Every call is same-origin (vite proxies
 * /api and /auth to the Express server in dev; in prod Express serves the
 * built frontend itself), and always sends the session cookie.
 */
async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (res.status === 204) return null;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (isJson && data?.error) || (typeof data === "string" && data) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body || {}) });
const put = (path, body) => request(path, { method: "PUT", body: JSON.stringify(body || {}) });
const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body || {}) });
const del = (path) => request(path, { method: "DELETE" });

export const api = {
  me: () => get("/auth/me"),
  logout: () => get("/auth/logout"),

  members: {
    list: () => get("/api/members"),
    create: (displayName) => post("/api/members", { displayName }),
    updateSelf: (body) => patch("/api/members/me", body),
    update: (id, body) => put(`/api/members/${id}`, body),
    mergeInto: (id, targetId) => post(`/api/members/${id}/merge-into/${targetId}`),
    remove: (id) => del(`/api/members/${id}`),
    importFromCoreDb: () => post("/api/members/core-sync/import", {}),
  },

  admin: {
    impersonatable: () => get("/api/admin/impersonatable"),
    impersonate: (id) => post(`/api/admin/impersonate/${id}`, {}),
    stopImpersonating: () => post("/api/admin/stop-impersonating", {}),
    impersonationLog: () => get("/api/admin/impersonation-log"),
  },

  topics: {
    list: () => get("/api/topics"),
    create: (body) => post("/api/topics", body),
    update: (id, body) => put(`/api/topics/${id}`, body),
    remove: (id) => del(`/api/topics/${id}`),
  },

  statusOptions: {
    list: (field) => get(`/api/bohr/status-options${field ? `?field=${encodeURIComponent(field)}` : ""}`),
    create: (body) => post("/api/bohr/status-options", body),
    update: (id, body) => put(`/api/bohr/status-options/${id}`, body),
    remove: (id) => del(`/api/bohr/status-options/${id}`),
  },

  bohr: {
    list: (season) => get(`/api/bohr/articles${season ? `?season=${encodeURIComponent(season)}` : ""}`),
    get: (id) => get(`/api/bohr/articles/${id}`),
    create: (body) => post("/api/bohr/articles", body),
    update: (id, body) => put(`/api/bohr/articles/${id}`, body),
    setRelecture: (id, memberIds) => put(`/api/bohr/articles/${id}/relecture`, { memberIds }),
    remove: (id) => del(`/api/bohr/articles/${id}`),
    importXlsm: (fileBase64) => post("/api/bohr/import-xlsm", { fileBase64 }),
  },

  com: {
    list: (season) => get(`/api/com/posts${season ? `?season=${encodeURIComponent(season)}` : ""}`),
    get: (id) => get(`/api/com/posts/${id}`),
    create: (body) => post("/api/com/posts", body),
    update: (id, body) => put(`/api/com/posts/${id}`, body),
    remove: (id) => del(`/api/com/posts/${id}`),
  },

  settings: {
    get: () => get("/api/settings"),
    update: (body) => put("/api/settings", body),
  },

  links: {
    list: (section) => get(`/api/links/${section}`),
    create: (section, body) => post(`/api/links/${section}`, body),
    update: (id, body) => put(`/api/links/${id}`, body),
    remove: (id) => del(`/api/links/${id}`),
  },

  instagram: {
    status: () => get("/api/instagram"),
    connect: (token) => put("/api/instagram", { token }),
    disconnect: () => del("/api/instagram"),
    refresh: () => post("/api/instagram/refresh", {}),
  },
  stats: {
    brevo: () => get("/api/stats/brevo"),
    instagram: () => get("/api/stats/instagram"),
  },
  events: {
    list: () => get("/api/events"),
  },

  maintenance: {
    listBackups: () => get("/api/maintenance/backups"),
    backupNow: () => post("/api/maintenance/backups"),
    restore: (name) => post(`/api/maintenance/backups/${encodeURIComponent(name)}/restore`),
  },

  newsletter: {
    brevoStatus: () => get("/api/newsletter/brevo"),
    saveBrevo: (body) => put("/api/newsletter/brevo", body),
    disconnectBrevo: () => del("/api/newsletter/brevo"),
    sendTest: (body) => post("/api/newsletter/send-test", body),
    send: (body) => post("/api/newsletter/send", body),
  },
};
