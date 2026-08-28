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

/*
 * Where users are told to go to get a domain
 * verified. Update this to your actual Discord invite.
 */
const DISCORD_INVITE_URL =
  "https://discord.gg/your-invite";


/* ============================================================
   STATE
   ============================================================ */

let currentServerId = null;

let serverUnsubscribe = null;
let serversUnsubscribe = null;
let jobsUnsubscribe = null;
let filesUnsubscribe = null;
let domainTicketsUnsubscribe = null;

let registerMode = false;

let openFilePath = null;
let latestDomainTickets = [];


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


function formatBytes(value) {

  const bytes =
    Number(value || 0);

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}


/*
 * Waits for a job document to reach a terminal state
 * ("completed" or "failed") and resolves with its data.
 * Used by any UI action (file read/write, etc.) that needs
 * to know the outcome of a job, not just fire-and-forget it.
 */

function waitForJob(
  jobRef,
  {
    onUpdate = null,
    timeoutMs = 20000
  } = {}
) {

  return new Promise(
    (resolve, reject) => {

      let settled = false;

      const timer =
        setTimeout(
          () => {

            if (settled) return;

            settled = true;

            unsubscribe();

            reject(
              new Error(
                "Timed out waiting for the hosting agent."
              )
            );

          },
          timeoutMs
        );

      const unsubscribe =
        onSnapshot(
          jobRef,

          snapshot => {

            if (!snapshot.exists()) {
              return;
            }

            const job =
              snapshot.data();

            if (onUpdate) {
              onUpdate(job);
            }

            if (
              job.status === "completed" ||
              job.status === "failed"
            ) {

              if (settled) return;

              settled = true;

              clearTimeout(timer);

              unsubscribe();

              resolve(job);

            }

          },

          error => {

            if (settled) return;

            settled = true;

            clearTimeout(timer);

            unsubscribe();

            reject(error);

          }
        );

    }
  );

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


function prettyDomainStatus(status) {

  switch (status) {

    case "waiting_for_verification":
      return "Waiting for verification in Discord";

    case "queued":
      return "Verified — queued for setup";

    case "processing":
      return "Setting up…";

    case "completed":
      return "Active";

    case "failed":
      return "Failed";

    default:
      return status || "Unknown";

  }

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

      if (filesUnsubscribe) {
        filesUnsubscribe();
        filesUnsubscribe = null;
      }

      if (domainTicketsUnsubscribe) {
        domainTicketsUnsubscribe();
        domainTicketsUnsubscribe = null;
      }

      currentServerId = null;
      openFilePath = null;
      latestDomainTickets = [];

      closeFileViewer();

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

      watchDomainTickets(user.uid);

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

          if (filesUnsubscribe) {
            filesUnsubscribe();
            filesUnsubscribe = null;
          }

          closeFileViewer();

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

          renderDomainStatus(
            latestDomainTickets
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
      (
        server.customDomain &&
        server.customDomainStatus === "active"
      )
        ? server.customDomain
        : (
            server.address ||
            (
              isPendingStatus(status)
                ? "Waiting for hosting agent…"
                : "Not online"
            )
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


  closeFileViewer();


  updateServerPanel(
    server
  );

  renderDomainStatus(
    latestDomainTickets
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


  watchServerFiles(serverId);

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
   *
   * A verified custom domain takes priority
   * over the auto-assigned address.
   */

  if (
    server.customDomain &&
    server.customDomainStatus === "active"
  ) {

    $("serverAddress").textContent =
      server.customDomain;

  } else if (
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


  /*
   * File and command jobs shouldn't hijack the
   * server status pill — they're their own thing.
   */

  const silentJobTypes = [
    "command",
    "list-files",
    "read-file",
    "write-file"
  ];

  if (
    silentJobTypes.includes(
      job.type
    )
  ) {

    return;

  }


  $("serverStatus").textContent =
    status;


  $("serverAddress").textContent =
    "Waiting for hosting agent…";

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
   ============================================================ *
 *
 * Fixed flow:
 *
 *   1. Refresh (or opening a server) queues a
 *      "list-files" job for the hosting agent.
 *   2. The agent scans the server's directory and
 *      writes what it finds into "serverFiles",
 *      scoped to this server.
 *   3. The browser watches "serverFiles" live, so the
 *      list updates the moment the agent finishes —
 *      no manual re-query needed.
 *   4. Clicking a file queues a "read-file" job and
 *      waits for the agent's result; saving queues a
 *      "write-file" job the same way.
 *
 * Previously the UI only ever read "serverFiles" —
 * nothing ever wrote to it, so the list was always
 * empty, and there was no way to view or edit a file's
 * contents at all.
 */

$("refreshFiles")?.addEventListener(
  "click",
  refreshFiles
);


$("openFilePathButton")?.addEventListener(
  "click",
  () => {

    const path =
      $("filePath")
        ?.value
        .trim();

    if (!path) {

      return;

    }

    openFile(path);

  }
);


function watchServerFiles(serverId) {

  if (filesUnsubscribe) {

    filesUnsubscribe();

  }


  const q =
    query(
      collection(db, "serverFiles"),
      where(
        "serverId",
        "==",
        serverId
      )
    );


  filesUnsubscribe =
    onSnapshot(
      q,

      snapshot => {

        const files =
          snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );


        files.sort(
          (a, b) =>
            String(a.path || "")
              .localeCompare(
                String(b.path || "")
              )
        );


        renderFiles(files);

      },

      error => {

        console.error(
          "Files listener:",
          error
        );

      }
    );

}


function renderFiles(files) {

  const box =
    $("files");

  if (!box) return;

  box.innerHTML = "";


  if (!files.length) {

    box.innerHTML = `
      <div class="muted">
        No files reported yet. Click Refresh to scan,
        or type a path above and click Open.
      </div>
    `;

    return;

  }


  for (const file of files) {

    const item =
      document.createElement(
        "div"
      );

    item.className =
      "file";

    item.textContent =
      `${file.path} · ${formatBytes(file.size)}`;

    item.addEventListener(
      "click",
      () => {

        openFile(
          file.path
        );

      }
    );

    box.appendChild(item);

  }

}


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

    await addDoc(
      collection(db, "jobs"),
      {

        owner:
          user.uid,

        serverId:
          currentServerId,

        type:
          "list-files",

        status:
          "queued",

        createdAt:
          Date.now()

      }
    );


  } catch (error) {

    console.error(
      "File refresh error:",
      error
    );

  }

}


/* ============================================================
   FILE VIEWER / EDITOR
   ============================================================ */

async function openFile(filePath) {

  const user =
    auth.currentUser;


  if (
    !user ||
    !currentServerId
  ) {

    return;

  }


  openFilePath =
    filePath;


  $("fileViewer")
    ?.classList
    .remove("hidden");

  $("fileViewerPath").textContent =
    filePath;

  $("fileContent").value =
    "Loading…";

  $("fileContent").disabled =
    true;

  $("saveFileButton").disabled =
    true;

  showMessage(
    $("fileViewerMsg"),
    ""
  );


  try {

    const jobRef =
      await addDoc(
        collection(db, "jobs"),
        {

          owner:
            user.uid,

          serverId:
            currentServerId,

          type:
            "read-file",

          path:
            filePath,

          status:
            "queued",

          createdAt:
            Date.now()

        }
      );


    const job =
      await waitForJob(jobRef);


    if (
      openFilePath !==
      filePath
    ) {

      /*
       * The user opened a different file while
       * this read was in flight — ignore.
       */

      return;

    }


    if (job.status === "completed") {

      $("fileContent").value =
        job.result || "";

      $("fileContent").disabled =
        false;

      $("saveFileButton").disabled =
        false;

    } else {

      $("fileContent").value =
        "";

      showMessage(
        $("fileViewerMsg"),
        job.error ||
          "Failed to read file.",
        "error"
      );

    }


  } catch (error) {

    console.error(
      "File read error:",
      error
    );

    $("fileContent").value =
      "";

    showMessage(
      $("fileViewerMsg"),
      error.message ||
        "Failed to read file.",
      "error"
    );

  }

}


function closeFileViewer() {

  openFilePath = null;

  $("fileViewer")
    ?.classList
    .add("hidden");

  const content =
    $("fileContent");

  if (content) {
    content.value = "";
  }

  showMessage(
    $("fileViewerMsg"),
    ""
  );

}


$("closeFileViewer")?.addEventListener(
  "click",
  closeFileViewer
);


$("saveFileButton")?.addEventListener(
  "click",
  async () => {

    const user =
      auth.currentUser;


    if (
      !user ||
      !currentServerId ||
      !openFilePath
    ) {

      return;

    }


    const savingPath =
      openFilePath;


    try {

      $("saveFileButton").disabled =
        true;

      showMessage(
        $("fileViewerMsg"),
        "Saving…"
      );


      const jobRef =
        await addDoc(
          collection(db, "jobs"),
          {

            owner:
              user.uid,

            serverId:
              currentServerId,

            type:
              "write-file",

            path:
              savingPath,

            content:
              $("fileContent").value,

            status:
              "queued",

            createdAt:
              Date.now()

          }
        );


      const job =
        await waitForJob(jobRef);


      if (
        openFilePath !==
        savingPath
      ) {

        return;

      }


      if (job.status === "completed") {

        showMessage(
          $("fileViewerMsg"),
          "Saved.",
          "success"
        );

      } else {

        showMessage(
          $("fileViewerMsg"),
          job.error ||
            "Failed to save file.",
          "error"
        );

      }


    } catch (error) {

      console.error(
        "File save error:",
        error
      );

      showMessage(
        $("fileViewerMsg"),
        error.message ||
          "Failed to save file.",
        "error"
      );

    } finally {

      $("saveFileButton").disabled =
        false;

    }

  }
);


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
   MODRINTH PAPER PLUGIN SEARCH
   ============================================================ */

const MODRINTH_API = "https://api.modrinth.com/v2";

$("modrinthSearchForm")?.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const searchInput = $("modrinthSearch");
    const versionInput = $("modrinthVersion");
    const results = $("modrinthResults");
    const message = $("modrinthMsg");

    if (!searchInput || !results) return;

    const search = searchInput.value.trim();
    const minecraftVersion = versionInput?.value || "1.21.11";

    if (!search) {
      showMessage(
        message,
        "Enter a plugin to search for.",
        "error"
      );
      return;
    }

    results.innerHTML = `
      <div class="muted">
        Searching Modrinth...
      </div>
    `;

    try {
      /*
       * Your servers are Paper, so ONLY search for
       * Modrinth projects whose project type is "plugin".
       *
       * We also filter to the selected Minecraft version.
       */

      const facets = JSON.stringify([
        ["project_type:plugin"],
        [`versions:${minecraftVersion}`]
      ]);

      const url = new URL(
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

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Modrinth returned HTTP ${response.status}`
        );
      }

      const data = await response.json();

      const projects = data.hits || [];

      if (!projects.length) {
        results.innerHTML = `
          <div class="muted">
            No Paper plugins found for
            Minecraft ${escapeHtml(minecraftVersion)}.
          </div>
        `;
        return;
      }

      results.innerHTML = "";

      for (const project of projects) {
        const card =
          await createModrinthPluginCard(
            project,
            minecraftVersion
          );

        results.appendChild(card);
      }

    } catch (error) {
      console.error(
        "Modrinth search error:",
        error
      );

      results.innerHTML = `
        <div class="muted">
          Failed to search Modrinth.
          Try again in a moment.
        </div>
      `;
    }
  }
);


/* ============================================================
   MODRINTH PLUGIN CARD
   ============================================================ */

async function createModrinthPluginCard(
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
    `${project.title || "Plugin"} icon`;

  icon.loading =
    "lazy";

  if (project.icon_url) {
    icon.src =
      project.icon_url;
  }

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
    `https://modrinth.com/plugin/${
      encodeURIComponent(
        project.slug ||
        project.project_id
      )
    }`;

  projectLink.target =
    "_blank";

  projectLink.rel =
    "noopener noreferrer";

  projectLink.textContent =
    project.title ||
    project.slug ||
    "Unknown plugin";

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

  const typeTag =
    document.createElement("span");

  typeTag.className =
    "modrinth-tag";

  typeTag.textContent =
    "Paper Plugin";

  meta.appendChild(
    typeTag
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
    document.createElement("button");

  download.className =
    "modrinth-download";

  download.textContent =
    "Loading...";

  /*
   * IMPORTANT:
   *
   * This downloads the JAR to the user's computer
   * if the browser permits it.
   *
   * It does NOT install the plugin onto the Minecraft
   * server yet.
   *
   * Installing directly into the server requires the
   * hosting agent to receive a job and download the
   * JAR itself.
   */

  download.addEventListener(
    "click",
    async () => {

      try {

        download.disabled =
          true;

        download.textContent =
          "Installing...";

        await installModrinthPlugin(
          project.project_id,
          minecraftVersion,
          project.title ||
            project.slug ||
            "Plugin"
        );

        download.textContent =
          "Install queued";

      } catch (error) {

        console.error(
          "Plugin installation:",
          error
        );

        download.disabled =
          false;

        download.textContent =
          "Install failed";

        showMessage(
          $("modrinthMsg"),
          error.message ||
            "Failed to install plugin.",
          "error"
        );

      }

    }
  );

  actions.appendChild(
    download
  );

  const modrinth =
    document.createElement("a");

  modrinth.className =
    "modrinth-project";

  modrinth.textContent =
    "View on Modrinth";

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
   * Check that a compatible JAR actually exists.
   */

  try {

    const versionUrl =
      new URL(
        `${MODRINTH_API}/project/${
          encodeURIComponent(
            project.project_id
          )
        }/version`
      );

    versionUrl.searchParams.set(
      "loaders",
      JSON.stringify([
        "paper",
        "spigot",
        "bukkit"
      ])
    );

    versionUrl.searchParams.set(
      "game_versions",
      JSON.stringify([
        minecraftVersion
      ])
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

      download.disabled =
        true;

      return card;
    }

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
        "No JAR available";

      download.disabled =
        true;

      return card;
    }

    download.textContent =
      "Install to server";

  } catch (error) {

    console.error(
      "Modrinth compatibility check:",
      error
    );

    download.textContent =
      "Unavailable";

    download.disabled =
      true;
  }

  return card;
}


/* ============================================================
   INSTALL MODRINTH PLUGIN
   ============================================================ */

async function installModrinthPlugin(
  projectId,
  minecraftVersion,
  pluginName
) {

  const user =
    auth.currentUser;

  if (!user) {
    throw new Error(
      "You must be signed in."
    );
  }

  if (!currentServerId) {
    throw new Error(
      "Select a server first."
    );
  }

  /*
   * The agent should handle the actual download.
   *
   * The browser only creates a Firestore job.
   */

  await addDoc(
    collection(db, "jobs"),
    {
      owner:
        user.uid,

      serverId:
        currentServerId,

      type:
        "install-plugin",

      projectId,

      minecraftVersion,

      pluginName,

      status:
        "queued",

      createdAt:
        Date.now()
    }
  );

  showMessage(
    $("modrinthMsg"),
    `${pluginName} installation queued.`,
    "success"
  );
}
/* ============================================================
   MODRINTH DOWNLOAD FORMATTER
   ============================================================ */

function formatDownloads(value) {

  const number = Number(value || 0);

  if (number >= 1_000_000_000) {
    return (number / 1_000_000_000).toFixed(1) + "B";
  }

  if (number >= 1_000_000) {
    return (number / 1_000_000).toFixed(1) + "M";
  }

  if (number >= 1_000) {
    return (number / 1_000).toFixed(1) + "K";
  }

  return String(number);
}


/* ============================================================
   CUSTOM DOMAIN — VERIFICATION TICKETS
   ============================================================ *
 *
 * Flow:
 *
 *   1. User submits a domain here.
 *   2. A "domainTickets" doc is created with
 *      status "waiting_for_verification".
 *   3. The UI tells them to open a Discord ticket and
 *      give the domain/request info there.
 *   4. A human on Discord verifies they control the
 *      domain, then manually flips the ticket's status
 *      from "waiting_for_verification" to "queued" in
 *      Firestore.
 *   5. The hosting agent picks up "queued" tickets and
 *      wires the domain to the server.
 *
 * This page never sets a ticket to "queued" itself —
 * that transition only happens after a human verifies
 * ownership.
 */

$("domainForm")?.addEventListener(
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
        $("domainMsg"),
        "Select a server first.",
        "error"
      );

      return;

    }


    const domain =
      $("domainInput")
        .value
        .trim()
        .toLowerCase();


    if (!domain) {

      return;

    }


    try {

      $("domainSubmit").disabled =
        true;

      await addDoc(
        collection(db, "domainTickets"),
        {

          owner:
            user.uid,

          email:
            user.email || "",

          serverId:
            currentServerId,

          domain,

          status:
            "waiting_for_verification",

          createdAt:
            Date.now()

        }
      );


      $("domainInput").value =
        "";


      showMessage(
        $("domainMsg"),
        `Request submitted for ${domain}. Open a ticket in our ` +
        `Discord server (${DISCORD_INVITE_URL}) and share this ` +
        `domain so we can verify you control it.`,
        "success"
      );


    } catch (error) {

      console.error(
        "Domain ticket error:",
        error
      );

      showFirebaseError(
        error,
        $("domainMsg")
      );

    } finally {

      $("domainSubmit").disabled =
        false;

    }

  }
);


function watchDomainTickets(uid) {

  if (domainTicketsUnsubscribe) {

    domainTicketsUnsubscribe();

  }


  const q =
    query(
      collection(db, "domainTickets"),
      where(
        "owner",
        "==",
        uid
      )
    );


  domainTicketsUnsubscribe =
    onSnapshot(
      q,

      snapshot => {

        latestDomainTickets =
          snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );


        renderDomainStatus(
          latestDomainTickets
        );

      },

      error => {

        console.error(
          "Domain ticket listener:",
          error
        );

      }
    );

}


function renderDomainStatus(tickets) {

  const box =
    $("domainStatus");

  if (!box) return;


  if (!currentServerId) {

    box.className =
      "domain-status";

    box.textContent =
      "";

    return;

  }


  const forThisServer =
    tickets
      .filter(
        ticket =>
          ticket.serverId ===
          currentServerId
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


  const latest =
    forThisServer[0];


  if (!latest) {

    box.className =
      "domain-status";

    box.textContent =
      "";

    return;

  }


  box.className =
    `domain-status visible status-${latest.status}`;


  if (latest.status === "failed") {

    box.textContent =
      `${latest.domain}: ${prettyDomainStatus(latest.status)}` +
      (
        latest.error
          ? ` — ${latest.error}`
          : ""
      );

  } else {

    box.textContent =
      `${latest.domain}: ${prettyDomainStatus(latest.status)}`;

  }

}
