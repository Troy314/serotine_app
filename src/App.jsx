import { lazy, Suspense, useEffect, useState, useCallback } from "react";
import { useMediaQuery } from "./lib/useMediaQuery.js";
import { api } from "./lib/api.js";
import LeftNav from "./components/LeftNav.jsx";
import RightPane from "./components/RightPane.jsx";
import BohrBoard from "./components/BohrBoard.jsx";
const MiseEnPage = lazy(() => import("./components/MiseEnPage.jsx"));
const ComPlan = lazy(() => import("./components/ComPlan.jsx"));
const Podcast = lazy(() => import("./components/Podcast.jsx"));
const DocumentsTechniques = lazy(() => import("./components/DocumentsTechniques.jsx"));
const Todo = lazy(() => import("./components/Todo.jsx"));
const Stats = lazy(() => import("./components/Stats.jsx"));
const AdminPanel = lazy(() => import("./components/AdminPanel.jsx"));
import ProfileMenu from "./components/ProfileMenu.jsx";

const SECTION_LABEL = {
  bohr: "Tableau de Bohr",
  miseenpage: "Mise en page",
  complan: "Plan de Communication",
  podcast: "Podcast",
  docs: "Documents Technique",
  todo: "À faire",
  stats: "Statistiques",
  admin: "Administration",
};

// Qui peut voir quelle section, au-delà du socle commun (bohr, todo, docs) — miroir de LeftNav.jsx.
// "adminOnly" : C2R (isAdmin) seulement (Statistiques, Administration). Une valeur de pôle : il
// faut ce tag précis dans user.roles (AdminPanel.jsx's MemberTags) — le C2R n'en dispense plus
// (2026-10-09) : être du comité ne veut pas dire travailler sur mise en page/podcast/communication.
const SECTION_ACCESS = {
  miseenpage: "mise_en_page",
  complan: "communication",
  podcast: "podcast",
  stats: "adminOnly",
  admin: "adminOnly",
};
function canAccess(user, sectionId) {
  const need = SECTION_ACCESS[sectionId];
  if (!need) return true;
  if (need === "adminOnly") return !!user?.isAdmin;
  return !!(user?.roles || []).includes(need);
}

export default function App() {
  const [authState, setAuthState] = useState({ loading: true, user: null, configured: true, warning: null });
  const [section, setSection] = useState("bohr");
  // Téléphone / petite tablette : les deux panneaux sont des tiroirs fermés par défaut (voir styles.css, @media).
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [leftOpen, setLeftOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    if (isMobile) {
      setLeftOpen(false);
      setRightOpen(false);
    } else {
      setLeftOpen(true);
      setRightOpen(true);
    }
  }, [isMobile]);
  const selectSection = useCallback(
    (id) => {
      setSection(id);
      if (isMobile) setLeftOpen(false);
    },
    [isMobile]
  );
  const [settings, setSettings] = useState({});
  // "Night mode" is a pure display preference (persisted to localStorage,
  // never sent to the server) — it flips the app's light violet-on-white
  // palette to a dark purple surface with light green as the pop/accent
  // color instead of violet, see the [data-theme="dark"] block in
  // styles.css. Applied via a data attribute on <html> so it also themes
  // the pre-login screen, not just the authenticated shell.
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("serotine-theme") || "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("serotine-theme", theme);
    } catch {
      // localStorage unavailable (private browsing, etc.) — theme still
      // applies for this session, just doesn't persist across reloads.
    }
  }, [theme]);

  const loadMe = useCallback(() => {
    api.me().then((r) => setAuthState({ loading: false, ...r })).catch(() =>
      setAuthState({ loading: false, user: null, configured: true, warning: null })
    );
  }, []);

  useEffect(loadMe, [loadMe]);

  useEffect(() => {
    if (authState.user) api.settings.get().then(setSettings).catch(() => {});
  }, [authState.user]);

  // If the signed-in member can't see the current section (no access to begin with, or an admin
  // revoked it and they log back in with a fresh session), fall back to the one section everyone has.
  useEffect(() => {
    if (authState.user && !canAccess(authState.user, section)) setSection("bohr");
  }, [authState.user, section]);

  const refreshSettings = useCallback(() => {
    api.settings.get().then(setSettings).catch(() => {});
  }, []);

  const stopImpersonating = useCallback(() => {
    api.admin.stopImpersonating().then(loadMe).catch(() => {});
  }, [loadMe]);

  if (authState.loading) return null;

  if (!authState.configured) {
    return (
      <div className="login-screen">
        <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
        <h1>Sérotine — Hub</h1>
        <div className="error-box">
          L'application Discord n'est pas encore configurée côté serveur. {authState.warning}
        </div>
      </div>
    );
  }

  if (!authState.user) {
    const params = new URLSearchParams(window.location.search);
    const denied = params.get("denied");
    return (
      <div className="login-screen">
        <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
        <h1>Sérotine — Hub</h1>
        <p>
          Cet espace est réservé à l'équipe du webzine Sérotine : il faut être <strong>inscrit·e au projet Sérotine</strong> dans l'annuaire de l'association.
          Choisis ta méthode de connexion pour que l'on sache qui tu es.
        </p>
        {denied && <div className="error-box">Accès refusé : tu n'es pas (encore) inscrit·e au projet Sérotine.</div>}
        <a className="discord-btn" href="/auth/login">
          <i className="fa-brands fa-discord" aria-hidden="true" /> Se connecter avec Discord
        </a>
        <p className="muted small" style={{ marginTop: 10 }}>Discord est la seule méthode de connexion pour l'instant ; d'autres viendront.</p>
      </div>
    );
  }

  return (
    <div className={`hub ${authState.impersonating ? "hub--impersonating" : ""}`}>
      {authState.impersonating && (
        <div className="impersonation-bar">
          Tu navigues en tant que <strong>{authState.user.displayName}</strong> (ton vrai compte : {authState.impersonating.realUserDisplayName})
          <button className="link-btn secondary" onClick={stopImpersonating}>Revenir à mon compte</button>
        </div>
      )}
      {isMobile && (leftOpen || rightOpen) && (
        <div className="pane-backdrop" onClick={() => { setLeftOpen(false); setRightOpen(false); }} aria-hidden="true" />
      )}
      <button
        className="pane-toggle pane-toggle--left"
        aria-label={leftOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
        aria-expanded={leftOpen}
        onClick={() => { setLeftOpen((v) => !v); if (isMobile) setRightOpen(false); }}
        title={leftOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
      >
        <i className={`fa-solid ${leftOpen ? "fa-angle-left" : "fa-angle-right"}`} aria-hidden="true" />
      </button>

      <div className={`pane-left ${leftOpen ? "" : "collapsed"}`}>
        <LeftNav section={section} onSelect={selectSection} siteUrl={settings.serotine_site_url} user={authState.user} />
      </div>

      <main className="pane-main">
        <div className="topbar">
          <div className="topbar-title">
            <h1>{SECTION_LABEL[section]}</h1>
            <div className="topbar-sub">Sérotine — Hub de projet</div>
          </div>
          <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
          <ProfileMenu user={authState.user} onUserChanged={loadMe} onGoAdmin={() => selectSection("admin")} />
        </div>

        <Suspense fallback={<div className="rp-empty" role="status">Chargement…</div>}>
        {section === "bohr" && (
          <BohrBoard isAdmin={authState.user.isAdmin} currentUserId={authState.user.id} settings={settings} />
        )}
        {section === "miseenpage" && canAccess(authState.user, "miseenpage") && <MiseEnPage settings={settings} isAdmin={authState.user.isAdmin} isSuperAdmin={authState.user.isSuperAdmin} onSettingsChanged={refreshSettings} />}
        {section === "complan" && canAccess(authState.user, "complan") && <ComPlan settings={settings} isAdmin={authState.user.isAdmin} isSuperAdmin={authState.user.isSuperAdmin} onSettingsChanged={refreshSettings} theme={theme} />}
        {section === "podcast" && canAccess(authState.user, "podcast") && <Podcast settings={settings} isAdmin={authState.user.isAdmin} isSuperAdmin={authState.user.isSuperAdmin} onSettingsChanged={refreshSettings} />}
        {section === "docs" && <DocumentsTechniques isSuperAdmin={authState.user.isSuperAdmin} />}
        {section === "todo" && <Todo currentUserId={authState.user.id} isAdmin={authState.user.isAdmin} />}
        {section === "stats" && authState.user.isAdmin && <Stats isAdmin={authState.user.isAdmin} />}
        {section === "admin" && authState.user.isAdmin && (
          <AdminPanel settings={settings} onSettingsChanged={refreshSettings} accessMode={authState.accessMode} isSuperAdmin={authState.user.isSuperAdmin} />
        )}
        </Suspense>
      </main>

      <button
        className="pane-toggle pane-toggle--right"
        aria-label={rightOpen ? "Fermer le panneau" : "Ouvrir le panneau"}
        aria-expanded={rightOpen}
        onClick={() => { setRightOpen((v) => !v); if (isMobile) setLeftOpen(false); }}
        title={rightOpen ? "Fermer le panneau" : "Ouvrir le panneau"}
      >
        <i className={`fa-solid ${rightOpen ? "fa-angle-right" : "fa-angle-left"}`} aria-hidden="true" />
      </button>

      <div className={`pane-right ${rightOpen ? "" : "collapsed"}`}>
        <RightPane minutesUrl={settings.minutes_url} />
      </div>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      className="select-chip theme-toggle"
      onClick={onToggle}
      title={isDark ? "Passer en mode clair" : "Passer en mode nuit"}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode nuit"}
    >
      <i className={`fa-solid ${isDark ? "fa-sun" : "fa-moon"}`} aria-hidden="true" /> <span className="hide-mobile">{isDark ? "Mode clair" : "Mode nuit"}</span>
    </button>
  );
}
