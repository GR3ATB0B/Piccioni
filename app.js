import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  serverTimestamp, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ----- Config / constants -----
const PASSKEY = "Piccioni";
const PASSWORD_SUFFIX = "lovespiccioni";
const wsId = "piccioni-default";
const cfg = window.PICCIONI_FIREBASE_CONFIG;

// ----- DOM refs -----
const memberList = document.getElementById("member-list");
const updatesListHome  = document.getElementById("updates-list");
const updatesListPosts = document.getElementById("updates-list-posts");
const chatMessages = document.getElementById("chat-messages");
const todoList = document.getElementById("todo-list");
const whoami = document.getElementById("whoami");
const passkeyGate = document.getElementById("passkey-gate");
const gate = document.getElementById("gate");
const forum = document.getElementById("forum");

// Forms and inputs
const passkeyForm = document.getElementById("passkey-form");
const passkeyInput = document.getElementById("passkey");
const passkeyError = document.getElementById("passkey-error");
const passwordForm = document.getElementById("password-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorBanner = document.getElementById("error");

const postFormHome   = document.getElementById("post-form");
const postFormPosts  = document.getElementById("post-form-posts");
const messageInputHome  = document.getElementById("message");
const messageInputPosts = document.getElementById("message-posts");

const chatForm = document.getElementById("chat-form");
const chatMessageInput = document.getElementById("chat-message");

const todoForm = document.getElementById("todo-form");
const taskInput = document.getElementById("task");
const discussionInput = document.getElementById("discussion");

// ----- Member directory -----
const defaultMembers = [
  { name: "Wade", status: "Founder" },
  { name: "Sam", status: "Junior Founder" },
  { name: "George", status: "Founder" },
  { name: "Daniel", status: "Member" },
  { name: "Westin", status: "Member" },
  { name: "Tim", status: "Member" },
  { name: "Miles", status: "Member" },
  { name: "Sean", status: "Member" },
  { name: "Nash", status: "Member" },
  { name: "Brody", status: "Member" },
  { name: "Aleck", status: "Member" },
  { name: "Stiney", status: "Member" },
  { name: "Chosborne", status: "Member" },
  { name: "Wicky", status: "Member" },
  { name: "Brice", status: "Member" }
];

function renderMembers(list) {
  if (!memberList) return;
  memberList.innerHTML = "";
  list.forEach(member => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = member.name;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = member.status || "Member";
    li.appendChild(name);
    li.appendChild(badge);
    memberList.appendChild(li);
  });
}

function renderDefaultMembers() {
  renderMembers(defaultMembers);
}

renderDefaultMembers();

// Pages & router
const pages = {
  home:  document.getElementById('page-home'),
  posts: document.getElementById('page-posts'),
  chat:  document.getElementById('page-chat'),
  todos: document.getElementById('page-todos')
};
const navlinks = Array.from(document.querySelectorAll('.navlink'));

function show(view){
  Object.entries(pages).forEach(([k,el])=> el && el.classList.toggle('hidden', k!==view));
  navlinks.forEach(a=> a.classList.toggle('active', a.dataset.view === view));
  startRealtime(); // attach once
}
function routeFromHash(){
  const h = (location.hash || '#home').replace('#','');
  show(pages[h] ? h : 'home');
}
window.addEventListener('hashchange', routeFromHash);

// ----- Utilities -----
const dateFmt = new Intl.DateTimeFormat([], { dateStyle:"short", timeStyle:"short" });
const ts = v => {
  if (!v) return new Date();
  if (v?.toDate) return v.toDate();
  if (typeof v === "number") return new Date(v);
  if (typeof v === "object" && typeof v.seconds === "number") {
    return new Date(v.seconds * 1000 + (v.nanoseconds || 0) / 1e6);
  }
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? new Date() : new Date(parsed);
  }
  return new Date();
};
const fmt = v => dateFmt.format(ts(v));
const sortBy = arr => arr.slice().sort((a,b)=> (ts(b.timestamp)-ts(a.timestamp)));

let currentMember = null; // { displayName }
let app, db;
let subs = false;
let firebaseReady = false;

// ----- Init Firebase -----
if (!cfg || !cfg.apiKey || !cfg.projectId || !cfg.appId) {
  console.error("Firebase config missing.");
  alert("Firebase config missing. Paste your Firebase config in index.html.");
} else {
  app = initializeApp(cfg);
  db = getFirestore(app);
  firebaseReady = true;

  // Debug
  window.__app = app; window.__db = db;
  console.log("Using Firebase config:", cfg);

}

// ----- Renderers -----
function renderUpdates(items=[]) {
  const targets = [updatesListHome, updatesListPosts].filter(Boolean);
  targets.forEach(target => {
    target.innerHTML = "";
    if (!items.length) { const p=document.createElement("p"); p.textContent="No posts yet."; target.appendChild(p); return; }
    sortBy(items).forEach(u=>{
      const card=document.createElement("article"); card.className="update";
      card.innerHTML = `<strong>${u.author||"Anonymous"}</strong><p>${u.message||""}</p><small>${fmt(u.timestamp)}</small>`;
      target.appendChild(card);
    });
  });
}

function renderChat(items=[]) {
  chatMessages.innerHTML = "";
  if (!items.length) { const p=document.createElement("p"); p.textContent="No messages yet."; chatMessages.appendChild(p); return; }
  sortBy(items).forEach(m=>{
    const row=document.createElement("div"); row.className="msg";
    const bubble=document.createElement("div"); bubble.className="bubble";
    bubble.innerHTML = `<strong>${m.author||"Anonymous"}</strong><div>${m.message||""}</div>`;
    const meta=document.createElement("small"); meta.textContent = fmt(m.timestamp);
    row.appendChild(bubble); row.appendChild(meta);
    chatMessages.appendChild(row);
  });
}

function renderTodos(items=[]) {
  todoList.innerHTML = "";
  if (!items.length) { const p=document.createElement("p"); p.textContent="No to-dos yet."; todoList.appendChild(p); return; }
  sortBy(items).forEach(t=>{
    const card=document.createElement("article"); card.className="todo-item"; if (t.completed) card.classList.add("completed");
    const completedBadge = t.completed ? `<span class="badge badge-small">Completed</span>` : "";
    card.innerHTML = `
      <div class="todo-header">
        <strong>${t.task||"Untitled"}</strong>
        <div class="todo-actions">
          ${completedBadge}
          <button type="button" class="todo-toggle" data-id="${t.id}" data-completed="${!!t.completed}">${t.completed?"Reopen":"Mark Done"}</button>
        </div>
      </div>
      <div class="todo-details">
        <p>${t.discussion||""}</p>
        <small>${fmt(t.timestamp)}</small>
      </div>`;
    todoList.appendChild(card);
  });
}

// ----- Firestore reads (realtime) -----
let postsUnsub=null, chatUnsub=null, todosUnsub=null;
async function startRealtime() {
  if (!firebaseReady || !db) {
    console.warn("Realtime unavailable: Firebase not initialized.");
    return;
  }
  if (subs) return; subs = true;
  console.log("Realtime listeners attached for:", wsId);

  postsUnsub = onSnapshot(query(collection(db,"workspaces",wsId,"posts"), orderBy("timestamp","desc")), snap=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderUpdates(items);
  });

  chatUnsub = onSnapshot(query(collection(db,"workspaces",wsId,"chat"), orderBy("timestamp","desc")), snap=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderChat(items);
  });

  todosUnsub = onSnapshot(query(collection(db,"workspaces",wsId,"todos"), orderBy("timestamp","desc")), snap=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderTodos(items);
  });
}

// ----- Credential helpers -----
function findMemberByName(input) {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  return defaultMembers.find(m => m.name.toLowerCase() === normalized) || null;
}

function credentialsValid(member, password) {
  if (!member) return false;
  const expected = `${member.name.toLowerCase()}${PASSWORD_SUFFIX}`;
  return password.trim().toLowerCase() === expected;
}

function unlock() {
  if (!firebaseReady) {
    console.warn("Proceeding in local mode: Firebase not configured.");
  }
  if (!currentMember) {
    errorBanner.classList.remove("hidden");
    return;
  }

  passkeyGate.classList.add("hidden");
  gate.classList.add("hidden");
  forum.classList.remove("hidden");
  whoami.textContent = `Signed in as ${currentMember.displayName}`;
  if (!firebaseReady || !memberList.hasChildNodes()) {
    renderDefaultMembers();
  }
  routeFromHash();
  startRealtime();
}

passwordForm.addEventListener("submit", e => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  const member = findMemberByName(username);

  if (credentialsValid(member, password)) {
    currentMember = { displayName: member.name };
    errorBanner.classList.add("hidden");
    usernameInput.value = "";
    passwordInput.value = "";
    unlock();
  } else {
    errorBanner.classList.remove("hidden");
    passwordInput.value = "";
    passwordInput.focus();
  }
});

if (passkeyForm && passkeyInput) {
  passkeyForm.addEventListener("submit", e => {
    e.preventDefault();
    const key = passkeyInput.value.trim();
    if (key.toLowerCase() === PASSKEY.toLowerCase()) {
      passkeyError?.classList.add("hidden");
      passkeyInput.value = "";
      passkeyGate?.classList.add("hidden");
      gate?.classList.remove("hidden");
      usernameInput?.focus();
    } else {
      passkeyError?.classList.remove("hidden");
      passkeyInput.value = "";
      passkeyInput.focus();
    }
  });
} else {
  console.warn("Passkey form not found; ensure #passkey-form and inputs exist in index.html.");
}

// ----- Posting -----
function bindPostForm(formEl, inputEl){
  if (!formEl) return;
  formEl.addEventListener('submit', async e=>{
    e.preventDefault();
    if (!firebaseReady) {
      alert("Posting is disabled until Firebase is configured.");
      return;
    }
    try {
      const author = currentMember?.displayName || 'Anonymous';
      const message = (inputEl?.value||'').trim();
      if (!message) return;
      await addDoc(collection(db, "workspaces", wsId, "posts"), {
        author, message, timestamp: serverTimestamp()
      });
      formEl.reset();
    } catch (err) {
      console.error("Post submit failed:", err);
      alert(`Post failed: ${err?.code || ''} ${err?.message || err}`);
    }
  });
}
bindPostForm(postFormHome,  messageInputHome);
bindPostForm(postFormPosts, messageInputPosts);

// ----- Chat -----
chatForm?.addEventListener("submit", async e=>{
  e.preventDefault();
  if (!firebaseReady) {
    alert("Chat is disabled until Firebase is configured.");
    return;
  }
  try {
    const author = currentMember?.displayName || 'Anonymous';
    const message = chatMessageInput.value.trim();
    if (!message) return;
    await addDoc(collection(db, "workspaces", wsId, "chat"), {
      author, message, timestamp: serverTimestamp()
    });
    chatForm.reset();
  } catch (err) {
    console.error("Chat submit failed:", err);
    alert(`Chat failed: ${err?.code || ''} ${err?.message || err}`);
  }
});

// ----- Todos -----
todoForm?.addEventListener("submit", async e=>{
  e.preventDefault();
  if (!firebaseReady) {
    alert("To-Dos are disabled until Firebase is configured.");
    return;
  }
  try {
    const task = taskInput.value.trim();
    const discussion = discussionInput.value.trim();
    if (!task || !discussion) return;
    await addDoc(collection(db, "workspaces", wsId, "todos"), {
      task, discussion, completed: false, completedAt: null, timestamp: serverTimestamp()
    });
    todoForm.reset();
    taskInput.focus();
  } catch (err) {
    console.error("Todo submit failed:", err);
    alert(`Todo failed: ${err?.code || ''} ${err?.message || err}`);
  }
});

todoList?.addEventListener("click", async e=>{
  const btn = e.target.closest(".todo-toggle"); if (!btn) return;
  if (!firebaseReady) {
    alert("To-Dos are disabled until Firebase is configured.");
    return;
  }
  const id = btn.dataset.id; const done = btn.dataset.completed === "true";
  await updateDoc(doc(db,"workspaces",wsId,"todos",id), { completed: !done, completedAt: !done ? serverTimestamp() : null });
});

// If you land with #hash after sign-in, make sure a page shows when forum appears
// The first call happens after unlock() reveals the forum.
