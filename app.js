// Espanhol Família — app principal
import { DECKS, FRASES, CRONOGRAMA, LIVROS, LINKS, TRILHAS } from "./content.js";
import { firebaseConfig, ADMIN_EMAIL, FIREBASE_VERSION } from "./firebase-config.js";

const DEMO = new URLSearchParams(location.search).has("demo");
const $app = document.getElementById("app");

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoje = () => diaISO(new Date());
function diaISO(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return diaISO(d); }
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cardId = (deckId, es) => `${deckId}__${slug(es)}`;
const min = (seg) => Math.round((seg || 0) / 60);
function fmtHoras(seg) {
  const m = min(seg);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function tsToDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  return new Date(v);
}

// ---------- voz (ouvir) ----------
let vozES = null;
function carregarVozes() {
  const vs = speechSynthesis.getVoices();
  vozES = vs.find((v) => v.lang === "es-ES" && /google|natural|premium/i.test(v.name))
    || vs.find((v) => v.lang === "es-ES")
    || vs.find((v) => v.lang && v.lang.startsWith("es")) || null;
}
if ("speechSynthesis" in window) {
  carregarVozes();
  speechSynthesis.onvoiceschanged = carregarVozes;
}
function falar(texto, lento = false) {
  if (!("speechSynthesis" in window)) { toast("Este aparelho não tem voz disponível."); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = "es-ES";
  if (vozES) u.voice = vozES;
  u.rate = lento ? 0.65 : 0.9;
  speechSynthesis.speak(u);
}

// ---------- reconhecimento de fala ----------
const Reconhecedor = window.SpeechRecognition || window.webkitSpeechRecognition;
function normalizar(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[¿?¡!.,;:«»"()—–-]/g, " ").replace(/\s+/g, " ").trim();
}
// compara palavras (LCS) e devolve nota 0–100 e quais palavras do alvo foram reconhecidas
export function avaliarPronuncia(alvo, falado) {
  const a = normalizar(alvo).split(" ").filter(Boolean);
  const b = normalizar(falado).split(" ").filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const ok = new Array(a.length).fill(false);
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ok[i - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  const acertos = dp[a.length][b.length];
  const nota = Math.round((acertos / Math.max(a.length, b.length, 1)) * 100);
  return { nota, ok };
}

// ---------- revisão espaçada ----------
export function agendar(estado, resposta) {
  const s = { ease: 2.5, intervalo: 0, reps: 0, ...(estado || {}) };
  const agora = Date.now(), DIA = 86400000;
  if (resposta === "errei") {
    s.reps = 0; s.intervalo = 0; s.ease = Math.max(1.3, s.ease - 0.2);
    s.proxima = agora + 60 * 1000;
  } else {
    if (resposta === "dificil") {
      s.intervalo = Math.max(1, Math.round(s.intervalo * 1.2));
      s.ease = Math.max(1.3, s.ease - 0.15);
    } else {
      let novo = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(s.intervalo * s.ease);
      if (resposta === "facil") { novo = Math.max(novo + 1, Math.round(novo * 1.3)); s.ease += 0.15; }
      s.intervalo = novo;
    }
    s.reps += 1;
    s.proxima = agora + s.intervalo * DIA;
  }
  s.atualizado = agora;
  return s;
}
const aprendida = (st) => st && st.intervalo >= 3;

// =====================================================================
// Armazenamento: Firebase (normal) ou navegador (modo demonstração)
// =====================================================================
function criarStoreDemo() {
  const K = "esp-demo";
  const db = JSON.parse(localStorage.getItem(K) || '{"users":{},"allow":{},"cards":{},"dias":{}}');
  const salvar = () => localStorage.setItem(K, JSON.stringify(db));
  const usuario = { uid: "demo-admin", email: ADMIN_EMAIL, displayName: "Ricardo (demo)", photoURL: "" };
  return {
    demo: true,
    async iniciar(cb) { cb(usuario); },
    async entrar() {}, async sair() { localStorage.removeItem(K); location.reload(); },
    async liberacao(email) { return email === ADMIN_EMAIL ? { ativo: true, trilha: "ricardo" } : db.allow[email] || null; },
    async getUser(uid) { return db.users[uid] || null; },
    async setUser(uid, dados) { db.users[uid] = { ...(db.users[uid] || {}), ...dados }; salvar(); },
    async incUser(uid, inc) { const u = db.users[uid] || (db.users[uid] = {}); for (const k in inc) u[k] = (u[k] || 0) + inc[k]; u.ultimoAcesso = Date.now(); salvar(); },
    async getCards(uid) { return { ...(db.cards[uid] || {}) }; },
    async setCard(uid, id, st) { (db.cards[uid] ||= {})[id] = st; salvar(); },
    async incDia(uid, dia, inc) { const d = ((db.dias[uid] ||= {})[dia] ||= {}); for (const k in inc) d[k] = (d[k] || 0) + inc[k]; salvar(); },
    async getDias(uid, n) { const out = {}; for (let i = 0; i < n; i++) { const k = diasAtras(i); if (db.dias[uid]?.[k]) out[k] = db.dias[uid][k]; } return out; },
    async listUsers() { return Object.entries(db.users).map(([uid, u]) => ({ uid, ...u })); },
    async listAllow() { return Object.entries(db.allow).map(([email, a]) => ({ email, ...a })); },
    async setAllow(email, dados) { db.allow[email] = { ...(db.allow[email] || {}), ...dados }; salvar(); },
  };
}

async function criarStoreFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch { db = F.getFirestore(app); }
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  return {
    demo: false,
    async iniciar(cb) {
      try { await A.getRedirectResult(auth); } catch (e) { console.warn(e); }
      A.onAuthStateChanged(auth, cb);
    },
    async entrar() {
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
          await A.signInWithRedirect(auth, provider);
        } else if (e.code !== "auth/popup-closed-by-user") { throw e; }
      }
    },
    async sair() { await A.signOut(auth); },
    async liberacao(email) {
      if (email === ADMIN_EMAIL) return { ativo: true, trilha: "ricardo" };
      const s = await F.getDoc(F.doc(db, "allowlist", email));
      return s.exists() ? s.data() : null;
    },
    async getUser(uid) { const s = await F.getDoc(F.doc(db, "users", uid)); return s.exists() ? s.data() : null; },
    async setUser(uid, dados) { await F.setDoc(F.doc(db, "users", uid), dados, { merge: true }); },
    async incUser(uid, inc) {
      const d = { ultimoAcesso: F.serverTimestamp() };
      for (const k in inc) d[k] = F.increment(inc[k]);
      await F.setDoc(F.doc(db, "users", uid), d, { merge: true });
    },
    async getCards(uid) {
      const snap = await F.getDocs(F.collection(db, "users", uid, "cards"));
      const out = {}; snap.forEach((d) => (out[d.id] = d.data())); return out;
    },
    async setCard(uid, id, st) { await F.setDoc(F.doc(db, "users", uid, "cards", id), st); },
    async incDia(uid, dia, inc) {
      const d = { data: dia };
      for (const k in inc) d[k] = F.increment(inc[k]);
      await F.setDoc(F.doc(db, "users", uid, "dias", dia), d, { merge: true });
    },
    async getDias(uid, n) {
      const q = F.query(F.collection(db, "users", uid, "dias"), F.where("data", ">=", diasAtras(n - 1)));
      const snap = await F.getDocs(q);
      const out = {}; snap.forEach((d) => (out[d.id] = d.data())); return out;
    },
    async listUsers() {
      const snap = await F.getDocs(F.collection(db, "users"));
      return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    },
    async listAllow() {
      const snap = await F.getDocs(F.collection(db, "allowlist"));
      return snap.docs.map((d) => ({ email: d.id, ...d.data() }));
    },
    async setAllow(email, dados) { await F.setDoc(F.doc(db, "allowlist", email), dados, { merge: true }); },
  };
}

// =====================================================================
// Estado do app
// =====================================================================
const S = {
  store: null, auth: null, perfil: null, cards: {}, dias: {},
  tela: "inicio", isAdmin: false,
  sessao: null, // sessão de estudo ativa
  pendente: { segundos: 0, revisoes: 0, pronTentativas: 0, pronSoma: 0 },
};

// ---------- contagem de tempo de uso ----------
let ultimaInteracao = Date.now();
["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => addEventListener(ev, () => (ultimaInteracao = Date.now()), { passive: true }));
setInterval(() => {
  if (!S.auth || !S.perfil) return;
  if (document.visibilityState === "visible" && Date.now() - ultimaInteracao < 120000) S.pendente.segundos += 15;
}, 15000);
setInterval(gravarPendente, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") gravarPendente(); });

async function gravarPendente() {
  if (!S.auth || !S.perfil) return;
  const p = S.pendente;
  if (!p.segundos && !p.revisoes && !p.pronTentativas) return;
  const inc = {};
  for (const k in p) if (p[k]) inc[k] = p[k];
  S.pendente = { segundos: 0, revisoes: 0, pronTentativas: 0, pronSoma: 0 };
  const dia = hoje();
  const d = (S.dias[dia] ||= {});
  for (const k in inc) d[k] = (d[k] || 0) + inc[k];
  const incUser = {};
  if (inc.segundos) incUser.totalSegundos = inc.segundos;
  if (inc.revisoes) incUser.totalRevisoes = inc.revisoes;
  if (inc.pronTentativas) { incUser.pronTentativas = inc.pronTentativas; incUser.pronSoma = inc.pronSoma; }
  try {
    await Promise.all([S.store.incDia(S.auth.uid, dia, inc), S.store.incUser(S.auth.uid, incUser)]);
  } catch (e) { console.warn("Falha ao gravar uso", e); for (const k in inc) S.pendente[k] += inc[k]; }
}

// =====================================================================
// Inicialização
// =====================================================================
async function iniciar() {
  render(`<div class="center"><div class="spinner"></div><p>Carregando…</p></div>`);
  try {
    S.store = DEMO ? criarStoreDemo() : await criarStoreFirebase();
  } catch (e) {
    console.error(e);
    render(`<div class="center"><h2>Sem conexão</h2><p>Não foi possível carregar o app. Verifique a internet e tente de novo.</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`);
    return;
  }
  S.store.iniciar(aoMudarLogin);
}

async function aoMudarLogin(user) {
  S.auth = user;
  if (!user) return telaLogin();
  render(`<div class="center"><div class="spinner"></div><p>Entrando…</p></div>`);
  const email = (user.email || "").toLowerCase();
  S.isAdmin = email === ADMIN_EMAIL;
  try {
    const lib = await S.store.liberacao(email);
    if (!lib || !lib.ativo) return telaSemAcesso(email);
    let perfil = await S.store.getUser(user.uid);
    if (!perfil || !perfil.trilha) {
      return telaPrimeiroAcesso(user, lib);
    }
    S.perfil = perfil;
    const [cards, dias] = await Promise.all([S.store.getCards(user.uid), S.store.getDias(user.uid, 30)]);
    S.cards = cards; S.dias = dias;
    S.store.incUser(user.uid, {}).catch(() => {});
    S.tela = "inicio";
    desenhar();
  } catch (e) {
    console.error(e);
    render(`<div class="center"><h2>Algo deu errado</h2><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`);
  }
}

function render(html) { $app.innerHTML = html; }

function telaLogin() {
  render(`
    <div class="login">
      <div class="logo">🇪🇸</div>
      <h1>Espanhol Família</h1>
      <p class="muted">Vocabulário, pronúncia e a vida na Espanha — no ritmo de cada um.</p>
      <button class="btn btn-google" id="btnEntrar">
        <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
        Entrar com Google
      </button>
      <p class="small muted">Acesso liberado só para a família.</p>
    </div>`);
  document.getElementById("btnEntrar").onclick = async () => {
    try { await S.store.entrar(); } catch (e) { toast("Não foi possível entrar: " + (e.code || e.message)); }
  };
}

function telaSemAcesso(email) {
  render(`
    <div class="login">
      <div class="logo">🔒</div>
      <h2>Acesso ainda não liberado</h2>
      <p>O e-mail <b>${esc(email)}</b> ainda não foi liberado.</p>
      <p class="muted">Peça ao Ricardo para liberar este e-mail no painel da família.</p>
      <button class="btn btn-sec" id="btnSair">Entrar com outra conta</button>
    </div>`);
  document.getElementById("btnSair").onclick = () => S.store.sair();
}

function telaPrimeiroAcesso(user, lib) {
  const nome = (user.displayName || "").split(" ")[0] || "";
  const trilha = lib.trilha || "geral";
  render(`
    <div class="login">
      <div class="logo">👋</div>
      <h2>¡Bienvenido!</h2>
      <p class="muted">Vamos configurar seu perfil. Leva 10 segundos.</p>
      <form id="fPerfil" class="form">
        <label>Como quer ser chamado(a)?<input name="nome" required value="${esc(nome)}"></label>
        <label>Sua trilha
          <select name="trilha">${Object.entries(TRILHAS).map(([k, v]) => `<option value="${k}" ${k === trilha ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
        <label>Seu nível hoje
          <select name="nivel">
            <option value="A0">Começando do zero</option>
            <option value="A1">A1 — básico</option>
            <option value="A2">A2 — elementar</option>
            <option value="B1">B1 — intermediário</option>
            <option value="B2">B2 — intermediário alto</option>
          </select>
        </label>
        <label>Meta diária (minutos)<input name="meta" type="number" min="5" max="180" value="30"></label>
        <button class="btn" type="submit">Começar</button>
      </form>
    </div>`);
  document.getElementById("fPerfil").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const perfil = {
      nome: f.get("nome").trim(), email: (user.email || "").toLowerCase(),
      trilha: f.get("trilha"), nivel: f.get("nivel"), metaMin: Number(f.get("meta")) || 30,
      criadoEm: Date.now(),
    };
    await S.store.setUser(user.uid, perfil);
    aoMudarLogin(user);
  };
}

// =====================================================================
// Layout com navegação
// =====================================================================
const ABAS = [
  ["inicio", "🏠", "Início"],
  ["vocab", "📚", "Palavras"],
  ["pron", "🎤", "Pronúncia"],
  ["plano", "🗓️", "Plano"],
  ["espanha", "🇪🇸", "Espanha"],
];

function desenhar() {
  const abas = S.isAdmin ? [...ABAS, ["admin", "👨‍👩‍👧", "Família"]] : ABAS;
  const conteudo = {
    inicio: telaInicio, vocab: telaVocab, pron: telaPron, plano: telaPlano,
    espanha: telaEspanha, admin: telaAdmin, estudo: telaEstudo,
  }[S.tela]();
  render(`
    <header class="topo">
      <div class="marca">🇪🇸 <span>Espanhol Família</span>${S.store.demo ? ' <em class="tag">demo</em>' : ""}</div>
      <button class="avatar" id="btnConta" title="Conta">${esc((S.perfil.nome || "?")[0].toUpperCase())}</button>
    </header>
    <main id="conteudo">${conteudo}</main>
    <nav class="abas">${abas.map(([id, ic, nm]) => `<button data-aba="${id}" class="${S.tela === id || (S.tela === "estudo" && id === "vocab") ? "ativa" : ""}"><span>${ic}</span>${nm}</button>`).join("")}</nav>
  `);
  document.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => { S.tela = b.dataset.aba; desenhar(); scrollTo(0, 0); }));
  document.getElementById("btnConta").onclick = menuConta;
  ligarEventos();
}

function menuConta() {
  const p = S.perfil;
  const div = document.createElement("div");
  div.className = "modal";
  div.innerHTML = `<div class="caixa">
    <h3>${esc(p.nome)}</h3>
    <p class="muted small">${esc(S.auth.email)}</p>
    <form id="fConta" class="form">
      <label>Trilha<select name="trilha">${Object.entries(TRILHAS).map(([k, v]) => `<option value="${k}" ${k === p.trilha ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Meta diária (min)<input name="meta" type="number" min="5" max="180" value="${p.metaMin || 30}"></label>
      <button class="btn" type="submit">Salvar</button>
    </form>
    <button class="btn btn-sec" id="mSair">Sair da conta</button>
    <button class="btn btn-link" id="mFechar">Fechar</button>
  </div>`;
  document.body.appendChild(div);
  div.querySelector("#mFechar").onclick = () => div.remove();
  div.onclick = (e) => { if (e.target === div) div.remove(); };
  div.querySelector("#mSair").onclick = async () => { await gravarPendente(); div.remove(); S.perfil = null; S.store.sair(); };
  div.querySelector("#fConta").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const upd = { trilha: f.get("trilha"), metaMin: Number(f.get("meta")) || 30 };
    Object.assign(S.perfil, upd);
    await S.store.setUser(S.auth.uid, upd);
    div.remove(); toast("Perfil atualizado"); desenhar();
  };
}

// ---------- helpers de conteúdo ----------
function decksDaTrilha(todos = false) {
  if (todos) return DECKS;
  return DECKS.filter((d) => d.trilhas.includes("todas") || d.trilhas.includes(S.perfil.trilha));
}
function statsDeck(deck) {
  const agora = Date.now();
  let aprend = 0, devidas = 0, novas = 0;
  for (const [es] of deck.cards) {
    const st = S.cards[cardId(deck.id, es)];
    if (!st) novas++;
    else { if (aprendida(st)) aprend++; if (st.proxima <= agora) devidas++; }
  }
  return { total: deck.cards.length, aprend, devidas, novas };
}
function minutosHoje() { return min((S.dias[hoje()]?.segundos || 0) + S.pendente.segundos); }
function sequencia() {
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const seg = (S.dias[diasAtras(i)]?.segundos || 0) + (i === 0 ? S.pendente.segundos : 0);
    if (seg >= 300) n++; else if (i > 0) break;
  }
  return n;
}

// =====================================================================
// Telas
// =====================================================================
function telaInicio() {
  const meta = S.perfil.metaMin || 30;
  const m = minutosHoje();
  const pct = Math.min(100, Math.round((m / meta) * 100));
  const decks = decksDaTrilha();
  let devidas = 0, aprend = 0, total = 0;
  decks.forEach((d) => { const s = statsDeck(d); devidas += s.devidas; aprend += s.aprend; total += s.total; });
  const totalAprend = Object.values(S.cards).filter(aprendida).length;
  const diaSemana = new Date().getDay(); // 0 = domingo
  const plano = CRONOGRAMA.base[(diaSemana + 6) % 7];
  const saud = new Date().getHours() < 12 ? "Buenos días" : new Date().getHours() < 20 ? "Buenas tardes" : "Buenas noches";
  return `
    <section class="ola">
      <h1>${saud}, ${esc(S.perfil.nome)}!</h1>
      <p class="muted">${esc(TRILHAS[S.perfil.trilha] || "")} · nível ${esc(S.perfil.nivel || "")}</p>
    </section>
    <section class="cartao meta">
      <div class="anel" style="--p:${pct}"><b>${m}</b><small>de ${meta} min</small></div>
      <div>
        <h3>Meta de hoje</h3>
        <p>${pct >= 100 ? "¡Meta cumplida! 🎉" : `Faltam ${Math.max(0, meta - m)} minutos.`}</p>
        <p class="small muted">🔥 Sequência: <b>${sequencia()}</b> dia(s) · 📘 ${totalAprend} palavras aprendidas</p>
      </div>
    </section>
    <section class="cartao">
      <h3>Hoje no plano · ${plano.dia}</h3>
      <p>${esc(plano.tarefa)}</p>
    </section>
    <section class="grade2">
      <button class="cartao acao" data-ir="revisar"><span class="big">📚</span><b>Revisar palavras</b><small>${devidas} para revisar · ${total - aprend} a aprender</small></button>
      <button class="cartao acao" data-ir="pron"><span class="big">🎤</span><b>Treinar pronúncia</b><small>Ouça e repita</small></button>
    </section>
    <section class="cartao">
      <h3>Últimos 7 dias</h3>
      ${barras(S.dias, 7, meta)}
    </section>`;
}

function barras(dias, n, meta) {
  const linhas = [];
  const nomes = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  let max = meta || 30;
  for (let i = n - 1; i >= 0; i--) max = Math.max(max, min(dias[diasAtras(i)]?.segundos));
  for (let i = n - 1; i >= 0; i--) {
    const k = diasAtras(i);
    const v = min(dias[k]?.segundos) + (i === 0 && dias === S.dias ? min(S.pendente.segundos) : 0);
    const d = new Date(k + "T12:00:00");
    linhas.push(`<div class="barra"><div class="col" style="height:${Math.max(2, (v / max) * 100)}%" title="${v} min"></div><small>${n > 7 ? d.getDate() : nomes[d.getDay()]}</small><em>${v}</em></div>`);
  }
  return `<div class="barras">${linhas.join("")}</div>`;
}

function telaVocab() {
  const todos = S.verTodos;
  return `
    <section class="ola"><h1>Palavras</h1><p class="muted">Cartões com revisão inteligente: o que você erra volta mais vezes.</p></section>
    <button class="btn" data-ir="revisar">▶ Estudar agora (todas as minhas listas)</button>
    <div class="lista-decks">
      ${decksDaTrilha(todos).map((d) => {
        const s = statsDeck(d);
        const pct = Math.round((s.aprend / s.total) * 100);
        return `<button class="cartao deck" data-deck="${d.id}">
          <span class="big">${d.icone}</span>
          <div class="info"><b>${esc(d.nome)}</b>
            <div class="prog"><div style="width:${pct}%"></div></div>
            <small>${s.aprend}/${s.total} aprendidas · ${s.devidas} para revisar · ${s.novas} novas</small>
          </div></button>`;
      }).join("")}
    </div>
    <label class="check"><input type="checkbox" id="chkTodos" ${todos ? "checked" : ""}> Mostrar listas das outras trilhas</label>`;
}

function montarSessao(deckIds) {
  const agora = Date.now();
  const devidas = [], novas = [];
  for (const d of DECKS.filter((x) => deckIds.includes(x.id))) {
    for (const c of d.cards) {
      const id = cardId(d.id, c[0]);
      const st = S.cards[id];
      const item = { id, deck: d, es: c[0], pt: c[1], ex: c[2] };
      if (!st) novas.push(item); else if (st.proxima <= agora) devidas.push(item);
    }
  }
  devidas.sort(() => Math.random() - 0.5);
  const fila = [...devidas.slice(0, 30), ...novas.slice(0, 10)];
  return { fila, pos: 0, virado: false, feitos: 0, acertos: 0 };
}

function telaEstudo() {
  const s = S.sessao;
  if (!s || !s.fila.length) {
    return `<section class="center"><div class="big">✅</div><h2>Tudo em dia!</h2><p class="muted">Nenhuma palavra para revisar agora. Volte amanhã ou abra outra lista.</p><button class="btn" data-aba2="vocab">Voltar às listas</button></section>`;
  }
  if (s.pos >= s.fila.length) {
    return `<section class="center"><div class="big">🎉</div><h2>¡Muy bien!</h2><p>Você revisou <b>${s.feitos}</b> cartões${s.feitos ? ` e acertou <b>${Math.round((s.acertos / s.feitos) * 100)}%</b>` : ""}.</p><button class="btn" data-ir="revisar">Continuar estudando</button><button class="btn btn-sec" data-aba2="inicio">Ir para o início</button></section>`;
  }
  const c = s.fila[s.pos];
  const nova = !S.cards[c.id];
  return `
    <div class="estudo-topo"><button class="btn-link" data-aba2="vocab">✕ Sair</button><span>${s.pos + 1} / ${s.fila.length}</span></div>
    <div class="prog"><div style="width:${(s.pos / s.fila.length) * 100}%"></div></div>
    <section class="flash ${s.virado ? "virado" : ""}">
      <small class="muted">${c.deck.icone} ${esc(c.deck.nome)}${nova ? ' · <span class="tag">nova</span>' : ""}</small>
      <p class="frente">${esc(c.pt)}</p>
      ${s.virado ? `
        <p class="verso">${esc(c.es)} <button class="som" data-falar="${esc(c.es)}">🔊</button></p>
        <p class="exemplo">“${esc(c.ex)}” <button class="som" data-falar="${esc(c.ex)}">🔊</button></p>
      ` : `<p class="muted small">Pense em como se diz em espanhol…</p>`}
    </section>
    ${s.virado ? `
      <div class="respostas">
        <button class="r errei" data-resp="errei">Errei<small>1 min</small></button>
        <button class="r dificil" data-resp="dificil">Difícil</button>
        <button class="r bom" data-resp="bom">Bom</button>
        <button class="r facil" data-resp="facil">Fácil</button>
      </div>` : `<button class="btn grande" id="btnVirar">Mostrar resposta</button>`}`;
}

async function responder(resp) {
  const s = S.sessao, c = s.fila[s.pos];
  const st = agendar(S.cards[c.id], resp);
  S.cards[c.id] = st;
  s.feitos++; if (resp !== "errei") s.acertos++;
  S.pendente.revisoes++;
  if (resp === "errei") s.fila.push(c); // volta no fim da sessão
  s.pos++; s.virado = false;
  desenhar();
  try { await S.store.setCard(S.auth.uid, c.id, st); } catch (e) { console.warn(e); toast("Sem internet: o progresso será salvo depois."); }
}

function frasesDaTrilha() {
  const nome = S.perfil.nome || "Ricardo";
  return FRASES.filter((f) => !f.trilha || f.trilha === S.perfil.trilha)
    .map((f) => ({ ...f, es: f.es.replace("Ricardo", nome), pt: f.pt.replace("Ricardo", nome) }));
}

function telaPron() {
  const lista = frasesDaTrilha();
  const i = Math.min(S.fraseIdx || 0, lista.length - 1);
  const f = lista[i];
  const r = S.ultimaPron && S.ultimaPron.idx === i ? S.ultimaPron : null;
  const suporte = !!Reconhecedor;
  return `
    <section class="ola"><h1>Pronúncia</h1><p class="muted">Ouça, repita em voz alta e veja sua nota. Sotaque da Espanha.</p></section>
    <section class="cartao frase">
      <small class="muted">Frase ${i + 1} de ${lista.length} · nível ${"●".repeat(f.nivel)}${"○".repeat(3 - f.nivel)}</small>
      <p class="es">${r ? colorir(f.es, r.ok) : esc(f.es)}</p>
      <p class="muted">${esc(f.pt)}</p>
      <div class="linha">
        <button class="btn btn-sec" data-falar="${esc(f.es)}">🔊 Ouvir</button>
        <button class="btn btn-sec" data-falar-lento="${esc(f.es)}">🐢 Devagar</button>
      </div>
      ${suporte ? `<button class="btn grande mic ${S.gravando ? "gravando" : ""}" id="btnMic">${S.gravando ? "🎙️ Ouvindo… fale agora" : "🎤 Toque e fale a frase"}</button>`
        : `<p class="aviso">Seu navegador não reconhece fala. No celular, use o <b>Google Chrome</b> (Android) ou o <b>Safari</b> atualizado (iPhone).</p>`}
      ${r ? `<div class="nota n${r.nota >= 85 ? 3 : r.nota >= 60 ? 2 : 1}"><b>${r.nota}</b>/100 · ${r.nota >= 85 ? "¡Excelente!" : r.nota >= 60 ? "¡Bien! Repita as palavras em vermelho." : "Vamos de novo, devagar."}<br><small>O app entendeu: “${esc(r.ouvido)}”</small></div>` : ""}
    </section>
    <div class="linha">
      <button class="btn btn-sec" id="btnAnt" ${i === 0 ? "disabled" : ""}>← Anterior</button>
      <button class="btn" id="btnProx" ${i >= lista.length - 1 ? "disabled" : ""}>Próxima →</button>
    </div>
    <section class="cartao dica">
      <h3>Dicas do espanhol da Espanha</h3>
      <ul>
        <li><b>Z</b> e <b>C</b> (antes de e/i) soam como o "th" do inglês: <i>gracias</i>, <i>cerveza</i>.</li>
        <li><b>J</b> e <b>G</b> (antes de e/i) são um "rr" forte e raspado: <i>jamón</i>, <i>gente</i>.</li>
        <li><b>LL</b> soa parecido com "i": <i>calle</i>, <i>llave</i>.</li>
        <li>O <b>D</b> no fim da palavra quase some: <i>Madrid</i>, <i>verdad</i>.</li>
        <li>Na Espanha se usa <b>vosotros</b> para "vocês" entre amigos.</li>
      </ul>
    </section>`;
}

function colorir(frase, ok) {
  const palavras = frase.split(/\s+/);
  let k = 0;
  return palavras.map((p) => {
    const temLetra = normalizar(p).length > 0;
    if (!temLetra) return esc(p);
    const cls = ok[k++] ? "ok" : "erro";
    return `<span class="${cls}">${esc(p)}</span>`;
  }).join(" ");
}

function gravarFala() {
  const lista = frasesDaTrilha();
  const idx = Math.min(S.fraseIdx || 0, lista.length - 1);
  const alvo = lista[idx].es;
  const rec = new Reconhecedor();
  rec.lang = "es-ES"; rec.interimResults = false; rec.maxAlternatives = 3;
  S.gravando = true; desenhar();
  let tratado = false;
  rec.onresult = (ev) => {
    tratado = true;
    const alts = Array.from(ev.results[0]).map((a) => a.transcript);
    let melhor = { nota: -1 };
    for (const t of alts) { const r = avaliarPronuncia(alvo, t); if (r.nota > melhor.nota) melhor = { ...r, ouvido: t }; }
    S.ultimaPron = { idx, ...melhor };
    S.pendente.pronTentativas++; S.pendente.pronSoma += melhor.nota;
  };
  rec.onerror = (ev) => {
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") toast("Libere o microfone para este site nas configurações do navegador.");
    else if (ev.error === "no-speech") toast("Não ouvi nada. Tente de novo, mais perto do celular.");
    else toast("Erro no microfone: " + ev.error);
  };
  rec.onend = () => { S.gravando = false; if (!tratado) S.ultimaPron = S.ultimaPron; desenhar(); };
  try { rec.start(); } catch (e) { S.gravando = false; desenhar(); }
}

function telaPlano() {
  const dia = (new Date().getDay() + 6) % 7;
  const metas = CRONOGRAMA.metas[S.perfil.trilha] || CRONOGRAMA.metas.ricardo;
  return `
    <section class="ola"><h1>Plano de estudo</h1><p class="muted">Meta: ${S.perfil.metaMin || 30} min por dia. Ajuste no seu perfil (botão com a sua inicial).</p></section>
    <section class="cartao"><h3>Semana</h3>
      <ul class="semana">${CRONOGRAMA.base.map((d, i) => `<li class="${i === dia ? "hoje" : ""}"><b>${d.dia}</b><span>${esc(d.tarefa)}</span></li>`).join("")}</ul>
    </section>
    <section class="cartao"><h3>Caminho até a fluência · ${esc(TRILHAS[S.perfil.trilha] || "")}</h3>
      <ol class="etapas">${metas.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>
    </section>
    <section class="cartao"><h3>📖 Livros sugeridos</h3>
      <ul class="livros">${LIVROS.map((l) => `<li><b>${esc(l.titulo)}</b><small>${esc(l.para)} · ${esc(l.obs)}</small></li>`).join("")}</ul>
    </section>`;
}

function telaEspanha() {
  return `
    <section class="ola"><h1>Central Espanha</h1><p class="muted">Links oficiais e úteis para a mudança. Leia uma notícia por dia no jornal de Alicante!</p></section>
    ${LINKS.map((g) => `<section class="cartao"><h3>${esc(g.grupo)}</h3>
      <ul class="links">${g.itens.map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} <span>↗</span></a></li>`).join("")}</ul>
    </section>`).join("")}`;
}

// ---------- painel da família (admin) ----------
function telaAdmin() {
  if (!S.admin) {
    carregarAdmin();
    return `<div class="center"><div class="spinner"></div><p>Carregando família…</p></div>`;
  }
  const { users, allow, diasPorUser } = S.admin;
  const linhas = users.map((u) => {
    const d = diasPorUser[u.uid] || {};
    const hojeMin = min(d[hoje()]?.segundos);
    let semana = 0; for (let i = 0; i < 7; i++) semana += d[diasAtras(i)]?.segundos || 0;
    const media = u.pronTentativas ? Math.round(u.pronSoma / u.pronTentativas) : null;
    const ult = tsToDate(u.ultimoAcesso);
    return `<div class="cartao pessoa" data-pessoa="${u.uid}">
      <div class="cab"><span class="avatar">${esc((u.nome || "?")[0])}</span>
        <div><b>${esc(u.nome || u.email)}</b><small>${esc(TRILHAS[u.trilha] || "")} · nível ${esc(u.nivel || "-")}</small></div></div>
      <div class="kpis">
        <div><b>${hojeMin}</b><small>min hoje</small></div>
        <div><b>${min(semana)}</b><small>min 7 dias</small></div>
        <div><b>${fmtHoras(u.totalSegundos)}</b><small>total</small></div>
        <div><b>${u.palavrasAprendidas ?? "–"}</b><small>palavras</small></div>
        <div><b>${media ?? "–"}</b><small>pronúncia</small></div>
      </div>
      ${barras(d, 14, u.metaMin || 30)}
      <small class="muted">Último acesso: ${ult ? ult.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "–"} · ${u.totalRevisoes || 0} revisões</small>
    </div>`;
  }).join("");
  return `
    <section class="ola"><h1>Família</h1><p class="muted">Acompanhamento de tempo e evolução. Só você vê esta tela.</p></section>
    ${linhas || '<p class="muted">Ninguém entrou ainda.</p>'}
    <section class="cartao">
      <h3>Acessos liberados</h3>
      <ul class="acessos">${allow.map((a) => `<li><div><b>${esc(a.nome || a.email)}</b><small>${esc(a.email)} · ${esc(TRILHAS[a.trilha] || "")}</small></div>
        <button class="btn-mini ${a.ativo ? "" : "off"}" data-toggle="${esc(a.email)}" data-ativo="${a.ativo ? 1 : 0}">${a.ativo ? "Ativo" : "Bloqueado"}</button></li>`).join("") || '<li class="muted">Nenhum e-mail liberado ainda.</li>'}</ul>
      <form id="fAllow" class="form">
        <label>E-mail Google (Gmail)<input name="email" type="email" required placeholder="nome@gmail.com"></label>
        <label>Nome<input name="nome" required></label>
        <label>Trilha<select name="trilha">${Object.entries(TRILHAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <button class="btn" type="submit">Liberar acesso</button>
      </form>
    </section>
    <button class="btn btn-sec" id="btnAtualizar">↻ Atualizar dados</button>`;
}

async function carregarAdmin() {
  try {
    await gravarPendente();
    const [users, allow] = await Promise.all([S.store.listUsers(), S.store.listAllow()]);
    const diasPorUser = {};
    await Promise.all(users.map(async (u) => { diasPorUser[u.uid] = await S.store.getDias(u.uid, 14); }));
    S.admin = { users, allow, diasPorUser };
  } catch (e) {
    console.error(e);
    S.admin = { users: [], allow: [], diasPorUser: {} };
    toast("Não foi possível carregar: " + e.message);
  }
  if (S.tela === "admin") desenhar();
}

// =====================================================================
// Eventos
// =====================================================================
function ligarEventos() {
  const q = (sel) => document.querySelectorAll(sel);
  q("[data-falar]").forEach((b) => (b.onclick = () => falar(b.dataset.falar)));
  q("[data-falar-lento]").forEach((b) => (b.onclick = () => falar(b.dataset.falarLento, true)));
  q("[data-aba2]").forEach((b) => (b.onclick = () => { S.tela = b.dataset.aba2; desenhar(); }));
  q("[data-ir]").forEach((b) => (b.onclick = () => {
    if (b.dataset.ir === "revisar") {
      S.sessao = montarSessao(decksDaTrilha(S.verTodos).map((d) => d.id));
      S.tela = "estudo";
    } else S.tela = b.dataset.ir;
    desenhar(); scrollTo(0, 0);
  }));
  q("[data-deck]").forEach((b) => (b.onclick = () => { S.sessao = montarSessao([b.dataset.deck]); S.tela = "estudo"; desenhar(); scrollTo(0, 0); }));
  const chk = document.getElementById("chkTodos");
  if (chk) chk.onchange = () => { S.verTodos = chk.checked; desenhar(); };

  const virar = document.getElementById("btnVirar");
  if (virar) virar.onclick = () => {
    S.sessao.virado = true; desenhar();
    falar(S.sessao.fila[S.sessao.pos].es);
  };
  q("[data-resp]").forEach((b) => (b.onclick = () => responder(b.dataset.resp)));

  const mic = document.getElementById("btnMic");
  if (mic) mic.onclick = () => { if (!S.gravando) gravarFala(); };
  const ant = document.getElementById("btnAnt"), prox = document.getElementById("btnProx");
  if (ant) ant.onclick = () => { S.fraseIdx = Math.max(0, (S.fraseIdx || 0) - 1); S.ultimaPron = null; desenhar(); };
  if (prox) prox.onclick = () => { S.fraseIdx = (S.fraseIdx || 0) + 1; S.ultimaPron = null; desenhar(); };

  const fAllow = document.getElementById("fAllow");
  if (fAllow) fAllow.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(fAllow);
    const email = f.get("email").trim().toLowerCase();
    try {
      await S.store.setAllow(email, { nome: f.get("nome").trim(), trilha: f.get("trilha"), ativo: true, liberadoEm: Date.now() });
      toast("Acesso liberado para " + email);
      S.admin = null; desenhar();
    } catch (e) { toast("Erro: " + e.message); }
  };
  q("[data-toggle]").forEach((b) => (b.onclick = async () => {
    const ativo = b.dataset.ativo !== "1";
    try { await S.store.setAllow(b.dataset.toggle, { ativo }); S.admin = null; desenhar(); }
    catch (e) { toast("Erro: " + e.message); }
  }));
  const atu = document.getElementById("btnAtualizar");
  if (atu) atu.onclick = () => { S.admin = null; desenhar(); };
}

// Atualiza o total de palavras aprendidas no perfil (para o painel da família)
setInterval(() => {
  if (!S.auth || !S.perfil) return;
  const n = Object.values(S.cards).filter(aprendida).length;
  if (n !== S.perfil.palavrasAprendidas) {
    S.perfil.palavrasAprendidas = n;
    S.store.setUser(S.auth.uid, { palavrasAprendidas: n }).catch(() => {});
  }
}, 30000);

// Atualiza a tela inicial a cada minuto (contador de tempo)
setInterval(() => { if (S.perfil && S.tela === "inicio" && !document.querySelector(".modal")) desenhar(); }, 60000);

// Service worker (permite instalar no celular)
if ("serviceWorker" in navigator && !DEMO) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

iniciar();
