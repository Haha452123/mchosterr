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

const ADMIN_UIDS = [
  "2QWQ0Z6HQMVrePmd0yr1aRKeRQ43"
];

const MODRINTH_API = "https://api.modrinth.com/v2";

const MODRINTH_HEADERS = {
  "Accept": "application/json",
  "User-Agent": "FreeMCHosting/1.0 (https://freemchosting.vexr.dev)"
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

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );

// ============================================================
// AUTH
// ============================================================

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
: 'Don't have an account? <button class="link" onclick="toggleAuthMode()">Sign up</button>';
}

$("authBtn").onclick = async () => {
const email = $("authEmail").value.trim();
const pass = $("authPassword").value;

if (!email || !pass) return;

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

```
if ($("authError")) {
  $("authError").textContent =
    error.message || String(error);
}
```

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

// ============================================================
// FIRESTORE LISTENERS
// ============================================================

function startListeners() {

if (serversUnsub) {
serversUnsub();
serversUnsub = null;
}

serversUnsub =
db.collection("servers")
.where("owner", "==", currentUser.uid)
.onSnapshot(
snap => {
servers = snap.docs.map(doc => ({
id: doc.id,
...doc.data()
}));

```
      renderServers();
      renderServerTabs();

      if (
        selectedServer &&
        !servers.some(server => server.id === selectedServer)
      ) {
        selectedServer = null;
      }

      if (selectedServer) {
        selectServer(selectedServer, false);
      }
    },
    error => {
      console.error("Servers listener error:", error);
    }
  );
```

if (chatUnsub) {
chatUnsub();
chatUnsub = null;
}

chatUnsub =
db.collection("globalChat")
.orderBy("createdAt", "desc")
.limit(100)
.onSnapshot(
snap => {
const messages =
snap.docs
.map(doc => ({
id: doc.id,
...doc.data()
}))
.reverse();

```
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

      const chat = $("chatMessages");

      if (chat) {
        chat.scrollTop = chat.scrollHeight;
      }
    },
    error => {
      console.error("Chat listener error:", error);
    }
  );
```

if (queueUnsub) {
queueUnsub();
queueUnsub = null;
}

queueUnsub =
db.collection("jobs")
.where("status", "==", "queued")
.onSnapshot(
snap => {
const jobs =
snap.docs
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

```
      $("queueCount").textContent = jobs.length;

      $("queueList").innerHTML =
        jobs
          .map(
            (job, index) => `
              <div class="queue-item">
                #${index + 1}
                • ${esc(job.serverName || job.serverId)}
                • ${Math.max(
                  0,
                  Math.ceil(
                    (
                      (job.notBeforeAt ||
                        job.createdAt ||
                        Date.now()) -
                      Date.now()
                    ) / 1000
                  )
                )}s delay
              </div>
            `
          )
          .join("") ||
        '<div class="muted">Queue is empty.</div>';
    },
    error => {
      console.error("Queue listener error:", error);
    }
  );
```

if (notifyUnsub) {
notifyUnsub();
notifyUnsub = null;
}

notifyUnsub =
db.collection("notifications")
.where("owner", "==", currentUser.uid)
.limit(30)
.onSnapshot(
snap => {
const notifications =
snap.docs
.map(doc => ({
id: doc.id,
...doc.data()
}))
.sort(
(a, b) =>
(b.createdAt || 0) -
(a.createdAt || 0)
);

```
      $("notifications").innerHTML =
        notifications
          .map(
            notification => `
              <div class="queue-item">
                🔔
                <b>${esc(
                  notification.title ||
                  "Notification"
                )}</b>

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
```

}

// ============================================================
// SERVER TABS
// ============================================================

function renderServerTabs() {
const bar = $("serverTabs");

if (!bar) return;

bar.innerHTML = `     <button
      class="tab ${!selectedServer ? "active" : ""}"
      onclick="showGlobal()"     >
      🌐 Global     </button>
  `;

servers.forEach(server => {
const button = document.createElement("button");

```
button.className =
  "tab " +
  (selectedServer === server.id
    ? "active"
    : "");

button.textContent =
  "🖥️ " + (server.name || server.id);

button.onclick = () =>
  selectServer(server.id);

bar.appendChild(button);
```

});

if (ADMIN_UIDS.includes(currentUser?.uid)) {
const button =
document.createElement("button");

```
button.className = "tab";
button.textContent = "🛡️ Admin";
button.onclick = showAdmin;

bar.appendChild(button);
```

}

const myServers =
document.createElement("button");

myServers.className = "tab";
myServers.textContent = "📋 My Servers";

myServers.onclick = () => {
hidePanels();

```
$("serversPanel")
  .classList.add("active");
```

};

bar.appendChild(myServers);
}

function hidePanels() {
[
"globalPanel",
"serverPanel",
"adminPanel",
"serversPanel"
].forEach(id => {
const element = $(id);

```
if (element) {
  element.classList.remove("active");
}
```

});
}

function showGlobal() {
selectedServer = null;

localStorage.removeItem(
"localnode.selectedServer"
);

hidePanels();

$("globalPanel")
.classList.add("active");

renderServerTabs();
}

function selectServer(id, persist = true) {
const server =
servers.find(server => server.id === id);

if (!server) return;

selectedServer = id;

if (persist) {
localStorage.setItem(
"localnode.selectedServer",
id
);
}

activeServer = server;

hidePanels();

$("serverPanel")
.classList.add("active");

renderServerTabs();
renderServer();

loadFiles();
loadDomains();
loadTickets();
}

function restoreSelection() {
if (
selectedServer &&
servers.find(server => server.id === selectedServer)
) {
selectServer(
selectedServer,
false
);
} else {
showGlobal();
}
}

// ============================================================
// SERVER DISPLAY
// ============================================================

function renderServers() {
$("serverCards").innerHTML =
servers
.map(
server => ` <div
         class="card server-card"
         onclick="selectServer('${esc(server.id)}')"
       > <div class="section-head"> <h3>
${esc(
server.name ||
server.id
)} </h3>

```
          <span class="pill">
            ${esc(
              server.status ||
              "offline"
            )}
          </span>
        </div>

        <div class="muted">
          ${esc(
            server.version || ""
          )}
          •
          ${Number(
            server.ram || 0
          )} MB
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
```

}

function renderServer() {
if (!activeServer) return;

$("serverHeader").innerHTML = ` <div> <h2>
${esc(
activeServer.name ||
activeServer.id
)} </h2>

```
  <div class="muted">
    ${esc(
      activeServer.version || ""
    )}
    •
    ${Number(
      activeServer.ram || 0
    )} MB
  </div>
</div>

<span class="pill">
  ${esc(
    activeServer.status ||
    "offline"
  )}
</span>
```

`;

$("serverStatus").textContent =
activeServer.status ||
"offline";

$("consoleOutput").textContent =
activeServer.console ||
"No console output yet.";

$("connectBox").innerHTML =
activeServer.address
? `         <b>Connect:</b>         <code>
          ${esc(activeServer.address)}         </code>
      `
: "Waiting for hosting agent…";

$("queueInfo").textContent =
["queued", "pending"].includes(
activeServer.status
)
? "This server is queued. Every new request waits at least 10 seconds before the worker tries it."
: "";
}

// ============================================================
// SERVER SUB TABS
// ============================================================

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
switchSub(button.dataset.sub);
});

// ============================================================
// CREATE SERVER
// ============================================================

function openCreate() {
$("createModal")
.classList.remove("hidden");
}

function closeCreate() {
$("createModal")
.classList.add("hidden");
}

async function createServer() {
if (!currentUser) return;

const name =
$("newName").value.trim();

const version =
$("newVersion").value;

const ram =
Number($("newRam").value);

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
].includes(server.status)
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

await db.collection("jobs").add({
owner: currentUser.uid,
serverId: ref.id,
serverName: name,
type: "provision",
status: "queued",
createdAt: now,
notBeforeAt: now + 10000
});

closeCreate();

$("newName").value = "";

selectServer(ref.id);
}

// ============================================================
// SERVER ACTIONS
// ============================================================

async function serverAction(type) {
if (!activeServer || !currentUser) {
return;
}

const now = Date.now();

await db.collection("jobs").add({
owner: currentUser.uid,
serverId: activeServer.id,
type,
status: "queued",
createdAt: now,
notBeforeAt: now + 10000
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
if (!activeServer) return;

let command =
$("commandInput")
.value
.trim()
.replace(/^//, "");

if (!command) return;

const now = Date.now();

await db.collection("jobs").add({
owner: currentUser.uid,
serverId: activeServer.id,
type: "command",
command,
status: "queued",
createdAt: now,
notBeforeAt: now + 10000
});

$("commandInput").value = "";
}

// ============================================================
// CHAT
// ============================================================

async function sendChat() {
const message =
$("chatInput").value.trim();

if (!message || !currentUser) {
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
currentUser.email || ""
).split("@")[0],
message:
message.slice(0, 500),
createdAt: Date.now()
});

$("chatInput").value = "";
}

// ============================================================
// FILES
// ============================================================

let filePath = "/";

function safePath(p) {
p = String(p || "")
.replaceAll("\", "/");

const parts =
p
.split("/")
.filter(
x =>
x &&
x !== "." &&
x !== ".."
);

return parts.join("/");
}

async function fileJob(
type,
extra = {}
) {
if (!activeServer) return;

const now = Date.now();

await db.collection("jobs").add({
owner: currentUser.uid,
serverId: activeServer.id,
type,
path: filePath,
status: "queued",
createdAt: now,
notBeforeAt: now + 10000,
...extra
});
}

async function loadFiles() {
if (!activeServer) return;

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

```
const items =
  snap.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    .filter(file =>
      safePath(
        file.path || ""
      ).startsWith(
        filePath === "/"
          ? ""
          : safePath(filePath)
      )
    );

$("filePath").textContent =
  filePath;

$("fileList").innerHTML =
  items
    .map(
      file => `
        <div class="file-row">
          <span
            class="file-name"
            onclick="openFile('${esc(
              file.path || ""
            )}')"
          >
            ${
              file.type ===
              "directory"
                ? "📁"
                : "📄"
            }
            ${esc(
              (
                file.path || ""
              )
                .split("/")
                .pop()
            )}
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
              onclick="deleteFile('${esc(
                file.path || ""
              )}')"
            >
              Delete
            </button>
          </span>
        </div>
      `
    )
    .join("") ||
  `
    <div class="muted">
      No files reported yet.
      The Agent populates this
      collection after file operations.
    </div>
  `;
```

} catch (error) {
console.error(
"loadFiles error:",
error
);
}
}

function formatBytes(n) {
n = Number(n || 0);

if (n < 1024) {
return n + " B";
}

if (n < 1048576) {
return (
(n / 1024).toFixed(1) +
" KB"
);
}

return (
(n / 1048576).toFixed(1) +
" MB"
);
}

function openFile(p) {
filePath =
"/" + safePath(p);

loadFiles();
}

async function deleteFile(p) {
if (
!confirm(
"Delete " + p + "?"
)
) {
return;
}

const now = Date.now();

await db.collection("jobs").add({
owner: currentUser.uid,
serverId: activeServer.id,
type: "file-delete",
path: safePath(p),
status: "queued",
createdAt: now,
notBeforeAt: now + 10000
});
}

async function uploadFile() {
const file =
$("fileUpload").files[0];

if (!file || !activeServer) {
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

await fileJob(
"file-upload",
{
path: safePath(
(
filePath === "/"
? ""
: filePath + "/"
) + file.name
),
data: base64,
size: file.size
}
);

alert(
"Upload queued."
);
}

// ============================================================
// MODRINTH
// ============================================================

const MODRINTH_LOADERS = [
"paper",
"spigot",
"bukkit",
"purpur",
"folia"
];

async function modrinthFetch(
url
) {
const response =
await fetch(
url,
{
method: "GET",
headers:
MODRINTH_HEADERS
}
);

if (!response.ok) {
let body = "";

```
try {
  body =
    await response.text();
} catch {}

throw new Error(
  `Modrinth HTTP ${response.status}${
    body
      ? ": " + body.slice(0, 300)
      : ""
  }`
);
```

}

return response.json();
}

/**

* Search Modrinth for plugin projects.
*
* Important:
* Modrinth search facets use:
*
* project_type:plugin
* versions:<minecraft version>
*
* The URL MUST be a normal URL, not a Markdown link.
  */
  async function searchPlugins() {
  const query =
  $("pluginSearch")
  .value
  .trim();

if (!query || !activeServer) {
return;
}

const results =
$("pluginResults");

results.innerHTML =
`       <div class="muted">
        Searching compatible Paper plugins…       </div>
    `;

try {
const minecraftVersion =
String(
activeServer.version || ""
).trim();

```
if (!minecraftVersion) {
  throw new Error(
    "This server has no Minecraft version."
  );
}

const facets = JSON.stringify([
  ["project_type:plugin"],
  [`versions:${minecraftVersion}`]
]);

const params =
  new URLSearchParams();

params.set(
  "query",
  query
);

params.set(
  "limit",
  "20"
);

params.set(
  "facets",
  facets
);

const url =
  `${MODRINTH_API}/search?${params.toString()}`;

console.log(
  "Modrinth search:",
  url
);

const data =
  await modrinthFetch(
    url
  );

const hits =
  Array.isArray(data.hits)
    ? data.hits
    : [];

const plugins =
  hits.filter(
    plugin =>
      String(
        plugin.project_type ||
        ""
      ).toLowerCase() ===
      "plugin"
  );

if (!plugins.length) {
  results.innerHTML =
    `
      <div class="muted">
        No compatible plugin projects found for Minecraft
        ${esc(minecraftVersion)}.
      </div>
    `;

  return;
}

results.innerHTML =
  plugins
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
              plugin.title ||
              plugin.slug ||
              "Unknown plugin"
            )}
          </h4>

          <div class="muted">
            ${esc(
              plugin.author ||
              "Unknown"
            )}
            •
            ${Number(
              plugin.downloads ||
              0
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
            onclick="installPlugin('${esc(
              plugin.project_id ||
              plugin.slug
            )}')"
            class="primary"
          >
            Install
          </button>

        </div>
      `
    )
    .join("");
```

} catch (error) {
console.error(
"Modrinth search error:",
error
);

```
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
```

}
}

/**

* Get the best compatible Modrinth plugin version.
*
* This also matches the server-side Agent logic.
  */
  async function getModrinthPluginVersion(
  projectId,
  minecraftVersion
  ) {
  projectId =
  String(projectId || "")
  .trim();

minecraftVersion =
String(minecraftVersion || "")
.trim();

if (
!projectId ||
!minecraftVersion
) {
throw new Error(
"Plugin project and Minecraft version are required."
);
}

const params =
new URLSearchParams();

params.set(
"loaders",
JSON.stringify(
MODRINTH_LOADERS
)
);

params.set(
"game_versions",
JSON.stringify([
minecraftVersion
])
);

params.set(
"include_changelog",
"false"
);

const url =
`${MODRINTH_API}/project/${encodeURIComponent(
      projectId
    )}/version?${params.toString()}`;

const versions =
await modrinthFetch(url);

if (
!Array.isArray(versions) ||
versions.length === 0
) {
throw new Error(
`No compatible plugin version was found for Minecraft ${minecraftVersion}.`
);
}

const compatible =
versions.filter(version => {
if (
!version ||
!Array.isArray(
version.game_versions
)
) {
return false;
}

```
  const exactMinecraft =
    version.game_versions
      .map(String)
      .includes(
        minecraftVersion
      );

  const loaderOK =
    Array.isArray(
      version.loaders
    ) &&
    version.loaders.some(
      loader =>
        MODRINTH_LOADERS.includes(
          String(
            loader
          ).toLowerCase()
        )
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

  const statusOK =
    !version.status ||
    version.status ===
      "listed";

  return (
    exactMinecraft &&
    loaderOK &&
    typeOK &&
    statusOK
  );
});
```

if (!compatible.length) {
throw new Error(
`No compatible Paper plugin version was found for Minecraft ${minecraftVersion}.`
);
}

compatible.sort(
(a, b) => {
const aDate =
a.date_published
? Date.parse(
a.date_published
)
: 0;

```
  const bDate =
    b.date_published
      ? Date.parse(
          b.date_published
        )
      : 0;

  return bDate - aDate;
}
```

);

const selected =
compatible[0];

const jar =
(selected.files || [])
.find(
file =>
String(
file.filename || ""
)
.toLowerCase()
.endsWith(".jar") &&
(
file.primary === true ||
file.primary === undefined
)
) ||
(selected.files || [])
.find(
file =>
String(
file.filename || ""
)
.toLowerCase()
.endsWith(".jar")
);

if (!jar?.url) {
throw new Error(
"No plugin JAR was found."
);
}

return {
projectId:
projectId,

```
versionId:
  selected.id,

versionNumber:
  selected.version_number,

filename:
  jar.filename,

url:
  jar.url
```

};
}

/**

* Queue plugin installation.
*
* The Agent will re-check Modrinth itself,
* so the download URL is NOT trusted from the browser.
  */
  async function installPlugin(
  projectId
  ) {
  if (
  !activeServer ||
  !currentUser
  ) {
  return;
  }

try {
const minecraftVersion =
String(
activeServer.version || ""
).trim();

```
if (!minecraftVersion) {
  return alert(
    "This server has no Minecraft version."
  );
}

const plugin =
  await getModrinthPluginVersion(
    projectId,
    minecraftVersion
  );

const now =
  Date.now();

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
      plugin.projectId,

    versionId:
      plugin.versionId,

    versionNumber:
      plugin.versionNumber,

    filename:
      plugin.filename,

    status:
      "queued",

    createdAt:
      now,

    notBeforeAt:
      now + 10000
  });

alert(
  `Compatible plugin ${plugin.versionNumber} queued for installation.`
);
```

} catch (error) {
console.error(
"Plugin install error:",
error
);

```
alert(
  error.message ||
  String(error)
);
```

}
}

// ============================================================
// DOMAINS
// ============================================================

async function loadDomains() {
if (!activeServer) return;

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

```
    return `
      <div class="queue-item">
        🌐
        ${esc(data.domain)}
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
```

}

async function addDomain() {
const domain =
$("domainInput")
.value
.trim()
.toLowerCase();

if (
!/^([a-z0-9-]+.)+[a-z]{2,63}$/.test(
domain
)
) {
return alert(
"Enter a valid domain."
);
}

if (!activeServer) {
return;
}

const ref =
db
.collection("customDomains")
.doc();

const now =
Date.now();

await ref.set({
owner:
currentUser.uid,

```
serverId:
  activeServer.id,

domain,

status:
  "pending",

verified:
  false,

createdAt:
  now
```

});

await db
.collection("jobs")
.add({
owner:
currentUser.uid,

```
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
```

$("domainInput").value = "";

loadDomains();
}

// ============================================================
// SUPPORT / TICKETS
// ============================================================

async function submitTicket() {
if (!currentUser) return;

const subject =
$("ticketSubject")
.value
.trim();

const message =
$("ticketMessage")
.value
.trim();

const needs =
$("ticketNeedsVerification")
.checked;

const domain =
$("ticketDomain")
.value
.trim()
.toLowerCase();

if (!subject || !message) {
return alert(
"Fill in subject and message."
);
}

if (
needs &&
!/^([a-z0-9-]+.)+[a-z]{2,63}$/.test(
domain
)
) {
return alert(
"Enter a valid domain."
);
}

const ticket =
db.collection("tickets")
.doc();

const now =
Date.now();

let verificationId =
null;

let token =
null;

if (needs) {
verificationId =
db
.collection(
"domainVerifications"
)
.doc()
.id;

```
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
```

}

await ticket.set({
owner:
currentUser.uid,

```
ownerEmail:
  currentUser.email || "",

subject,

message,

domain:
  domain || null,

requiresDomainVerification:
  needs,

verificationId,

status:
  needs
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
```

});

$("ticketResult").innerHTML =
needs
? ` <div class="notice">
Ticket created.

```
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
```

loadTickets();
}

async function loadTickets() {
if (!currentUser) return;

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
const data =
doc.data();

```
    return `
      <div class="ticket-item">
        <b>
          ${esc(
            data.subject
          )}
        </b>

        —
        <span class="pill">
          ${esc(
            data.status
          )}
        </span>

        <div class="muted">
          ${esc(
            data.message
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
```

}

// ============================================================
// ADMIN
// ============================================================

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
.classList.add("active");

loadAdminServers();
loadAdminAlerts();
}

async function loadAdminServers() {
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
const query =
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
.includes(query)
)
);

$("adminServers").innerHTML =
`       <div class="admin-row">         <b>Server</b>         <b>Owner</b>         <b>Status</b>         <b>RAM</b>       </div>
    ` +
filtered
.map(
server => ` <div class="admin-row"> <span>
${esc(
server.name ||
server.id
)} </span>

```
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
          )} MB
        </span>
      </div>
    `
  )
  .join("");
```

}

async function loadAdminAlerts() {
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
const data =
doc.data();

```
    return `
      <div class="queue-item">
        ⚠️

        <b>
          ${esc(
            data.serverName ||
            data.serverId
          )}
        </b>

        <div>
          ${esc(
            data.reason ||
            "Potential ToS issue"
          )}
        </div>

        <small class="muted">
          ${esc(
            data.severity ||
            "review"
          )}
          •
          ${new Date(
            data.createdAt ||
            0
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
```

}
