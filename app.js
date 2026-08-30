const firebaseConfig = {
  apiKey: "AIzaSyAew9fVw91DarhE9mUUIy2VZ2sCVxrAX44",
  authDomain: "mchost-9516b.firebaseapp.com",
  projectId: "mchost-9516b",
  storageBucket: "mchost-9516b.firebasestorage.app",
  messagingSenderId: "692774609042",
  appId: "1:692774609042:web:dd447dc87803450d22864b"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

const HOSTNAME = "freemchosting.vexr.dev";
const MAX_SERVERS = 1;
const FREE_RAM_LIMIT = 3072;

// Put your Firebase Auth UID here.
const ADMIN_UIDS = [
  "2QWQ0Z6HQMVrePmd0yr1aRKeRQ43"
];

const MODRINTH_API = "https://api.modrinth.com/v2";

const MODRINTH_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "FreeMCHosting/1.0 (https://freemchosting.vexr.dev)"
};

let currentUser = null;
let servers = [];

let selectedServer =
  localStorage.getItem("localnode.selectedServer") || null;

let activeServer = null;

let chatUnsub = null;
let serversUnsub = null;
let queueUnsub = null;
let notifyUnsub = null;

let adminServers = [];

let registerMode = false;

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );
}


/* ---------------- AUTH ---------------- */

function toggleAuthMode() {
  registerMode = !registerMode;

  $("authBtn").textContent =
    registerMode ? "Create account" : "Sign In";

  $("authSubtitle").textContent =
    registerMode
      ? "Create your account."
      : "Sign in to manage your Minecraft servers.";

  $("authSwitch").innerHTML =
    registerMode
      ? 'Already have an account? <button class="link" onclick="toggleAuthMode()">Sign in</button>'
      : 'Don\'t have an account? <button class="link" onclick="toggleAuthMode()">Sign up</button>';
}

$("authBtn").onclick = async () => {
  const email = $("authEmail").value.trim();
  const pass = $("authPassword").value;

  if (!email || !pass) {
    return;
  }

  $("authError").textContent = "";

  try {
    if (registerMode) {
      await auth.createUserWithEmailAndPassword(email, pass);
    } else {
      await auth.signInWithEmailAndPassword(email, pass);
    }
  } catch (e) {
    $("authError").textContent =
      String(e.message || e).replace("Firebase: ", "");
  }
};

async function signOutUser() {
  await auth.signOut();
}

auth.onAuthStateChanged(async user => {
  currentUser = user;

  if (!user) {
    $("authOverlay").classList.remove("hidden");
    return;
  }

  $("authOverlay").classList.add("hidden");

  $("userEmail").textContent =
    user.email || user.uid;

  try {
    await ensureProfile(user);
    startListeners();
    restoreSelection();
  } catch (error) {
    console.error("Startup error:", error);

    const errorBox = $("authError");

    if (errorBox) {
      errorBox.textContent =
        error.message || String(error);
    }
  }
});


async function ensureProfile(user) {
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      email: user.email || "",
      maxServers: MAX_SERVERS,
      ramLimit: FREE_RAM_LIMIT,
      createdAt: Date.now()
    });
  }
}


/* ---------------- FIRESTORE LISTENERS ---------------- */

function startListeners() {
  if (serversUnsub) {
    serversUnsub();
  }

  serversUnsub = db
    .collection("servers")
    .where("owner", "==", currentUser.uid)
    .onSnapshot(
      snap => {
        servers = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        renderServers();
        renderServerTabs();

        if (
          selectedServer &&
          !servers.some(server => server.id === selectedServer)
        ) {
          selectedServer = null;
          localStorage.removeItem("localnode.selectedServer");
        }

        if (selectedServer) {
          selectServer(selectedServer, false);
        }
      },
      error => {
        console.error("Servers listener error:", error);
      }
    );


  if (chatUnsub) {
    chatUnsub();
  }

  chatUnsub = db
    .collection("globalChat")
    .orderBy("createdAt", "desc")
    .limit(100)
    .onSnapshot(
      snap => {
        const messages = snap.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
          .reverse();

        $("chatMessages").innerHTML =
          messages
            .map(
              message => `
                <div class="chat-msg">
                  <b>${esc(
                    message.displayName ||
                    message.email ||
                    "User"
                  )}:</b>
                  ${esc(message.message)}
                  <span class="muted">
                    ${new Date(
                      message.createdAt || 0
                    ).toLocaleTimeString()}
                  </span>
                </div>
              `
            )
            .join("") ||
          '<div class="muted">No messages yet.</div>';

        const chatContainer = $("chatMessages");

        if (chatContainer) {
          chatContainer.scrollTop =
            chatContainer.scrollHeight;
        }
      },
      error => {
        console.error("Chat listener error:", error);
      }
    );


  if (queueUnsub) {
    queueUnsub();
  }

  queueUnsub = db
    .collection("jobs")
    .where("status", "==", "queued")
    .onSnapshot(
      snap => {
        const jobs = snap.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
          .filter(job => job.type === "provision")
          .sort(
            (a, b) =>
              (a.createdAt || 0) -
              (b.createdAt || 0)
          );

        $("queueCount").textContent =
          jobs.length;

        $("queueList").innerHTML =
          jobs
            .map((job, index) => {
              const delay = Math.max(
                0,
                Math.ceil(
                  (
                    (job.notBeforeAt ||
                      job.createdAt ||
                      Date.now()) -
                    Date.now()
                  ) / 1000
                )
              );

              return `
                <div class="queue-item">
                  #${index + 1} •
                  ${esc(
                    job.serverName ||
                    job.serverId
                  )} •
                  ${delay}s delay
                </div>
              `;
            })
            .join("") ||
          '<div class="muted">Queue is empty.</div>';
      },
      error => {
        console.error("Queue listener error:", error);
      }
    );


  if (notifyUnsub) {
    notifyUnsub();
  }

  notifyUnsub = db
    .collection("notifications")
    .where("owner", "==", currentUser.uid)
    .limit(30)
    .onSnapshot(
      snap => {
        const notifications = snap.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
          .sort(
            (a, b) =>
              (b.createdAt || 0) -
              (a.createdAt || 0)
          );

        $("notifications").innerHTML =
          notifications
            .map(
              notification => `
                <div class="queue-item">
                  🔔
                  <b>
                    ${esc(
                      notification.title ||
                      "Notification"
                    )}
                  </b>

                  <div>
                    ${esc(
                      notification.message || ""
                    )}
                  </div>

                  <small class="muted">
                    ${new Date(
                      notification.createdAt || 0
                    ).toLocaleString()}
                  </small>
                </div>
              `
            )
            .join("") ||
          '<div class="muted">No notifications.</div>';
      },
      error => {
        console.error(
          "Notification listener error:",
          error
        );
      }
    );
}


/* ---------------- SERVER TABS ---------------- */

function renderServerTabs() {
  const bar = $("serverTabs");

  if (!bar) {
    return;
  }

  bar.innerHTML = `
    <button
      class="tab ${!selectedServer ? "active" : ""}"
      onclick="showGlobal()"
    >
      🌐 Global
    </button>
  `;

  servers.forEach(server => {
    const button =
      document.createElement("button");

    button.className =
      "tab " +
      (
        selectedServer === server.id
          ? "active"
          : ""
      );

    button.textContent =
      "🖥️ " +
      (server.name || server.id);

    button.onclick = () =>
      selectServer(server.id);

    bar.appendChild(button);
  });

  if (
    ADMIN_UIDS.includes(
      currentUser?.uid
    )
  ) {
    const adminButton =
      document.createElement("button");

    adminButton.className = "tab";
    adminButton.textContent =
      "🛡️ Admin";

    adminButton.onclick = showAdmin;

    bar.appendChild(adminButton);
  }

  const serversButton =
    document.createElement("button");

  serversButton.className = "tab";
  serversButton.textContent =
    "📋 My Servers";

  serversButton.onclick = () => {
    hidePanels();

    $("serversPanel")
      .classList
      .add("active");
  };

  bar.appendChild(serversButton);
}


/* ---------------- PANELS ---------------- */

function hidePanels() {
  [
    "globalPanel",
    "serverPanel",
    "adminPanel",
    "serversPanel"
  ].forEach(id => {
    const element = $(id);

    if (element) {
      element.classList.remove("active");
    }
  });
}

function showGlobal() {
  selectedServer = null;

  localStorage.removeItem(
    "localnode.selectedServer"
  );

  activeServer = null;

  hidePanels();

  $("globalPanel")
    .classList
    .add("active");

  renderServerTabs();
}


function selectServer(
  id,
  persist = true
) {
  const server =
    servers.find(
      item => item.id === id
    );

  if (!server) {
    return;
  }

  selectedServer = id;
  activeServer = server;

  if (persist) {
    localStorage.setItem(
      "localnode.selectedServer",
      id
    );
  }

  hidePanels();

  $("serverPanel")
    .classList
    .add("active");

  renderServerTabs();
  renderServer();
  loadFiles();
  loadDomains();
  loadTickets();
}


function restoreSelection() {
  if (
    selectedServer &&
    servers.find(
      server =>
        server.id === selectedServer
    )
  ) {
    selectServer(
      selectedServer,
      false
    );
  } else {
    showGlobal();
  }
}


/* ---------------- SERVER DISPLAY ---------------- */

function renderServers() {
  $("serverCards").innerHTML =
    servers
      .map(
        server => `
          <div
            class="card server-card"
            onclick="selectServer('${esc(server.id)}')"
          >
            <div class="section-head">
              <h3>
                ${esc(
                  server.name ||
                  server.id
                )}
              </h3>

              <span class="pill">
                ${esc(
                  server.status ||
                  "offline"
                )}
              </span>
            </div>

            <div class="muted">
              ${esc(server.version || "")}
              •
              ${Number(server.ram || 0)}
              MB
            </div>

            <div>
              ${esc(
                server.address ||
                "Not online"
              )}
            </div>
          </div>
        `
      )
      .join("") ||
    `
      <div class="card">
        <div class="muted">
          No servers yet.
        </div>
      </div>
    `;
}


function renderServer() {
  if (!activeServer) {
    return;
  }

  $("serverHeader").innerHTML = `
    <div>
      <h2>
        ${esc(
          activeServer.name ||
          activeServer.id
        )}
      </h2>

      <div class="muted">
        ${esc(
          activeServer.version || ""
        )}
        •
        ${Number(
          activeServer.ram || 0
        )}
        MB
      </div>
    </div>

    <span class="pill">
      ${esc(
        activeServer.status ||
        "offline"
      )}
    </span>
  `;

  $("serverStatus").textContent =
    activeServer.status ||
    "offline";

  $("consoleOutput").textContent =
    activeServer.console ||
    "No console output yet.";

  $("connectBox").innerHTML =
    activeServer.address
      ? `
        <b>Connect:</b>
        <code>
          ${esc(
            activeServer.address
          )}
        </code>
      `
      : "Waiting for hosting agent…";

  $("queueInfo").textContent =
    [
      "queued",
      "pending"
    ].includes(
      activeServer.status
    )
      ? "This server is queued. Every new request waits at least 10 seconds before the worker tries it."
      : "";
}


/* ---------------- SUB TABS ---------------- */

function switchSub(tab) {
  document
    .querySelectorAll(".subtab")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.sub === tab
      );
    });

  document
    .querySelectorAll(".subpanel")
    .forEach(panel => {
      panel.classList.toggle(
        "active",
        panel.id === "sub-" + tab
      );
    });

  if (tab === "files") {
    loadFiles();
  }

  if (tab === "domains") {
    loadDomains();
  }

  if (tab === "support") {
    loadTickets();
  }
}

document
  .querySelectorAll(".subtab")
  .forEach(button => {
    button.onclick = () =>
      switchSub(
        button.dataset.sub
      );
  });


/* ---------------- CREATE SERVER ---------------- */

function openCreate() {
  $("createModal")
    .classList
    .remove("hidden");
}

function closeCreate() {
  $("createModal")
    .classList
    .add("hidden");
}


async function createServer() {
  if (!currentUser) {
    return;
  }

  const name =
    $("newName").value.trim();

  const version =
    $("newVersion").value;

  const ram =
    Number(
      $("newRam").value
    );

  if (!name) {
    return alert(
      "Enter a server name."
    );
  }

  const profileSnap =
    await db
      .collection("users")
      .doc(currentUser.uid)
      .get();

  const profile =
    profileSnap.data() || {};

  const serverSnap =
    await db
      .collection("servers")
      .where(
        "owner",
        "==",
        currentUser.uid
      )
      .get();

  const active =
    serverSnap.docs
      .map(doc => doc.data())
      .filter(server =>
        [
          "online",
          "starting",
          "provisioning",
          "restarting",
          "queued"
        ].includes(
          server.status
        )
      );

  if (
    active.length >=
    Number(
      profile.maxServers ||
      MAX_SERVERS
    )
  ) {
    return alert(
      "Server limit reached."
    );
  }

  if (
    ram >
    Number(
      profile.ramLimit ||
      FREE_RAM_LIMIT
    )
  ) {
    return alert(
      "RAM limit exceeded."
    );
  }

  const ref =
    db.collection("servers").doc();

  const now = Date.now();

  await ref.set({
    owner: currentUser.uid,
    name,
    version,
    ram,
    status: "queued",
    address: "",
    port: 0,
    console:
      "Waiting in hosting queue…",
    createdAt: now
  });

  await db
    .collection("jobs")
    .add({
      owner: currentUser.uid,
      serverId: ref.id,
      serverName: name,
      type: "provision",
      status: "queued",
      createdAt: now,
      notBeforeAt:
        now + 10000
    });

  closeCreate();

  $("newName").value = "";

  selectServer(ref.id);
}


/* ---------------- SERVER ACTIONS ---------------- */

async function serverAction(type) {
  if (
    !activeServer ||
    !currentUser
  ) {
    return;
  }

  const now = Date.now();

  await db
    .collection("jobs")
    .add({
      owner: currentUser.uid,
      serverId: activeServer.id,
      type,
      status: "queued",
      createdAt: now,
      notBeforeAt:
        now + 10000
    });

  await db
    .collection("servers")
    .doc(activeServer.id)
    .update({
      status:
        type === "start"
          ? "starting"
          : type === "stop"
            ? "stopping"
            : "restarting"
    });
}


async function sendCommand() {
  if (!activeServer) {
    return;
  }

  let command =
    $("commandInput")
      .value
      .trim()
      .replace(/^\//, "");

  if (!command) {
    return;
  }

  const now = Date.now();

  await db
    .collection("jobs")
    .add({
      owner: currentUser.uid,
      serverId: activeServer.id,
      type: "command",
      command,
      status: "queued",
      createdAt: now,
      notBeforeAt:
        now + 10000
    });

  $("commandInput").value = "";
}


/* ---------------- CHAT ---------------- */

async function sendChat() {
  const message =
    $("chatInput")
      .value
      .trim();

  if (
    !message ||
    !currentUser
  ) {
    return;
  }

  await db
    .collection("globalChat")
    .add({
      owner: currentUser.uid,
      email:
        currentUser.email || "",
      displayName:
        (
          currentUser.email ||
          ""
        ).split("@")[0],
      message:
        message.slice(0, 500),
      createdAt:
        Date.now()
    });

  $("chatInput").value = "";
}


/* ---------------- FILES ---------------- */

let filePath = "/";

function safePath(value) {
  const normalized =
    String(value || "")
      .replaceAll("\\", "/");

  const parts =
    normalized
      .split("/")
      .filter(
        part =>
          part &&
          part !== "." &&
          part !== ".."
      );

  return parts.join("/");
}


async function fileJob(
  type,
  extra = {}
) {
  if (!activeServer) {
    return;
  }

  const now = Date.now();

  await db
    .collection("jobs")
    .add({
      owner: currentUser.uid,
      serverId: activeServer.id,
      type,
      path: filePath,
      status: "queued",
      createdAt: now,
      notBeforeAt:
        now + 10000,
      ...extra
    });
}


async function loadFiles() {
  if (!activeServer) {
    return;
  }

  try {
    const snap =
      await db
        .collection("serverFiles")
        .where(
          "owner",
          "==",
          currentUser.uid
        )
        .where(
          "serverId",
          "==",
          activeServer.id
        )
        .get();

    const items =
      snap.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(file => {
          const path =
            safePath(
              file.path || ""
            );

          const current =
            filePath === "/"
              ? ""
              : safePath(filePath);

          return path.startsWith(
            current
          );
        });

    $("filePath").textContent =
      filePath;

    $("fileList").innerHTML =
      items
        .map(file => {
          const path =
            file.path || "";

          const name =
            path
              .split("/")
              .pop();

          return `
            <div class="file-row">
              <span
                class="file-name"
                onclick="openFile('${esc(path)}')"
              >
                ${
                  file.type ===
                  "directory"
                    ? "📁"
                    : "📄"
                }
                ${esc(name)}
              </span>

              <span>
                ${
                  file.size
                    ? formatBytes(
                        file.size
                      )
                    : ""
                }

                <button
                  onclick="deleteFile('${esc(path)}')"
                >
                  Delete
                </button>
              </span>
            </div>
          `;
        })
        .join("") ||
      `
        <div class="muted">
          No files reported yet.
          The Agent populates this
          collection after file operations.
        </div>
      `;
  } catch (error) {
    console.error(
      "loadFiles error:",
      error
    );
  }
}


function formatBytes(value) {
  const n =
    Number(value || 0);

  if (n < 1024) {
    return n + " B";
  }

  if (n < 1048576) {
    return (
      n / 1024
    ).toFixed(1) +
      " KB";
  }

  return (
    n / 1048576
  ).toFixed(1) +
    " MB";
}


function openFile(path) {
  filePath =
    "/" +
    safePath(path);

  loadFiles();
}


async function deleteFile(path) {
  if (
    !confirm(
      "Delete " + path + "?"
    )
  ) {
    return;
  }

  const now = Date.now();

  await db
    .collection("jobs")
    .add({
      owner: currentUser.uid,
      serverId: activeServer.id,
      type: "file-delete",
      path: safePath(path),
      status: "queued",
      createdAt: now,
      notBeforeAt:
        now + 10000
    });
}


async function uploadFile() {
  const file =
    $("fileUpload").files[0];

  if (
    !file ||
    !activeServer
  ) {
    return;
  }

  if (file.size > 262144) {
    return alert(
      "Upload is limited to 256 KB in this Firestore-only version."
    );
  }

  const data =
    await file.arrayBuffer();

  let bytes = "";

  const u8 =
    new Uint8Array(data);

  for (
    let i = 0;
    i < u8.length;
    i++
  ) {
    bytes += String.fromCharCode(
      u8[i]
    );
  }

  const base64 =
    btoa(bytes);

  const destination =
    safePath(
      (
        filePath === "/"
          ? ""
          : filePath + "/"
      ) +
        file.name
    );

  await fileJob(
    "file-upload",
    {
      path: destination,
      data: base64,
      size: file.size
    }
  );

  alert(
    "Upload queued."
  );
}


/* ---------------- MODRINTH ---------------- */

async function searchPlugins() {
  const query =
    $("pluginSearch")
      .value
      .trim();

  if (
    !query ||
    !activeServer
  ) {
    return;
  }

  const results =
    $("pluginResults");

  results.innerHTML =
    `
      <div class="muted">
        Searching compatible Paper plugins…
      </div>
    `;

  try {
    const facets =
      JSON.stringify([
        ["project_type:plugin"],
        [`versions:${activeServer.version}`]
      ]);

    const url =
      MODRINTH_API +
      "/search?query=" +
      encodeURIComponent(query) +
      "&limit=20&facets=" +
      encodeURIComponent(facets);

    const response =
      await fetch(
        url,
        {
          headers:
            MODRINTH_HEADERS
        }
      );

    if (!response.ok) {
      throw new Error(
        "Modrinth HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    const hits =
      (data.hits || [])
        .filter(
          plugin =>
            plugin.project_type ===
            "plugin"
        );

    if (!hits.length) {
      results.innerHTML =
        `
          <div class="muted">
            No compatible plugin projects found.
          </div>
        `;

      return;
    }

    results.innerHTML =
      hits
        .map(
          plugin => `
            <div class="plugin">
              ${
                plugin.icon_url
                  ? `
                    <img
                      src="${esc(
                        plugin.icon_url
                      )}"
                      alt=""
                    >
                  `
                  : ""
              }

              <h4>
                ${esc(
                  plugin.title
                )}
              </h4>

              <div class="muted">
                ${esc(
                  plugin.author ||
                  "Unknown"
                )}
                •
                ${Number(
                  plugin.downloads || 0
                ).toLocaleString()}
                downloads
              </div>

              <p>
                ${esc(
                  plugin.description ||
                  ""
                )}
              </p>

              <button
                onclick="installPlugin('${esc(plugin.project_id)}')"
                class="primary"
              >
                Install
              </button>
            </div>
          `
        )
        .join("");
  } catch (error) {
    console.error(
      "Modrinth search error:",
      error
    );

    results.innerHTML =
      `
        <div class="muted">
          Search failed:
          ${esc(
            error.message ||
            String(error)
          )}
        </div>
      `;
  }
}


async function installPlugin(
  projectId
) {
  if (
    !activeServer ||
    !projectId
  ) {
    return;
  }

  try {
    const params =
      new URLSearchParams();

    params.set(
      "loaders",
      JSON.stringify([
        "paper",
        "spigot",
        "bukkit",
        "purpur",
        "folia"
      ])
    );

    params.set(
      "game_versions",
      JSON.stringify([
        activeServer.version
      ])
    );

    const url =
      MODRINTH_API +
      "/project/" +
      encodeURIComponent(
        projectId
      ) +
      "/version?" +
      params.toString();

    const response =
      await fetch(
        url,
        {
          headers:
            MODRINTH_HEADERS
        }
      );

    if (!response.ok) {
      return alert(
        "Could not check compatible plugin versions. Modrinth HTTP " +
        response.status
      );
    }

    const versions =
      await response.json();

    const compatible =
      versions.filter(
        version => {
          const loaderOK =
            Array.isArray(
              version.loaders
            ) &&
            version.loaders.some(
              loader =>
                [
                  "paper",
                  "spigot",
                  "bukkit",
                  "purpur",
                  "folia"
                ].includes(
                  String(
                    loader
                  ).toLowerCase()
                )
            );

          const gameVersionOK =
            Array.isArray(
              version.game_versions
            ) &&
            version.game_versions.includes(
              activeServer.version
            );

          const typeOK =
            !version.version_type ||
            [
              "release",
              "beta"
            ].includes(
              String(
                version.version_type
              ).toLowerCase()
            );

          return (
            loaderOK &&
            gameVersionOK &&
            typeOK
          );
        }
      );

    if (!compatible.length) {
      return alert(
        "No compatible plugin version found for Minecraft " +
        activeServer.version
      );
    }

    compatible.sort(
      (a, b) =>
        Date.parse(
          b.date_published || 0
        ) -
        Date.parse(
          a.date_published || 0
        )
    );

    const version =
      compatible[0];

    const file =
      (version.files || [])
        .find(
          item =>
            item.primary === true &&
            String(
              item.filename || ""
            )
              .toLowerCase()
              .endsWith(".jar")
        ) ||
      (version.files || [])
        .find(
          item =>
            String(
              item.filename || ""
            )
              .toLowerCase()
              .endsWith(".jar")
        );

    if (!file) {
      return alert(
        "No JAR available."
      );
    }

    const now = Date.now();

    await db
      .collection("jobs")
      .add({
        owner:
          currentUser.uid,

        serverId:
          activeServer.id,

        type:
          "install-plugin",

        projectId:
          projectId,

        versionId:
          version.id,

        versionNumber:
          version.version_number,

        downloadUrl:
          file.url,

        filename:
          file.filename,

        status:
          "queued",

        createdAt:
          now,

        notBeforeAt:
          now + 10000
      });

    alert(
      "Compatible Paper plugin queued for installation."
    );
  } catch (error) {
    console.error(
      "Plugin installation error:",
      error
    );

    alert(
      error.message ||
      "Could not install plugin."
    );
  }
}


/* ---------------- DOMAINS ---------------- */

async function loadDomains() {
  if (!activeServer) {
    return;
  }

  const snap =
    await db
      .collection("customDomains")
      .where(
        "owner",
        "==",
        currentUser.uid
      )
      .where(
        "serverId",
        "==",
        activeServer.id
      )
      .get();

  $("domainList").innerHTML =
    snap.docs
      .map(doc => {
        const data =
          doc.data();

        return `
          <div class="queue-item">
            🌐
            ${esc(
              data.domain
            )}
            —
            ${esc(
              data.status ||
              "pending"
            )}
          </div>
        `;
      })
      .join("") ||
    `
      <div class="muted">
        No domains.
      </div>
    `;
}


async function addDomain() {
  if (
    !activeServer ||
    !currentUser
  ) {
    return;
  }

  const domain =
    $("domainInput")
      .value
      .trim()
      .toLowerCase();

  if (
    !/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(
      domain
    )
  ) {
    return alert(
      "Enter a valid domain."
    );
  }

  const ref =
    db.collection(
      "customDomains"
    ).doc();

  const now = Date.now();

  await ref.set({
    owner:
      currentUser.uid,

    serverId:
      activeServer.id,

    domain,

    status:
      "pending",

    verified:
      false,

    createdAt:
      now
  });

  await db
    .collection("jobs")
    .add({
      owner:
        currentUser.uid,

      serverId:
        activeServer.id,

      type:
        "verify-custom-domain",

      domainId:
        ref.id,

      domain,

      status:
        "queued",

      createdAt:
        now,

      notBeforeAt:
        now + 10000
    });

  $("domainInput").value = "";

  loadDomains();
}


/* ---------------- SUPPORT ---------------- */

async function submitTicket() {
  if (!currentUser) {
    return;
  }

  const subject =
    $("ticketSubject")
      .value
      .trim();

  const message =
    $("ticketMessage")
      .value
      .trim();

  const needsVerification =
    $("ticketNeedsVerification")
      .checked;

  const domain =
    $("ticketDomain")
      .value
      .trim()
      .toLowerCase();

  if (
    !subject ||
    !message
  ) {
    return alert(
      "Fill in subject and message."
    );
  }

  if (
    needsVerification &&
    !/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(
      domain
    )
  ) {
    return alert(
      "Enter a valid domain."
    );
  }

  const ticket =
    db.collection(
      "tickets"
    ).doc();

  const now = Date.now();

  let verificationId = null;
  let token = null;

  if (needsVerification) {
    verificationId =
      db
        .collection(
          "domainVerifications"
        )
        .doc().id;

    token =
      crypto.randomUUID();

    await db
      .collection(
        "domainVerifications"
      )
      .doc(verificationId)
      .set({
        owner:
          currentUser.uid,

        ticketId:
          ticket.id,

        domain,

        verificationToken:
          token,

        status:
          "pending_verification",

        siteSubmitted:
          false,

        discordSubmitted:
          false,

        createdAt:
          now,

        updatedAt:
          now
      });
  }

  await ticket.set({
    owner:
      currentUser.uid,

    ownerEmail:
      currentUser.email || "",

    subject,

    message,

    domain:
      domain || null,

    requiresDomainVerification:
      needsVerification,

    verificationId,

    status:
      needsVerification
        ? "pending_verification"
        : "open",

    siteSubmitted:
      true,

    discordSubmitted:
      false,

    createdAt:
      now,

    updatedAt:
      now
  });

  $("ticketResult").innerHTML =
    needsVerification
      ? `
        <div class="notice">
          Ticket created.

          Verification token:
          <code>
            ${esc(token)}
          </code>

          <br>

          Complete the Discord verification yourself.
          An admin can change the ticket from
          <code>pending_verification</code>
          to
          <code>queued</code>
          after verification.
        </div>
      `
      : `
        <div class="notice">
          Ticket submitted.
        </div>
      `;

  loadTickets();
}


async function loadTickets() {
  if (!currentUser) {
    return;
  }

  const snap =
    await db
      .collection("tickets")
      .where(
        "owner",
        "==",
        currentUser.uid
      )
      .get();

  $("ticketList").innerHTML =
    snap.docs
      .map(doc => {
        const ticket =
          doc.data();

        return `
          <div class="ticket-item">
            <b>
              ${esc(
                ticket.subject
              )}
            </b>

            —
            
            <span class="pill">
              ${esc(
                ticket.status
              )}
            </span>

            <div class="muted">
              ${esc(
                ticket.message
              )}
            </div>
          </div>
        `;
      })
      .join("") ||
    `
      <div class="muted">
        No tickets.
      </div>
    `;
}


/* ---------------- ADMIN ---------------- */

function showAdmin() {
  if (
    !ADMIN_UIDS.includes(
      currentUser?.uid
    )
  ) {
    return alert(
      "Admin access denied."
    );
  }

  hidePanels();

  $("adminPanel")
    .classList
    .add("active");

  loadAdminServers();
  loadAdminAlerts();
}


async function loadAdminServers() {
  if (
    !ADMIN_UIDS.includes(
      currentUser?.uid
    )
  ) {
    return;
  }

  const snap =
    await db
      .collection("servers")
      .limit(200)
      .get();

  adminServers =
    snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

  renderAdminServers();
}


function renderAdminServers() {
  const search =
    (
      $("adminSearch")
        .value || ""
    ).toLowerCase();

  const filtered =
    adminServers.filter(
      server =>
        [
          server.id,
          server.name,
          server.owner,
          server.address,
          server.status
        ].some(value =>
          String(
            value || ""
          )
            .toLowerCase()
            .includes(search)
        )
    );

  $("adminServers").innerHTML =
    `
      <div class="admin-row">
        <b>Server</b>
        <b>Owner</b>
        <b>Status</b>
        <b>RAM</b>
      </div>
    ` +
    filtered
      .map(
        server => `
          <div class="admin-row">
            <span>
              ${esc(
                server.name ||
                server.id
              )}
            </span>

            <span>
              ${esc(
                server.owner ||
                ""
              )}
            </span>

            <span>
              ${esc(
                server.status ||
                "offline"
              )}
            </span>

            <span>
              ${Number(
                server.ram || 0
              )}
              MB
            </span>
          </div>
        `
      )
      .join("");
}


async function loadAdminAlerts() {
  if (
    !ADMIN_UIDS.includes(
      currentUser?.uid
    )
  ) {
    return;
  }

  const snap =
    await db
      .collection(
        "moderationAlerts"
      )
      .limit(100)
      .get();

  $("adminAlerts").innerHTML =
    snap.docs
      .map(doc => {
        const alertData =
          doc.data();

        return `
          <div class="queue-item">
            ⚠️

            <b>
              ${esc(
                alertData.serverName ||
                alertData.serverId
              )}
            </b>

            <div>
              ${esc(
                alertData.reason ||
                "Potential ToS issue"
              )}
            </div>

            <small class="muted">
              ${esc(
                alertData.severity ||
                "review"
              )}
              •
              ${new Date(
                alertData.createdAt || 0
              ).toLocaleString()}
            </small>
          </div>
        `;
      })
      .join("") ||
    `
      <div class="muted">
        No moderation alerts.
      </div>
    `;
}


/* ---------------- ADMIN SEARCH ---------------- */

const adminSearch =
  $("adminSearch");

if (adminSearch) {
  adminSearch.addEventListener(
    "input",
    renderAdminServers
  );
}
