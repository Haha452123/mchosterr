import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  get
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";

/*
 * Firebase configuration
 * Project: p9w-26379
 */

const firebaseConfig = {
  apiKey: "AIzaSyAcQu7U91BAoVuVdCzFrVfqvzGK7iyJnjA",
  authDomain: "p9w-26379.firebaseapp.com",
  databaseURL: "https://p9w-26379-default-rtdb.firebaseio.com",
  projectId: "p9w-26379",
  storageBucket: "p9w-26379.firebasestorage.app",
  messagingSenderId: "509609712694",
  appId: "1:509609712694:web:53cbb69a47860dd94e8c97",
  measurementId: "G-Y25DSCRQXH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);

let registerMode = false;
let currentServerId = null;
let stopServerListener = null;

/* =========================
   AUTH
========================= */

$("toggleAuth").onclick = () => {
  registerMode = !registerMode;

  $("authTitle").textContent =
    registerMode ? "Register" : "Sign in";

  $("authSubmit").textContent =
    registerMode ? "Create account" : "Sign in";

  $("toggleAuth").textContent =
    registerMode
      ? "Already have an account? Sign in"
      : "Need an account? Register";

  $("authMsg").textContent = "";
};

$("authForm").onsubmit = async e => {
  e.preventDefault();

  $("authMsg").textContent = "";

  const email = $("email").value.trim();
  const password = $("password").value;

  try {
    if (registerMode) {
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
    } else {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
    }

  } catch (err) {
    console.error("Firebase Auth error:", err);

    $("authMsg").textContent =
      err.message.replace("Firebase: ", "");
  }
};

$("logout").onclick = async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Logout error:", err);
  }
};

/* =========================
   AUTH STATE
========================= */

onAuthStateChanged(auth, user => {

  $("auth").classList.toggle("hidden", !!user);
  $("app").classList.toggle("hidden", !user);
  $("logout").classList.toggle("hidden", !user);

  if (user) {

    $("who").textContent = user.email;

    watchServers(user.uid);

  } else {

    $("who").textContent = "";

    if (stopServerListener) {
      stopServerListener();
      stopServerListener = null;
    }

    currentServerId = null;
    $("servers").innerHTML = "";
    $("serverPanel").classList.add("hidden");
  }
});

/* =========================
   SERVER LIST
========================= */

function watchServers(uid) {

  const r = ref(db, `servers/${uid}`);

  onValue(r, snap => {

    const data = snap.val() || {};
    const box = $("servers");

    box.innerHTML = "";

    for (const [id, s] of Object.entries(data)) {

      const el = document.createElement("div");

      el.className = "card server";

      el.innerHTML = `
        <div class="row between">
          <h3></h3>
          <span class="pill"></span>
        </div>

        <div class="muted address"></div>

        <div class="muted version"></div>
      `;

      el.querySelector("h3").textContent =
        s.name || id;

      el.querySelector(".pill").textContent =
        s.status || "offline";

      el.querySelector(".address").textContent =
        s.address || "Not online yet";

      el.querySelector(".version").textContent =
        `${s.version || ""} · ${s.ram || 1024} MB`;

      el.onclick = () => openServer(id, s);

      box.appendChild(el);
    }

    if (!Object.keys(data).length) {

      box.innerHTML = `
        <div class="card">
          <h3>No servers yet</h3>
          <div class="muted">
            Create one to get started.
          </div>
        </div>
      `;
    }
  });
}

/* =========================
   CREATE SERVER
========================= */

$("newServer").onclick = () => {
  $("createDialog").showModal();
};

$("createForm").onsubmit = async e => {

  if (e.submitter?.value === "cancel") {
    return;
  }

  e.preventDefault();

  const user = auth.currentUser;

  if (!user) {
    $("createDialog").close();
    return;
  }

  try {

    const id =
      push(ref(db, `servers/${user.uid}`)).key;

    const name =
      $("serverNameInput").value.trim();

    const version =
      $("versionInput").value;

    const ram =
      Number($("ramInput").value);

    await set(
      ref(db, `servers/${user.uid}/${id}`),
      {
        name,
        version,
        ram,
        status: "provisioning",
        createdAt: Date.now(),
        address: ""
      }
    );

    await set(
      ref(db, `jobs/${id}`),
      {
        owner: user.uid,
        serverId: id,
        type: "provision",
        createdAt: Date.now()
      }
    );

    $("createDialog").close();

    $("serverNameInput").value = "";

  } catch (err) {

    console.error("Create server error:", err);

    alert(
      "Could not create server: " +
      err.message
    );
  }
};

/* =========================
   OPEN SERVER
========================= */

async function openServer(id, server) {

  currentServerId = id;

  $("serverPanel").classList.remove("hidden");

  $("serverName").textContent =
    server.name || id;

  $("serverAddress").textContent =
    server.address || "Waiting for agent…";

  $("serverStatus").textContent =
    server.status || "offline";

  if (stopServerListener) {
    stopServerListener();
  }

  stopServerListener = onValue(
    ref(
      db,
      `servers/${auth.currentUser.uid}/${id}`
    ),
    snap => {

      const s = snap.val() || {};

      $("serverName").textContent =
        s.name || id;

      $("serverAddress").textContent =
        s.address || "Waiting for agent…";

      $("serverStatus").textContent =
        s.status || "offline";

      $("console").textContent =
        s.console ||
        "Waiting for the hosting agent…";
    }
  );

  await refreshFiles();
}

/* =========================
   SERVER ACTIONS
========================= */

document
  .querySelectorAll("[data-action]")
  .forEach(btn => {

    btn.onclick = async () => {

      if (!currentServerId || !auth.currentUser) {
        return;
      }

      const type = btn.dataset.action;

      try {

        const id =
          push(ref(db, "jobs")).key;

        await set(
          ref(db, `jobs/${id}`),
          {
            owner: auth.currentUser.uid,
            serverId: currentServerId,
            type,
            createdAt: Date.now()
          }
        );

      } catch (err) {

        console.error(
          "Server action error:",
          err
        );

        alert(
          "Could not send server action: " +
          err.message
        );
      }
    };
  });

/* =========================
   FILES
========================= */

$("refreshFiles").onclick = refreshFiles;

async function refreshFiles() {

  if (!currentServerId || !auth.currentUser) {
    return;
  }

  try {

    const snap = await get(
      ref(
        db,
        `serverFiles/${auth.currentUser.uid}/${currentServerId}`
      )
    );

    const files = snap.val() || {};

    $("files").innerHTML = "";

    for (const [path, info] of Object.entries(files)) {

      const div =
        document.createElement("div");

      div.className = "file";

      div.textContent =
        `${path} — ${info.type || "file"}` +
        `${info.size ? ` — ${info.size} bytes` : ""}`;

      $("files").appendChild(div);
    }

    if (!Object.keys(files).length) {

      $("files").innerHTML =
        '<div class="muted">' +
        'No file index reported yet.' +
        '</div>';
    }

  } catch (err) {

    console.error(
      "File loading error:",
      err
    );

    $("files").innerHTML =
      `<div class="muted">
        Could not load files.
      </div>`;
  }
}
