import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


/* =========================
   FIREBASE CONFIG
========================= */

const firebaseConfig = {
  apiKey: "AIzaSyAew9fVw91DarhE9mUUIy2VZ2sCVxrAX44",
  authDomain: "mchost-9516b.firebaseapp.com",
  projectId: "mchost-9516b",
  storageBucket: "mchost-9516b.firebasestorage.app",
  messagingSenderId: "692774609042",
  appId: "1:692774609042:web:dd447dc87803450d22864b",
  measurementId: "G-ED4W6V8CNT"
};


/* =========================
   INITIALIZE FIREBASE
========================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let registerMode = false;
let currentServerId = null;
let stopServerListener = null;
let stopServersListener = null;


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

    if (stopServersListener) {
      stopServersListener();
      stopServersListener = null;
    }

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
   WATCH SERVERS
========================= */

function watchServers(uid) {

  if (stopServersListener) {
    stopServersListener();
  }

  const serversRef = collection(db, "servers");

  const q = query(
    serversRef,
    where("owner", "==", uid)
  );

  stopServersListener = onSnapshot(
    q,
    snapshot => {

      const box = $("servers");

      box.innerHTML = "";

      snapshot.forEach(serverDoc => {

        const s = serverDoc.data();

        const id = serverDoc.id;

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

        el.onclick = () =>
          openServer(id, s);

        box.appendChild(el);
      });


      if (snapshot.empty) {

        box.innerHTML = `
          <div class="card">
            <h3>No servers yet</h3>
            <div class="muted">
              Create one to get started.
            </div>
          </div>
        `;
      }

    },

    error => {

      console.error(
        "Firestore server listener error:",
        error
      );

      $("servers").innerHTML = `
        <div class="card">
          <h3>Could not load servers</h3>
          <div class="muted">
            ${error.message}
          </div>
        </div>
      `;
    }
  );
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
    return;
  }

  try {

    const name =
      $("serverNameInput").value.trim();

    const version =
      $("versionInput").value;

    const ram =
      Number($("ramInput").value);


    /* Create server */

    const serverRef =
      await addDoc(
        collection(db, "servers"),
        {
          owner: user.uid,
          name,
          version,
          ram,
          status: "provisioning",
          createdAt: Date.now(),
          address: ""
        }
      );


    /* Create provisioning job */

    await addDoc(
      collection(db, "jobs"),
      {
        owner: user.uid,
        serverId: serverRef.id,
        type: "provision",
        createdAt: Date.now()
      }
    );


    $("createDialog").close();

    $("serverNameInput").value = "";

  } catch (err) {

    console.error(
      "Create server error:",
      err
    );

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
    server.address ||
    "Waiting for agent…";

  $("serverStatus").textContent =
    server.status ||
    "offline";


  if (stopServerListener) {
    stopServerListener();
  }


  const serverRef =
    doc(db, "servers", id);


  stopServerListener =
    onSnapshot(
      serverRef,
      snap => {

        if (!snap.exists()) {
          return;
        }

        const s = snap.data();

        $("serverName").textContent =
          s.name || id;

        $("serverAddress").textContent =
          s.address ||
          "Waiting for agent…";

        $("serverStatus").textContent =
          s.status ||
          "offline";

        $("console").textContent =
          s.console ||
          "Waiting for the hosting agent…";
      },

      error => {

        console.error(
          "Server listener error:",
          error
        );
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

      if (
        !currentServerId ||
        !auth.currentUser
      ) {
        return;
      }

      const type =
        btn.dataset.action;

      try {

        await addDoc(
          collection(db, "jobs"),
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

$("refreshFiles").onclick =
  refreshFiles;


async function refreshFiles() {

  if (
    !currentServerId ||
    !auth.currentUser
  ) {
    return;
  }


  try {

    const filesQuery =
      query(
        collection(db, "serverFiles"),
        where(
          "owner",
          "==",
          auth.currentUser.uid
        ),
        where(
          "serverId",
          "==",
          currentServerId
        )
      );


    const snapshot =
      await getDocs(filesQuery);


    $("files").innerHTML = "";


    snapshot.forEach(fileDoc => {

      const info =
        fileDoc.data();

      const div =
        document.createElement("div");

      div.className = "file";

      div.textContent =
        `${info.path || fileDoc.id}` +
        ` — ${info.type || "file"}` +
        `${
          info.size
            ? ` — ${info.size} bytes`
            : ""
        }`;

      $("files").appendChild(div);
    });


    if (snapshot.empty) {

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
