import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot
} from
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


/* =========================================================
   FIREBASE
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyAew9fVw91DarhE9mUUIy2VZ2sCVxrAX44",
  authDomain: "mchost-9516b.firebaseapp.com",
  projectId: "mchost-9516b",
  storageBucket: "mchost-9516b.firebasestorage.app",
  messagingSenderId: "692774609042",
  appId: "1:692774609042:web:dd447dc87803450d22864b",
  measurementId: "G-ED4W6V8CNT"
};

const firebaseApp = initializeApp(firebaseConfig);

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);


/* =========================================================
   SETTINGS
   ========================================================= */

const HOSTNAME = "freemchosting.vexr.dev";

const MAX_SERVERS = 3;
const MAX_FREE_RAM = 3072;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

let registerMode = false;
let currentServerId = null;
let serverUnsubscribe = null;
let serversUnsubscribe = null;


/* =========================================================
   AUTH MODE
   ========================================================= */

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


/* =========================================================
   AUTH
   ========================================================= */

$("authForm").onsubmit = async e => {

  e.preventDefault();

  $("authMsg").textContent = "";

  try {

    const email =
      $("email").value.trim();

    const password =
      $("password").value;

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

    console.error(err);

    $("authMsg").textContent =
      err.message.replace("Firebase: ", "");

  }
};


/* =========================================================
   LOGOUT
   ========================================================= */

$("logout").onclick = () => {

  signOut(auth);

};


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(auth, async user => {

  const loggedIn = !!user;

  $("auth").classList.toggle(
    "hidden",
    loggedIn
  );

  $("app").classList.toggle(
    "hidden",
    !loggedIn
  );

  $("logout").classList.toggle(
    "hidden",
    !loggedIn
  );


  if (!user) {

    if (serversUnsubscribe) {
      serversUnsubscribe();
      serversUnsubscribe = null;
    }

    if (serverUnsubscribe) {
      serverUnsubscribe();
      serverUnsubscribe = null;
    }

    return;
  }


  $("who").textContent =
    user.email || user.uid;

  await ensureUserProfile(user);

  watchServers(user.uid);

});


/* =========================================================
   USER PROFILE
   ========================================================= */

async function ensureUserProfile(user) {

  const profileRef =
    doc(db, "users", user.uid);

  const snap =
    await getDoc(profileRef);

  if (!snap.exists()) {

    await setDoc(profileRef, {

      email: user.email || "",

      maxServers: MAX_SERVERS,

      ramLimit: MAX_FREE_RAM,

      createdAt: Date.now()

    });

  }

}


/* =========================================================
   WATCH SERVERS
   ========================================================= */

function watchServers(uid) {

  if (serversUnsubscribe) {
    serversUnsubscribe();
  }

  const q = query(
    collection(db, "servers"),
    where("owner", "==", uid)
  );

  serversUnsubscribe =
    onSnapshot(q, snapshot => {

      const box = $("servers");

      box.innerHTML = "";

      const servers = [];

      snapshot.forEach(snap => {

        servers.push({
          id: snap.id,
          ...snap.data()
        });

      });


      if (!servers.length) {

        box.innerHTML = `
          <div class="card">
            <h3>No servers yet</h3>
            <div class="muted">
              Create one to get started.
            </div>
          </div>
        `;

        return;
      }


      for (const server of servers) {

        const el =
          document.createElement("div");

        el.className =
          "card server";

        const status =
          server.status || "offline";

        el.innerHTML = `

          <div class="row between">

            <h3></h3>

            <span class="pill">
              ${escapeHtml(status)}
            </span>

          </div>

          <div class="muted address"></div>

          <div class="muted">
            ${escapeHtml(server.version || "")}
            ·
            ${Number(server.ram || 0)} MB
          </div>
        `;


        el.querySelector("h3")
          .textContent =
            server.name || server.id;


        el.querySelector(".address")
          .textContent =
            server.address ||
            "Not online yet";


        el.onclick = () =>
          openServer(
            server.id,
            server
          );


        box.appendChild(el);

      }

    });

}


/* =========================================================
   CREATE SERVER DIALOG
   ========================================================= */

$("newServer").onclick = () => {

  $("ramNotice").textContent = "";

  $("createDialog").showModal();

};


$("ramInput").onchange = () => {

  const ram =
    Number($("ramInput").value);

  if (ram === 4096) {

    $("ramNotice").textContent =
      "4 GB RAM is restricted. A $3 purchase is required.";

  } else {

    $("ramNotice").textContent = "";

  }

};


/* =========================================================
   CREATE SERVER
   ========================================================= */

$("createForm").onsubmit = async e => {

  e.preventDefault();

  const user = auth.currentUser;

  if (!user) return;


  const name =
    $("serverNameInput")
      .value
      .trim();

  const version =
    $("versionInput").value;

  const ram =
    Number($("ramInput").value);


  if (!name) return;


  try {

    /* -------------------------------------------------------
       4 GB TEST PURCHASE
       ------------------------------------------------------- */

    if (ram === 4096) {

      const answer =
        confirm(
          "4 GB RAM is restricted.\n\n" +
          "This is a TEST purchase only.\n\n" +
          "Pretend to purchase the $3 upgrade?"
        );

      if (!answer) return;


      await addDoc(
        collection(
          db,
          "ramPurchaseRequests"
        ),
        {

          owner: user.uid,

          email:
            user.email || "",

          ram: 4096,

          amount: 3,

          status: "test",

          createdAt: Date.now()

        }
      );

    }


    /* -------------------------------------------------------
       SERVER
       ------------------------------------------------------- */

    const serverRef =
      doc(
        collection(db, "servers")
      );

    await setDoc(
      serverRef,
      {

        owner: user.uid,

        name,

        version,

        ram,

        status: "provisioning",

        address: "",

        port: 0,

        createdAt: Date.now()

      }
    );


    /* -------------------------------------------------------
       JOB
       ------------------------------------------------------- */

    await addDoc(
      collection(db, "jobs"),
      {

        owner: user.uid,

        serverId:
          serverRef.id,

        type: "provision",

        createdAt: Date.now(),

        status: "queued"

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
      "Create server failed: " +
      err.message
    );

  }

};


/* =========================================================
   OPEN SERVER
   ========================================================= */

async function openServer(
  id,
  server
) {

  currentServerId = id;

  $("serverPanel")
    .classList
    .remove("hidden");


  $("serverName").textContent =
    server.name || id;

  $("serverAddress").textContent =
    server.address ||
    "Waiting for agent…";

  $("serverStatus").textContent =
    server.status ||
    "offline";


  if (serverUnsubscribe) {
    serverUnsubscribe();
  }


  serverUnsubscribe =
    onSnapshot(
      doc(db, "servers", id),
      snap => {

        if (!snap.exists()) return;

        const s =
          snap.data();


        $("serverName")
          .textContent =
            s.name || id;

        $("serverAddress")
          .textContent =
            s.address ||
            "Waiting for agent…";

        $("serverStatus")
          .textContent =
            s.status ||
            "offline";

        $("console")
          .textContent =
            s.console ||
            "Waiting for the hosting agent…";

      }
    );


  await refreshFiles();

}


/* =========================================================
   START / STOP / RESTART
   ========================================================= */

document
  .querySelectorAll("[data-action]")
  .forEach(button => {

    button.onclick = async () => {

      const user =
        auth.currentUser;

      if (!user ||
          !currentServerId) {

        return;

      }


      try {

        await addDoc(
          collection(db, "jobs"),
          {

            owner: user.uid,

            serverId:
              currentServerId,

            type:
              button.dataset.action,

            createdAt:
              Date.now(),

            status:
              "queued"

          }
        );

      } catch (err) {

        console.error(err);

        alert(
          "Firebase denied this operation."
        );

      }

    };

  });


/* =========================================================
   COMMAND LINE
   ========================================================= */

$("commandForm").onsubmit =
  async e => {

    e.preventDefault();

    const user =
      auth.currentUser;

    if (!user ||
        !currentServerId) {

      $("commandMsg")
        .textContent =
          "Select a server first.";

      return;

    }


    let command =
      $("commandInput")
        .value
        .trim();


    if (!command) return;


    if (command.startsWith("/")) {

      command =
        command.substring(1);

    }


    try {

      await addDoc(
        collection(db, "jobs"),
        {

          owner: user.uid,

          serverId:
            currentServerId,

          type: "command",

          command,

          createdAt:
            Date.now(),

          status:
            "queued"

        }
      );


      $("commandInput").value = "";

      $("commandMsg")
        .textContent =
          "Command sent.";

    } catch (err) {

      console.error(err);

      $("commandMsg")
        .textContent =
          "Firebase denied this command.";

    }

  };


/* =========================================================
   FILE INDEX
   ========================================================= */

$("refreshFiles").onclick =
  refreshFiles;


async function refreshFiles() {

  const user =
    auth.currentUser;

  if (!user ||
      !currentServerId) {

    return;

  }


  try {

    const q = query(
      collection(
        db,
        "serverFiles"
      ),

      where(
        "owner",
        "==",
        user.uid
      ),

      where(
        "serverId",
        "==",
        currentServerId
      )
    );


    const snapshot =
      await getDocs(q);

    const files =
      $("files");

    files.innerHTML = "";


    if (snapshot.empty) {

      files.innerHTML =
        `<div class="muted">
          No file index reported yet.
        </div>`;

      return;

    }


    snapshot.forEach(
      snap => {

        const info =
          snap.data();

        const div =
          document.createElement("div");

        div.className =
          "file";

        div.textContent =
          `${info.path || snap.id}` +
          ` — ${info.type || "file"}` +
          (
            info.size
              ? ` — ${info.size} bytes`
              : ""
          );

        files.appendChild(div);

      }
    );

  } catch (err) {

    console.error(
      "File refresh:",
      err
    );

  }

}


/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}
