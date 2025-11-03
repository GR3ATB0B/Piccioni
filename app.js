import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  serverTimestamp, updateDoc, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ----- Config / constants -----
const PASSWORD = "Piccioni";
const wsId = "piccioni-default";
const cfg = window.PICCIONI_FIREBASE_CONFIG;

// ----- DOM refs -----
const memberList = document.getElementById("member-list");
const updatesListHome  = document.getElementById("updates-list");
const updatesListPosts = document.getElementById("updates-list-posts");
const chatMessages = document.getElementById("chat-messages");
const todoList = document.getElementById("todo-list");
const whoami = document.getElementById("whoami");
const gate = document.getElementById("gate");
const forum = document.getElementById("forum");

// Forms and inputs
const passwordForm = document.getElementById("password-form");
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

// Onboarding elements
const onboarding = document.getElementById('onboarding');
const obPhoneInput = document.getElementById('ob-phone');
const obCodeInput = document.getElementById('ob-code');
const obSendBtn = document.getElementById('ob-send');
const obVerifyBtn = document.getElementById('ob-verify');
const obPhoneStatus = document.getElementById('ob-phone-status');
const obNameStep = document.getElementById('ob-step-name');
const obPhoneStep = document.getElementById('ob-step-phone');
const obNameInput = document.getElementById('ob-name');
const obSaveBtn = document.getElementById('ob-save');

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

let currentMember = null; // { uid, displayName, phoneNumber }
let app, db, auth;
let phoneConfirmation = null;
let subs = false;
let firebaseReady = false;

// ----- Init Firebase -----
if (!cfg || !cfg.apiKey || !cfg.projectId || !cfg.appId) {
  console.error("Firebase config missing.");
  alert("Firebase config missing. Paste your Firebase config in index.html.");
} else {
  app = initializeApp(cfg);
  db = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;

  // Debug
  window.__app = app; window.__db = db; window.__auth = auth;
  console.log("Using Firebase config:", cfg);

  // reCAPTCHA for onboarding (invisible)
  try {
    const obRecaptcha = new RecaptchaVerifier(auth, 'ob-recaptcha', { size: 'invisible' });
    window.__obRecaptcha = obRecaptcha;
  } catch (e) {
    console.warn('Recaptcha init issue:', e);
  }

  // Members realtime
  const membersRef = collection(db, 'workspaces', wsId, 'members');
  onSnapshot(query(membersRef, orderBy('createdAt','asc')), snap => {
    memberList.innerHTML = '';
    snap.forEach(d => {
      const m = d.data();
      const li = document.createElement('li');
      li.textContent = m.displayName || (m.phoneNumber || d.id);
      memberList.appendChild(li);
    });
  });

  // Auth state
  onAuthStateChanged(auth, (user) => {
    whoami.textContent = user?.phoneNumber ? `Signed in (${user.phoneNumber})` : '';
  });
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

// ----- Member profile helpers -----
async function loadCurrentMember() {
  if (!auth.currentUser) return null;
  const uid = auth.currentUser.uid;
  const snap = await getDoc(doc(db,'workspaces',wsId,'members',uid));
  if (snap.exists()) {
    currentMember = { uid, ...(snap.data()) };
    return currentMember;
  }
  return null;
}

// ----- Onboarding actions -----
if (obSendBtn) obSendBtn.addEventListener('click', async () => {
  try {
    const num = (obPhoneInput.value||'').trim();
    if (!num) { obPhoneStatus.textContent = 'Enter phone like +14045551234'; return; }
    phoneConfirmation = await signInWithPhoneNumber(auth, num, window.__obRecaptcha);
    obPhoneStatus.textContent = 'Code sent. Enter the 6-digit code.';
  } catch (e) {
    console.error(e);
    obPhoneStatus.textContent = `Send failed: ${e?.code||''} ${e?.message||e}`;
  }
});

if (obVerifyBtn) obVerifyBtn.addEventListener('click', async () => {
  try {
    const code = (obCodeInput.value||'').trim();
    if (!phoneConfirmation) { obPhoneStatus.textContent = 'Send code first.'; return; }
    await phoneConfirmation.confirm(code);
    obPhoneStatus.textContent = 'Phone verified.';
    const member = await loadCurrentMember();
    if (member && member.displayName) {
      onboarding.classList.add('hidden');
      forum.classList.remove('hidden');
      routeFromHash();
      startRealtime();
      return;
    }
    obPhoneStep.classList.add('hidden');
    obNameStep.classList.remove('hidden');
  } catch (e) {
    console.error(e);
    if (e?.code === 'auth/invalid-verification-code') {
      obPhoneStatus.textContent = 'Invalid code. Double-check and try again.';
    } else if (e?.code === 'auth/too-many-requests') {
      obPhoneStatus.textContent = 'Too many attempts. Wait a few minutes or use a test number while developing.';
    } else {
      obPhoneStatus.textContent = `Verify failed: ${e?.code||''} ${e?.message||e}`;
    }
  }
});

if (obSaveBtn) obSaveBtn.addEventListener('click', async () => {
  try {
    const name = (obNameInput.value||'').trim();
    if (!name) { document.getElementById('ob-name-status').textContent = 'Enter a name'; return; }
    const uid = auth.currentUser.uid;
    await setDoc(doc(db,'workspaces',wsId,'members',uid), {
      displayName: name,
      phoneNumber: auth.currentUser.phoneNumber || null,
      createdAt: serverTimestamp()
    }, { merge: true });
    currentMember = { uid, displayName: name, phoneNumber: auth.currentUser.phoneNumber };
    onboarding.classList.add('hidden');
    forum.classList.remove('hidden');
    routeFromHash();
    startRealtime();
  } catch (e) {
    console.error(e);
    document.getElementById('ob-name-status').textContent = `Save failed: ${e?.code||''} ${e?.message||e}`;
  }
});

// ----- App flow: password → (onboarding) → forum -----
function unlock() {
  if (!firebaseReady) {
    alert("The app is offline because Firebase is not configured. Please add configuration and reload.");
    return;
  }
  (async () => {
    const u = auth.currentUser;
    if (u && u.phoneNumber) {
      const member = await loadCurrentMember();
      gate.classList.add('hidden');
      if (member && member.displayName) {
        onboarding.classList.add('hidden');
        forum.classList.remove('hidden');
        routeFromHash();
        startRealtime();
      } else {
        onboarding.classList.remove('hidden');
        obPhoneStep.classList.add('hidden');
        obNameStep.classList.remove('hidden');
      }
      return;
    }
    gate.classList.add('hidden');
    onboarding.classList.remove('hidden');
    forum.classList.add('hidden');
  })().catch(err => {
    console.error(err);
    alert(`Unlock failed: ${err?.code || ''} ${err?.message || err}.`);
  });
}

passwordForm.addEventListener("submit", e=>{
  e.preventDefault();
  if (passwordInput.value.trim() === PASSWORD) { errorBanner.classList.add("hidden"); unlock(); }
  else { errorBanner.classList.remove("hidden"); passwordInput.value=""; passwordInput.focus(); }
});

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
