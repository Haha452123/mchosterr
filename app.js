import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";


// ============================================================
// FIREBASE CONFIG
// ============================================================

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


// ============================================================
// SETTINGS
// ============================================================

// Default account allowance.
const DEFAULT_RAM = 3072;

// Maximum normal online servers.
const MAX_SERVERS = 3;

// Paid upgrade.
const UPGRADE_RAM = 4096;

// Price displayed to users.
const UPGRADE_PRICE = 3;


// ============================================================
// HELPERS
// ============================================================

const $ = id => document.getElementById(id);

function showMessage(element, message, error = false) {
  if (!element) return;

  element.textContent = message;

  element.style.color = error
    ? "#ff6b6b"
    : "";
}


function friendlyError(error) {
  if (!error) return "Something went wrong.";

  const code = error.code || "";

  const messages = {
    "auth/invalid-credential":
      "Invalid email or password.",

    "auth/invalid-email":
      "Please enter a valid email.",

    "auth/email-already-in-use":
      "That email is already registered.",

    "auth/weak-password":
      "Password must be at least 6 characters.",

    "auth/user-not-found":
      "Account not found.",

    "auth/wrong-password":
      "Incorrect password.",

    "permission-denied":
      "Firebase denied this operation. Check your Firestore rules."
  };

  return messages[code] ||
    error.message ||
    "Something went wrong.";
}


// ============================================================
// STATE
// ============================================================

let registerMode = false;

let currentServerId = null;

let unsubscribeServers = null;

let unsubscribeCurrentServer = null;

let unsubscribeProfile = null;

let currentProfile = null;


// ============================================================
// AUTH UI
// ============================================================

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


// ============================================================
// LOGIN / REGISTER
// ============================================================

$("authForm").onsubmit = async event => {

  event.preventDefault();

  showMessage($("authMsg"), "");

  const email =
    $("email").value.trim();

  const password =
    $("password").value;

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

  } catch (error) {

    console.error(error);

    showMessage(
      $("authMsg"),
      friendlyError(error),
      true
    );

  }
};


// ============================================================
// LOGOUT
// ============================================================

$("logout").onclick = async () => {

  try {

    await signOut(auth);

  } catch (error) {

    console.error(error);

  }

};


// ============================================================
// AUTH STATE
// ============================================================

onAuthStateChanged(auth, async user => {

  if (!user) {

    $("auth").classList.remove("hidden");

    $("app").classList.add("hidden");

    $("logout").classList.add("hidden");

    cleanupListeners();

    return;
  }


  $("auth").classList.add("hidden");

  $("app").classList.remove("hidden");

  $("logout").classList.remove("hidden");

  $("who").textContent =
    user.email || user.uid;


  try {

    await ensureUserProfile(user);

    watchProfile(user.uid);

    watchServers(user.uid);

  } catch (error) {

    console.error(
      "Account initialization error:",
      error
    );

    showMessage(
      $("purchaseMsg"),
      friendlyError(error),
      true
    );

  }

});


// ============================================================
// CLEANUP
// ============================================================

function cleanupListeners() {

  if (unsubscribeServers) {

    unsubscribeServers();

    unsubscribeServers = null;

  }


  if (unsubscribeCurrentServer) {

    unsubscribeCurrentServer();

    unsubscribeCurrentServer = null;

  }


  if (unsubscribeProfile) {

    unsubscribeProfile();

    unsubscribeProfile = null;

  }


  currentServerId = null;

  currentProfile = null;

}


// ============================================================
// USER PROFILE
// ============================================================

async function ensureUserProfile(user) {

  const userRef =
    doc(db, "users", user.uid);

  const snap =
    await getDoc(userRef);


  if (!snap.exists()) {

    await setDoc(userRef, {

      email: user.email || "",

      ramLimit: DEFAULT_RAM,

      maxServers: MAX_SERVERS,

      createdAt: Date.now()

    });

    return;

  }


  const data = snap.data();

  const changes = {};


  if (typeof data.ramLimit !== "number") {

    changes.ramLimit = DEFAULT_RAM;

  }


  if (typeof data.maxServers !== "number") {

    changes.maxServers = MAX_SERVERS;

  }


  if (Object.keys(changes).length) {

    await updateDoc(
      userRef,
      changes
    );

  }

}


// ============================================================
// WATCH USER PROFILE
// ============================================================

function watchProfile(uid) {

  if (unsubscribeProfile) {

    unsubscribeProfile();

  }


  const userRef =
    doc(db, "users", uid);


  unsubscribeProfile =
    onSnapshot(
      userRef,
      snap => {

        if (!snap.exists()) return;

        currentProfile =
          snap.data();

        updateResourceUI();

      },

      error => {

        console.error(
          "Profile listener:",
          error
        );

      }
    );

}


// ============================================================
// WATCH SERVERS
// ============================================================

function watchServers(uid) {

  if (unsubscribeServers) {

    unsubscribeServers();

  }


  const serversRef =
    collection(db, "servers");


  const q =
    query(
      serversRef,
      where("owner", "==", uid)
    );


  unsubscribeServers =
    onSnapshot(
      q,
      snapshot => {

        const servers = [];

        snapshot.forEach(serverDoc => {

          servers.push({

            id: serverDoc.id,

            ...serverDoc.data()

          });

        });


        renderServers(servers);

        updateResourceUI(servers);

      },

      error => {

        console.error(
          "Server listener:",
          error
        );

        showMessage(
          $("purchaseMsg"),
          "Could not load servers: " +
          friendlyError(error),
          true
        );

      }
    );

}


// ============================================================
// RENDER SERVERS
// ============================================================

function renderServers(servers) {

  const box =
    $("servers");

  box.innerHTML = "";


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


    el.innerHTML = `
      <div class="row between">

        <h3></h3>

        <span class="pill"></span>

      </div>

      <div class="muted address"></div>

      <div class="muted details"></div>
    `;


    el.querySelector("h3").textContent =
      server.name || server.id;


    el.querySelector(".pill").textContent =
      server.status || "offline";


    el.querySelector(".address").textContent =
      server.address ||
      "Not online yet";


    el.querySelector(".details").textContent =
      `${server.version || ""} · ${
        Number(server.ram || 1024) / 1024
      } GB`;


    el.onclick = () =>
      openServer(
        server.id,
        server
      );


    box.appendChild(el);

  }

}


// ============================================================
// RESOURCE UI
// ============================================================

function updateResourceUI(servers = []) {

  const profile =
    currentProfile || {};


  const ramLimit =
    Number(
      profile.ramLimit ||
      DEFAULT_RAM
    );


  const maxServers =
    Number(
      profile.maxServers ||
      MAX_SERVERS
    );


  const runningServers =
    servers.filter(server =>
      server.status === "online" ||
      server.status === "starting"
    );


  const usedRam =
    runningServers.reduce(
      (total, server) =>
        total +
        Number(server.ram || 0),
      0
    );


  const usedGB =
    usedRam / 1024;


  const limitGB =
    ramLimit / 1024;


  if ($("ramUsage")) {

    $("ramUsage").textContent =
      `${usedGB} GB / ${limitGB} GB`;

  }


  if ($("serverUsage")) {

    $("serverUsage").textContent =
      `${runningServers.length} / ${maxServers}`;

  }


  if ($("ramProgress")) {

    const percentage =
      ramLimit > 0
        ? Math.min(
            100,
            (usedRam / ramLimit) * 100
          )
        : 0;


    $("ramProgress").style.width =
      `${percentage}%`;

  }


  if ($("serverProgress")) {

    const percentage =
      maxServers > 0
        ? Math.min(
            100,
            (runningServers.length / maxServers) * 100
          )
        : 0;


    $("serverProgress").style.width =
      `${percentage}%`;

  }

}


// ============================================================
// CREATE SERVER DIALOG
// ============================================================

$("newServer").onclick = () => {

  $("createDialog").showModal();

};


// ============================================================
// CANCEL CREATE
// ============================================================

$("cancelCreate").onclick = () => {

  $("createDialog").close();

};


// ============================================================
// 4 GB RESTRICTION
// ============================================================

$("ramInput").addEventListener(
  "change",
  () => {

    const ram =
      Number($("ramInput").value);


    if (ram !== UPGRADE_RAM) {

      $("ramRestriction")
        .classList
        .add("hidden");

      return;

    }


    $("ramRestriction")
      .classList
      .remove("hidden");


    const currentLimit =
      Number(
        currentProfile?.ramLimit ||
        DEFAULT_RAM
      );


    if (currentLimit >= UPGRADE_RAM) {

      $("ramRestriction")
        .classList
        .add("hidden");

      return;

    }


    const buy =
      confirm(
        "4 GB RAM is restricted.\n\n" +
        "You need the $3 RAM upgrade " +
        "to unlock 4 GB servers.\n\n" +
        "Purchase the upgrade?"
      );


    if (buy) {

      createRamPurchaseRequest();

    }


    $("ramInput").value =
      "3072";

  }
);


// ============================================================
// PURCHASE RAM
// ============================================================

$("purchaseRam").onclick = async () => {

  await createRamPurchaseRequest();

};


// ============================================================
// CREATE REAL PURCHASE REQUEST
// ============================================================

async function createRamPurchaseRequest() {

  const user =
    auth.currentUser;


  if (!user) {

    showMessage(
      $("purchaseMsg"),
      "You must be signed in.",
      true
    );

    return;

  }


  try {

    const request =
      await addDoc(
        collection(
          db,
          "ramRequests"
        ),
        {

          owner: user.uid,

          type: "purchase",

          ram: UPGRADE_RAM,

          amountCents:
            UPGRADE_PRICE * 100,

          status: "pending",

          createdAt: Date.now()

        }
      );


    console.log(
      "RAM purchase request:",
      request.id
    );


    showMessage(
      $("purchaseMsg"),
      "Purchase request created. Payment checkout will be connected here."
    );


  } catch (error) {

    console.error(error);

    showMessage(
      $("purchaseMsg"),
      friendlyError(error),
      true
    );

  }

}


// ============================================================
// TEST PURCHASE
// ============================================================

$("testPurchase").onclick = async () => {

  const user =
    auth.currentUser;


  if (!user) {

    showMessage(
      $("purchaseMsg"),
      "You must be signed in.",
      true
    );

    return;

  }


  const confirmed =
    confirm(
      "TEST PURCHASE\n\n" +
      "This will simulate purchasing " +
      "the +4 GB RAM upgrade.\n\n" +
      "No money will be charged.\n\n" +
      "Continue?"
    );


  if (!confirmed) return;


  try {

    const request =
      await addDoc(
        collection(
          db,
          "ramRequests"
        ),
        {

          owner: user.uid,

          type: "test",

          ram: UPGRADE_RAM,

          amountCents: 0,

          status: "approved",

          createdAt: Date.now(),

          testPurchase: true

        }
      );


    // Give the test account the extra RAM.

    const userRef =
      doc(db, "users", user.uid);


    const currentLimit =
      Number(
        currentProfile?.ramLimit ||
        DEFAULT_RAM
      );


    const newLimit =
      Math.max(
        currentLimit,
        UPGRADE_RAM
      );


    await updateDoc(
      userRef,
      {

        ramLimit: newLimit,

        lastTestPurchase:
          Date.now()

      }
    );


    showMessage(
      $("purchaseMsg"),
      "✅ Test purchase complete! 4 GB RAM is now unlocked."
    );


    $("ramRestriction")
      ?.classList
      .add("hidden");


  } catch (error) {

    console.error(
      "Test purchase error:",
      error
    );


    showMessage(
      $("purchaseMsg"),
      friendlyError(error),
      true
    );

  }

};


// ============================================================
// CREATE SERVER
// ============================================================

$("createForm").onsubmit =
  async event => {

    event.preventDefault();


    const user =
      auth.currentUser;


    if (!user) {

      showMessage(
        $("purchaseMsg"),
        "You must be signed in.",
        true
      );

      return;

    }


    const name =
      $("serverNameInput")
        .value
        .trim();


    const version =
      $("versionInput").value;


    const ram =
      Number(
        $("ramInput").value
      );


    if (!name) {

      alert(
        "Enter a server name."
      );

      return;

    }


    // --------------------------------------------------------
    // Check 4 GB restriction
    // --------------------------------------------------------

    const ramLimit =
      Number(
        currentProfile?.ramLimit ||
        DEFAULT_RAM
      );


    if (
      ram === UPGRADE_RAM &&
      ramLimit < UPGRADE_RAM
    ) {

      $("ramRestriction")
        .classList
        .remove("hidden");


      alert(
        "4 GB RAM is restricted.\n\n" +
        "Purchase the $3 RAM upgrade first."
      );


      return;

    }


    // --------------------------------------------------------
    // Get current servers
    // --------------------------------------------------------

    const serverCollection =
      collection(db, "servers");


    const serverQuery =
      query(
        serverCollection,
        where(
          "owner",
          "==",
          user.uid
        )
      );


    // We use a temporary snapshot listener-like read.
    // Firestore's modular API supports getDocs, but the
    // listener already keeps the UI synchronized.
    //
    // Importing getDocs below would be another option.
    // For now, use the current rendered server cards to
    // prevent accidental duplicate submissions.
    //


    const existingServers =
      await getOwnedServers(user.uid);


    const activeServers =
      existingServers.filter(
        server =>
          server.status === "online" ||
          server.status === "starting" ||
          server.status === "provisioning"
      );


    // --------------------------------------------------------
    // Maximum 3 servers
    // --------------------------------------------------------

    const maxServers =
      Number(
        currentProfile?.maxServers ||
        MAX_SERVERS
      );


    if (
      activeServers.length >=
      maxServers
    ) {

      alert(
        `You can only have ${maxServers} servers at a time.`
      );

      return;

    }


    // --------------------------------------------------------
    // RAM calculation
    // --------------------------------------------------------

    const usedRam =
      activeServers.reduce(
        (total, server) =>
          total +
          Number(server.ram || 0),
        0
      );


    if (
      usedRam + ram >
      ramLimit
    ) {

      const available =
        Math.max(
          0,
          (ramLimit - usedRam) /
          1024
        );


      alert(
        `Not enough RAM available.\n\n` +
        `Available: ${available} GB\n` +
        `Requested: ${ram / 1024} GB`
      );


      return;

    }


    // --------------------------------------------------------
    // Create server document
    // --------------------------------------------------------

    try {

      const serverRef =
        await addDoc(
          collection(
            db,
            "servers"
          ),
          {

            name,

            version,

            ram,

            owner: user.uid,

            status:
              "provisioning",

            address: "",

            console:
              "Waiting for the hosting agent…",

            createdAt:
              Date.now()

          }
        );


      const serverId =
        serverRef.id;


      // ------------------------------------------------------
      // CREATE FIRESTORE JOB
      //
      // THIS IS THE IMPORTANT FIX:
      // status MUST BE "pending"
      // ------------------------------------------------------

      await addDoc(
        collection(db, "jobs"),
        {

          owner: user.uid,

          serverId,

          type: "provision",

          status: "pending",

          createdAt: Date.now()

        }
      );


      $("createDialog").close();


      $("serverNameInput").value = "";


      $("ramInput").value =
        "1024";


      $("ramRestriction")
        .classList
        .add("hidden");


      console.log(
        "Server created:",
        serverId
      );


    } catch (error) {

      console.error(
        "Create server error:",
        error
      );


      alert(
        "Create server error:\n\n" +
        friendlyError(error)
      );

    }

  };


// ============================================================
// GET OWNED SERVERS
// ============================================================

async function getOwnedServers(uid) {

  // This imports getDocs dynamically so the rest of the
  // application can load normally.

  const {
    getDocs
  } = await import(
    "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js"
  );


  const q =
    query(
      collection(
        db,
        "servers"
      ),
      where(
        "owner",
        "==",
        uid
      )
    );


  const snapshot =
    await getDocs(q);


  return snapshot.docs.map(
    serverDoc => ({

      id: serverDoc.id,

      ...serverDoc.data()

    })
  );

}


// ============================================================
// OPEN SERVER
// ============================================================

async function openServer(
  serverId,
  server
) {

  currentServerId =
    serverId;


  $("serverPanel")
    .classList
    .remove("hidden");


  $("serverName")
    .textContent =
      server.name ||
      serverId;


  $("serverAddress")
    .textContent =
      server.address ||
      "Waiting for agent…";


  $("serverStatus")
    .textContent =
      server.status ||
      "offline";


  if (unsubscribeCurrentServer) {

    unsubscribeCurrentServer();

  }


  const serverRef =
    doc(
      db,
      "servers",
      serverId
    );


  unsubscribeCurrentServer =
    onSnapshot(
      serverRef,
      snapshot => {

        if (!snapshot.exists()) {

          $("serverStatus")
            .textContent =
              "deleted";

          return;

        }


        const data =
          snapshot.data();


        $("serverName")
          .textContent =
            data.name ||
            serverId;


        $("serverAddress")
          .textContent =
            data.address ||
            "Waiting for agent…";


        $("serverStatus")
          .textContent =
            data.status ||
            "offline";


        $("console")
          .textContent =
            data.console ||
            "Waiting for the hosting agent…";

      },

      error => {

        console.error(
          "Server listener:",
          error
        );

      }
    );


  await refreshFiles();

}


// ============================================================
// START / RESTART / STOP
// ============================================================

document
  .querySelectorAll("[data-action]")
  .forEach(button => {

    button.onclick =
      async () => {

        const user =
          auth.currentUser;


        if (
          !user ||
          !currentServerId
        ) {

          return;

        }


        const type =
          button.dataset.action;


        try {

          // --------------------------------------------------
          // Create a Firestore job.
          //
          // status: "pending" is required by the agent.
          // --------------------------------------------------

          const job =
            await addDoc(
              collection(
                db,
                "jobs"
              ),
              {

                owner:
                  user.uid,

                serverId:
                  currentServerId,

                type,

                status:
                  "pending",

                createdAt:
                  Date.now()

              }
            );


          console.log(
            `Created ${type} job:`,
            job.id
          );


          // Give the UI immediate feedback.

          if (
            type === "start"
          ) {

            await updateDoc(
              doc(
                db,
                "servers",
                currentServerId
              ),
              {

                status:
                  "starting"

              }
            );

          }


        } catch (error) {

          console.error(
            `${type} error:`,
            error
          );


          alert(
            `${type} error:\n\n` +
            friendlyError(error)
          );

        }

      };

  });


// ============================================================
// FILES
// ============================================================

$("refreshFiles").onclick =
  refreshFiles;


async function refreshFiles() {

  const user =
    auth.currentUser;


  if (
    !user ||
    !currentServerId
  ) {

    return;

  }


  const {
    getDocs
  } = await import(
    "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js"
  );


  try {

    const q =
      query(
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
      snapshot.docs.map(
        fileDoc => ({
          id: fileDoc.id,
          ...fileDoc.data()
        })
      );


    $("files").innerHTML = "";


    if (!files.length) {

      $("files").innerHTML =
        `<div class="muted">
          No file index reported yet.
        </div>`;

      return;

    }


    for (
      const file of files
    ) {

      const div =
        document.createElement(
          "div"
        );


      div.className =
        "file";


      div.textContent =
        `${file.path || file.name || file.id}` +
        ` — ${file.type || "file"}` +
        (
          file.size
            ? ` — ${file.size} bytes`
            : ""
        );


      $("files")
        .appendChild(div);

    }

  } catch (error) {

    console.error(
      "File loading error:",
      error
    );


    $("files").innerHTML =
      `<div class="muted">
        Unable to load files.
      </div>`;

  }

}
