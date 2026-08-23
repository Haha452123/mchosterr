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


/* ============================================================
   FIREBASE
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAew9fVw91DarhE9mUUIy2VZ2sCVxrAX44",
  authDomain: "mchost-9516b.firebaseapp.com",
  projectId: "mchost-9516b",
  storageBucket: "mchost-9516b.firebasestorage.app",
  messagingSenderId: "692774609042",
  appId: "1:692774609042:web:dd447dc87803450d22864b",
  measurementId: "G-ED4W6V8CNT"
};

const firebaseApp =
  initializeApp(firebaseConfig);

const auth =
  getAuth(firebaseApp);

const db =
  getFirestore(firebaseApp);


/* ============================================================
   SETTINGS
   ============================================================ */

const HOSTNAME =
  "freemchosting.vexr.dev";

const MAX_SERVERS = 1;
const FREE_RAM_LIMIT = 3072;


/* ============================================================
   STATE
   ============================================================ */

let currentServerId = null;

let serverUnsubscribe = null;
let serversUnsubscribe = null;
let jobsUnsubscribe = null;

let registerMode = false;


/* ============================================================
   HELPERS
   ============================================================ */

function $(id) {
  return document.getElementById(id);
}


function showMessage(
  element,
  message,
  type = ""
) {

  if (!element) return;

  element.textContent = message;

  element.className =
    `msg ${type}`;

}


function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


/* ============================================================
   STATUS DISPLAY
   ============================================================ */

function prettyStatus(status) {

  switch (status) {

    case "provisioning":
      return "Provisioning…";

    case "starting":
      return "Starting…";

    case "online":
      return "Online";

    case "stopping":
      return "Stopping…";

    case "restarting":
      return "Restarting…";

    case "offline":
      return "Offline";

    case "error":
      return "Error";

    case "pending":
      return "Pending…";

    default:
      return status || "Offline";

  }

}


function isPendingStatus(status) {

  return [
    "provisioning",
    "starting",
    "stopping",
    "restarting",
    "pending"
  ].includes(status);

}


/* ============================================================
   AUTH SWITCH
   ============================================================ */

$("toggleAuth")?.addEventListener(
  "click",
  () => {

    registerMode =
      !registerMode;

    $("authTitle").textContent =
      registerMode
        ? "Register"
        : "Sign in";

    $("authSubmit").textContent =
      registerMode
        ? "Create account"
        : "Sign in";

    $("toggleAuth").textContent =
      registerMode
        ? "Already have an account? Sign in"
        : "Need an account? Register";

    showMessage(
      $("authMsg"),
      ""
    );

  }
);


/* ============================================================
   AUTH
   ============================================================ */

$("authForm")?.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const email =
      $("email")
        .value
        .trim();

    const password =
      $("password")
        .value;


    try {

      showMessage(
        $("authMsg"),
        "Please wait…"
      );


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

      console.error(
        "Authentication error:",
        error
      );

      showMessage(
        $("authMsg"),
        error.message
          .replace("Firebase: ", ""),
        "error"
      );

    }

  }
);


/* ============================================================
   LOGOUT
   ============================================================ */

$("logout")?.addEventListener(
  "click",
  async () => {

    await signOut(auth);

  }
);


/* ============================================================
   AUTH STATE
   ============================================================ */

onAuthStateChanged(
  auth,
  async user => {

    if (!user) {

      $("auth")
        ?.classList
        .remove("hidden");

      $("app")
        ?.classList
        .add("hidden");

      $("logout")
        ?.classList
        .add("hidden");


      if (serversUnsubscribe) {
        serversUnsubscribe();
        serversUnsubscribe = null;
      }

      if (serverUnsubscribe) {
        serverUnsubscribe();
        serverUnsubscribe = null;
      }

      if (jobsUnsubscribe) {
        jobsUnsubscribe();
        jobsUnsubscribe = null;
      }

      currentServerId = null;

      return;
    }


    $("auth")
      ?.classList
      .add("hidden");

    $("app")
      ?.classList
      .remove("hidden");

    $("logout")
      ?.classList
      .remove("hidden");


    $("who").textContent =
      user.email ||
      user.uid;


    try {

      await ensureUserProfile(user);

      watchServers(user.uid);

      watchUserJobs(user.uid);

    } catch (error) {

      console.error(
        "Dashboard initialization:",
        error
      );

    }

  }
);


/* ============================================================
   USER PROFILE
   ============================================================ */

async function ensureUserProfile(user) {

  const ref =
    doc(
      db,
      "users",
      user.uid
    );

  const snap =
    await getDoc(ref);


  if (!snap.exists()) {

    await setDoc(
      ref,
      {

        email:
          user.email || "",

        maxServers:
          MAX_SERVERS,

        ramLimit:
          FREE_RAM_LIMIT,

        createdAt:
          Date.now()

      }
    );

  }

}


/* ============================================================
   WATCH SERVERS
   ============================================================ */

function watchServers(uid) {

  if (serversUnsubscribe) {

    serversUnsubscribe();

  }


  const q =
    query(
      collection(db, "servers"),
      where(
        "owner",
        "==",
        uid
      )
    );


  serversUnsubscribe =
    onSnapshot(
      q,

      snapshot => {

        const servers =
          snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );


        renderServers(
          servers
        );


        /*
         * If the currently selected server
         * disappeared, close its panel.
         */

        if (
          currentServerId &&
          !servers.some(
            server =>
              server.id ===
              currentServerId
          )
        ) {

          currentServerId =
            null;

          $("serverPanel")
            ?.classList
            .add("hidden");

        }


        /*
         * Keep currently selected server
         * updated immediately.
         */

        const selected =
          servers.find(
            server =>
              server.id ===
              currentServerId
          );


        if (selected) {

          updateServerPanel(
            selected
          );

        }

      },

      error => {

        console.error(
          "Server listener:",
          error
        );

        showFirebaseError(
          error
        );

      }
    );

}


/* ============================================================
   RENDER SERVER CARDS
   ============================================================ */

function renderServers(
  servers
) {

  const box =
    $("servers");

  if (!box) return;

  box.innerHTML = "";


  if (!servers.length) {

    box.innerHTML = `
      <div class="card">
        <h3>No servers yet</h3>
        <div class="muted">
          Create a server to get started.
        </div>
      </div>
    `;

    return;

  }


  for (const server of servers) {

    const status =
      server.status ||
      "offline";

    const card =
      document.createElement(
        "div"
      );


    card.className =
      "card server";


    const title =
      document.createElement(
        "h3"
      );

    title.textContent =
      server.name ||
      server.id;


    const statusElement =
      document.createElement(
        "span"
      );

    statusElement.className =
      "pill";

    statusElement.textContent =
      prettyStatus(status);


    const header =
      document.createElement(
        "div"
      );

    header.className =
      "row between";

    header.append(
      title,
      statusElement
    );


    const address =
      document.createElement(
        "div"
      );

    address.className =
      "muted";

    address.textContent =
      server.address ||
      (
        isPendingStatus(status)
          ? "Waiting for hosting agent…"
          : "Not online"
      );


    const info =
      document.createElement(
        "div"
      );

    info.className =
      "muted";

    info.textContent =
      `${server.version || ""} · ` +
      `${Number(server.ram || 0)} MB`;


    card.append(
      header,
      address,
      info
    );


    card.addEventListener(
      "click",
      () => {

        openServer(
          server.id,
          server
        );

      }
    );


    box.appendChild(card);

  }

}


/* ============================================================
   OPEN SERVER
   ============================================================ */

async function openServer(
  serverId,
  server
) {

  currentServerId =
    serverId;


  $("serverPanel")
    ?.classList
    .remove("hidden");


  updateServerPanel(
    server
  );


  if (serverUnsubscribe) {

    serverUnsubscribe();

  }


  serverUnsubscribe =
    onSnapshot(
      doc(
        db,
        "servers",
        serverId
      ),

      snapshot => {

        if (!snapshot.exists()) {

          return;

        }


        updateServerPanel({

          id:
            snapshot.id,

          ...snapshot.data()

        });

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


/* ============================================================
   UPDATE SERVER PANEL
   ============================================================ */

function updateServerPanel(
  server
) {

  const status =
    server.status ||
    "offline";


  $("serverName").textContent =
    server.name ||
    server.id;


  /*
   * Pending/provisioning fix:
   *
   * Don't show "Not online" while the
   * agent is still working.
   */

  if (
    server.address
  ) {

    $("serverAddress").textContent =
      server.address;

  } else if (
    isPendingStatus(status)
  ) {

    $("serverAddress").textContent =
      "Waiting for hosting agent…";

  } else {

    $("serverAddress").textContent =
      "Not online";

  }


  $("serverStatus").textContent =
    prettyStatus(status);


  $("console").textContent =
    server.console ||
    (
      isPendingStatus(status)
        ? "Waiting for the hosting agent…"
        : "No console output yet."
    );

}


/* ============================================================
   JOB LISTENER
   ============================================================ */

/*
 * This is the client-side pending fix.
 *
 * We watch the user's jobs and use them to make
 * the UI understand that an operation is still
 * happening even before the server document
 * changes.
 */

function watchUserJobs(uid) {

  if (jobsUnsubscribe) {

    jobsUnsubscribe();

  }


  const q =
    query(
      collection(db, "jobs"),
      where(
        "owner",
        "==",
        uid
      )
    );


  jobsUnsubscribe =
    onSnapshot(
      q,

      snapshot => {

        const jobs =
          snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );


        updatePendingUI(
          jobs
        );

      },

      error => {

        console.error(
          "Job listener:",
          error
        );

      }
    );

}


/* ============================================================
   PENDING UI
   ============================================================ */

function updatePendingUI(
  jobs
) {

  if (!currentServerId) {
    return;
  }


  /*
   * Find the newest active job
   * for the selected server.
   */

  const activeJobs =
    jobs
      .filter(
        job =>
          job.serverId ===
          currentServerId
      )
      .filter(
        job =>
          job.status === "queued" ||
          job.status === "processing"
      )
      .sort(
        (a, b) =>
          Number(
            b.createdAt || 0
          ) -
          Number(
            a.createdAt || 0
          )
      );


  if (!activeJobs.length) {

    return;

  }


  const job =
    activeJobs[0];


  let status =
    "Pending…";


  if (
    job.type ===
    "provision"
  ) {

    status =
      job.status ===
      "processing"
        ? "Provisioning…"
        : "Waiting for agent…";

  }

  else if (
    job.type ===
    "start"
  ) {

    status =
      job.status ===
      "processing"
        ? "Starting…"
        : "Start queued…";

  }

  else if (
    job.type ===
    "restart"
  ) {

    status =
      job.status ===
      "processing"
        ? "Restarting…"
        : "Restart queued…";

  }

  else if (
    job.type ===
    "stop"
  ) {

    status =
      job.status ===
      "processing"
        ? "Stopping…"
        : "Stop queued…";

  }


  $("serverStatus").textContent =
    status;


  if (
    job.type !==
    "command"
  ) {

    $("serverAddress").textContent =
      "Waiting for hosting agent…";

  }

}


/* ============================================================
   CREATE SERVER
   ============================================================ */

$("newServer")?.addEventListener(
  "click",
  () => {

    $("ramNotice").textContent = "";

    $("createDialog")
      ?.showModal();

  }
);


/* ============================================================
   RAM SELECTION
   ============================================================ */

$("ramInput")?.addEventListener(
  "change",
  () => {

    const ram =
      Number(
        $("ramInput").value
      );


    if (ram === 4096) {

      showMessage(
        $("ramNotice"),
        "4 GB RAM is restricted. " +
        "A $3 purchase is required.",
        "warning"
      );

    } else {

      showMessage(
        $("ramNotice"),
        ""
      );

    }

  }
);


/* ============================================================
   CREATE SERVER
   ============================================================ */

$("createForm")?.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    const user =
      auth.currentUser;


    if (!user) {

      return;

    }


    const name =
      $("serverNameInput")
        .value
        .trim();

    const version =
      $("versionInput")
        .value;

    const ram =
      Number(
        $("ramInput")
          .value
      );


    if (!name) {

      return;

    }


    try {

      /*
       * Check profile limits before creating.
       */

      const profileSnap =
        await getDoc(
          doc(
            db,
            "users",
            user.uid
          )
        );


      const profile =
        profileSnap.exists()
          ? profileSnap.data()
          : {
              maxServers:
                MAX_SERVERS,

              ramLimit:
                FREE_RAM_LIMIT
            };


      const serverSnap =
        await getDocs(
          query(
            collection(db, "servers"),
            where(
              "owner",
              "==",
              user.uid
            )
          )
        );


      const servers =
        serverSnap.docs.map(
          item => item.data()
        );


      const activeServers =
        servers.filter(
          server =>
            server.status ===
              "online" ||
            server.status ===
              "starting" ||
            server.status ===
              "provisioning" ||
            server.status ===
              "restarting"
        );


      if (
        activeServers.length >=
        Number(
          profile.maxServers ||
          MAX_SERVERS
        )
      ) {

        throw new Error(
          `Server limit reached ` +
          `(${profile.maxServers || MAX_SERVERS}).`
        );

      }


      const usedRam =
        activeServers.reduce(
          (
            total,
            server
          ) =>
            total +
            Number(
              server.ram || 0
            ),
          0
        );


      /*
       * 4 GB test purchase.
       */

      if (ram === 4096) {

        const confirmed =
          confirm(
            "4 GB RAM is restricted.\n\n" +
            "TEST PURCHASE ONLY.\n\n" +
            "Pretend to purchase the $3 upgrade?"
          );


        if (!confirmed) {

          return;

        }


        await addDoc(
          collection(
            db,
            "ramPurchaseRequests"
          ),
          {

            owner:
              user.uid,

            email:
              user.email || "",

            ram: 4096,

            amount: 3,

            status: "test",

            createdAt:
              Date.now()

          }
        );

      }


      const ramLimit =
        Number(
          profile.ramLimit ||
          FREE_RAM_LIMIT
        );


      if (
        ram !== 4096 &&
        usedRam + ram >
        ramLimit
      ) {

        throw new Error(
          `RAM limit exceeded. ` +
          `Available: ${Math.max(
            0,
            ramLimit - usedRam
          )} MB`
        );

      }


      /*
       * Create server.
       */

      const serverRef =
        doc(
          collection(db, "servers")
        );


      await setDoc(
        serverRef,
        {

          owner:
            user.uid,

          name,

          version,

          ram,

          status:
            "provisioning",

          address:
            "",

          port:
            0,

          console:
            "Waiting for the hosting agent…",

          createdAt:
            Date.now()

        }
      );


      /*
       * Create provision job.
       */

      await addDoc(
        collection(db, "jobs"),
        {

          owner:
            user.uid,

          serverId:
            serverRef.id,

          type:
            "provision",

          status:
            "queued",

          createdAt:
            Date.now()

        }
      );


      $("createDialog")
        ?.close();


      $("serverNameInput")
        .value = "";


      /*
       * Immediately open the server so
       * the user sees "Provisioning…".
       */

      openServer(
        serverRef.id,
        {

          id:
            serverRef.id,

          name,

          version,

          ram,

          status:
            "provisioning",

          address:
            ""

        }
      );


    } catch (error) {

      console.error(
        "Create server error:",
        error
      );


      alert(
        error.message ||
        "Failed to create server."
      );

    }

  }
);


/* ============================================================
   SERVER ACTIONS
   ============================================================ */

document
  .querySelectorAll(
    "[data-action]"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
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

            /*
             * Update the UI immediately.
             * This prevents the "nothing happened"
             * feeling while the agent receives the job.
             */

            const temporaryStatus = {

              start:
                "starting",

              stop:
                "stopping",

              restart:
                "restarting"

            }[type];


            if (
              temporaryStatus
            ) {

              $("serverStatus")
                .textContent =
                  prettyStatus(
                    temporaryStatus
                  );

            }


            await addDoc(
              collection(db, "jobs"),
              {

                owner:
                  user.uid,

                serverId:
                  currentServerId,

                type,

                status:
                  "queued",

                createdAt:
                  Date.now()

              }
            );


          } catch (error) {

            console.error(
              "Action error:",
              error
            );


            showFirebaseError(
              error
            );

          }

        }
      );

    }
  );


/* ============================================================
   COMMAND LINE
   ============================================================ */

$("commandForm")?.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    const user =
      auth.currentUser;


    if (
      !user ||
      !currentServerId
    ) {

      showMessage(
        $("commandMsg"),
        "Select a server first.",
        "error"
      );

      return;

    }


    let command =
      $("commandInput")
        .value
        .trim();


    if (!command) {

      return;

    }


    /*
     * Minecraft console commands don't
     * need the leading slash.
     */

    if (
      command.startsWith("/")
    ) {

      command =
        command.substring(1);

    }


    try {

      await addDoc(
        collection(db, "jobs"),
        {

          owner:
            user.uid,

          serverId:
            currentServerId,

          type:
            "command",

          command,

          status:
            "queued",

          createdAt:
            Date.now()

        }
      );


      $("commandInput")
        .value = "";


      showMessage(
        $("commandMsg"),
        "Command sent.",
        "success"
      );


    } catch (error) {

      console.error(
        "Command error:",
        error
      );


      showFirebaseError(
        error,
        $("commandMsg")
      );

    }

  }
);


/* ============================================================
   FILES
   ============================================================ */

$("refreshFiles")?.addEventListener(
  "click",
  refreshFiles
);


async function refreshFiles() {

  const user =
    auth.currentUser;


  if (
    !user ||
    !currentServerId
  ) {

    return;

  }


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
      $("files");


    files.innerHTML = "";


    if (snapshot.empty) {

      files.innerHTML = `
        <div class="muted">
          No files reported yet.
        </div>
      `;

      return;

    }


    snapshot.forEach(
      item => {

        const data =
          item.data();


        const file =
          document.createElement(
            "div"
          );


        file.className =
          "file";


        file.textContent =
          data.path ||
          item.id;


        files.appendChild(
          file
        );

      }
    );


  } catch (error) {

    console.error(
      "File error:",
      error
    );

  }

}


/* ============================================================
   FIREBASE ERROR
   ============================================================ */

function showFirebaseError(
  error,
  element = null
) {

  console.error(
    "Firebase error:",
    error
  );


  const message =
    error?.code ===
      "permission-denied"
      ? "Firebase denied this operation. Check your Firestore rules."
      : (
          error?.message ||
          "Firebase operation failed."
        );


  if (element) {

    showMessage(
      element,
      message,
      "error"
    );

  } else {

    alert(message);

  }

}
/* ============================================================
   MODRINTH FABRIC MOD SEARCH
   ============================================================ */

const MODRINTH_API = "https://api.modrinth.com/v2";


$("modrinthSearchForm")?.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const input =
      $("modrinthSearch");

    const version =
      $("modrinthVersion");

    const results =
      $("modrinthResults");

    const message =
      $("modrinthMsg");

    if (!input || !results) {
      return;
    }

    const search =
      input.value.trim();

    if (!search) {

      showMessage(
        message,
        "Enter a mod to search for.",
        "error"
      );

      return;
    }

    results.innerHTML = `
      <div class="modrinth-loading">
        Searching Modrinth…
      </div>
    `;

    showMessage(message, "");

    try {

      /*
       * Modrinth facets:
       *
       * project_type:mod
       * categories:fabric
       * versions:<selected Minecraft version>
       *
       * This prevents Forge/NeoForge mods and
       * non-mod project types from appearing.
       */

      const facets = JSON.stringify([
        ["project_type:mod"],
        ["categories:fabric"],
        [`versions:${version.value}`]
      ]);

      const url =
        new URL(
          `${MODRINTH_API}/search`
        );

      url.searchParams.set(
        "query",
        search
      );

      url.searchParams.set(
        "facets",
        facets
      );

      url.searchParams.set(
        "limit",
        "20"
      );

      url.searchParams.set(
        "index",
        "relevance"
      );

      const response =
        await fetch(url);

      if (!response.ok) {

        throw new Error(
          `Modrinth returned HTTP ${response.status}.`
        );

      }

      const data =
        await response.json();

      const projects =
        data.hits || [];

      if (!projects.length) {

        results.innerHTML = `
          <div class="modrinth-empty">
            No Fabric mods found for
            Minecraft ${escapeHtml(version.value)}.
          </div>
        `;

        return;
      }

      results.innerHTML = "";

      /*
       * Fetch the latest compatible Fabric version
       * for each search result so the Download button
       * points to an actual .jar.
       */

      for (const project of projects) {

        const card =
          await createModrinthCard(
            project,
            version.value
          );

        results.appendChild(card);

      }

    } catch (error) {

      console.error(
        "Modrinth search error:",
        error
      );

      results.innerHTML = `
        <div class="modrinth-empty">
          Failed to search Modrinth.
          Try again in a moment.
        </div>
      `;

    }

  }
);


/* ============================================================
   MODRINTH RESULT CARD
   ============================================================ */

async function createModrinthCard(
  project,
  minecraftVersion
) {

  const card =
    document.createElement("article");

  card.className =
    "modrinth-card";

  const icon =
    document.createElement("img");

  icon.className =
    "modrinth-icon";

  icon.alt =
    `${project.title || "Mod"} icon`;

  icon.loading =
    "lazy";

  icon.src =
    project.icon_url || "";

  const info =
    document.createElement("div");

  info.className =
    "modrinth-info";

  const title =
    document.createElement("h3");

  title.className =
    "modrinth-title";

  const projectLink =
    document.createElement("a");

  projectLink.href =
    `https://modrinth.com/mod/${encodeURIComponent(
      project.slug || project.project_id
    )}`;

  projectLink.target =
    "_blank";

  projectLink.rel =
    "noopener noreferrer";

  projectLink.textContent =
    project.title ||
    project.slug ||
    "Unknown mod";

  title.appendChild(
    projectLink
  );


  const description =
    document.createElement("div");

  description.className =
    "modrinth-description";

  description.textContent =
    project.description ||
    "No description available.";


  const meta =
    document.createElement("div");

  meta.className =
    "modrinth-meta";


  const fabricTag =
    document.createElement("span");

  fabricTag.className =
    "modrinth-tag";

  fabricTag.textContent =
    "Fabric";

  meta.appendChild(
    fabricTag
  );


  const versionTag =
    document.createElement("span");

  versionTag.className =
    "modrinth-tag";

  versionTag.textContent =
    `Minecraft ${minecraftVersion}`;

  meta.appendChild(
    versionTag
  );


  const downloadsTag =
    document.createElement("span");

  downloadsTag.className =
    "modrinth-tag";

  downloadsTag.textContent =
    `${formatDownloads(
      project.downloads
    )} downloads`;

  meta.appendChild(
    downloadsTag
  );


  info.append(
    title,
    description,
    meta
  );


  const actions =
    document.createElement("div");

  actions.className =
    "modrinth-actions";


  const download =
    document.createElement("a");

  download.className =
    "modrinth-download";

  download.textContent =
    "Download .jar";

  download.target =
    "_blank";

  download.rel =
    "noopener noreferrer";

  download.textContent =
    "Loading…";

  actions.appendChild(
    download
  );


  const modrinth =
    document.createElement("a");

  modrinth.className =
    "modrinth-project";

  modrinth.textContent =
    "Modrinth";

  modrinth.href =
    projectLink.href;

  modrinth.target =
    "_blank";

  modrinth.rel =
    "noopener noreferrer";

  actions.appendChild(
    modrinth
  );


  card.append(
    icon,
    info,
    actions
  );


  /*
   * Get a compatible Fabric release.
   */

  try {

    const versionUrl =
      new URL(
        `${MODRINTH_API}/project/` +
        `${encodeURIComponent(
          project.project_id
        )}/version`
      );

    versionUrl.searchParams.set(
      "loaders",
      JSON.stringify(["fabric"])
    );

    versionUrl.searchParams.set(
      "game_versions",
      JSON.stringify([minecraftVersion])
    );

    versionUrl.searchParams.set(
      "include_changelog",
      "false"
    );


    const response =
      await fetch(versionUrl);

    if (!response.ok) {
      throw new Error(
        `Version lookup failed: ${response.status}`
      );
    }


    const versions =
      await response.json();


    /*
     * Prefer a release version.
     */

    const compatible =
      versions.find(
        version =>
          version.version_type ===
          "release" &&
          version.status ===
          "listed"
      ) ||
      versions.find(
        version =>
          version.status ===
          "listed"
      );


    if (!compatible) {

      download.textContent =
        "No compatible release";

      download.removeAttribute(
        "href"
      );

      download.style.opacity =
        "0.55";

      return card;
    }


    /*
     * Find the primary file.
     */

    const primaryFile =
      compatible.files?.find(
        file =>
          file.primary === true
      ) ||
      compatible.files?.find(
        file =>
          file.filename
            ?.toLowerCase()
            .endsWith(".jar")
      );


    if (!primaryFile) {

      download.textContent =
        "No .jar available";

      download.removeAttribute(
        "href"
      );

      download.style.opacity =
        "0.55";

      return card;
    }


    download.href =
      primaryFile.url;

    download.download =
      primaryFile.filename;

    download.textContent =
      "Download .jar";


  } catch (error) {

    console.error(
      "Modrinth version lookup:",
      error
    );

    download.textContent =
      "Download unavailable";

    download.removeAttribute(
      "href"
    );

    download.style.opacity =
      "0.55";

  }


  return card;

}


/* ============================================================
   DOWNLOAD FORMATTER
   ============================================================ */

function formatDownloads(
  value
) {

  const number =
    Number(value || 0);

  if (
    number >=
    1_000_000_000
  ) {

    return (
      number / 1_000_000_000
    ).toFixed(1) + "B";

  }

  if (
    number >=
    1_000_000
  ) {

    return (
      number / 1_000_000
    ).toFixed(1) + "M";

  }

  if (
    number >=
    1_000
  ) {

    return (
      number / 1_000
    ).toFixed(1) + "K";

  }

  return String(number);

}
