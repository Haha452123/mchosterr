"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");
const { spawn, execFile } = require("child_process");


// ============================================================
// CONFIG
// ============================================================

const CONFIG = {

  // Your Firebase project
  projectId: "mchost-9516b",

  // Local storage
  rootDir: "C:\\LocalNode",

  serversDir: "C:\\LocalNode\\servers",

  logsDir: "C:\\LocalNode\\logs",

  // Public hostname users will see.
  //
  // IMPORTANT:
  // This does NOT automatically create DNS or ports.
  //
  publicHost: "freemchosting.vexr.dev",

  // Starting port.
  //
  // The agent searches for an unused port beginning here.
  firstPort: 25565,

  // Maximum port it will automatically allocate.
  lastPort: 25664,

  // Your normal hosting limits.
  maxServersPerUser: 3,

  defaultRamMB: 3072,

  paidRamMB: 4096,

  // How often to refresh the file index.
  fileIndexInterval: 30000,

  // How often to look for jobs.
  jobPollInterval: 3000

};


// ============================================================
// FIREBASE ADMIN
// ============================================================
//
// Put service-account.json beside this file:
//
// C:\LocalNode\service-account.json
//
// NEVER upload this file to GitHub.
// NEVER put it in your website.
// NEVER give it to users.
// ============================================================

const serviceAccountPath =
  path.join(
    __dirname,
    "service-account.json"
  );


if (!fs.existsSync(serviceAccountPath)) {

  console.error(
    "\nERROR: service-account.json was not found.\n\n" +
    "Put your Firebase Admin SDK service-account JSON here:\n" +
    serviceAccountPath +
    "\n"
  );

  process.exit(1);

}


const serviceAccount =
  require(serviceAccountPath);


admin.initializeApp({

  credential:
    admin.credential.cert(
      serviceAccount
    ),

  projectId:
    CONFIG.projectId

});


const db =
  admin.firestore();


// ============================================================
// LOCAL STATE
// ============================================================

const processes =
  new Map();

const jobLocks =
  new Set();


// ============================================================
// DIRECTORIES
// ============================================================

async function ensureDirectories() {

  await fsp.mkdir(
    CONFIG.rootDir,
    { recursive: true }
  );

  await fsp.mkdir(
    CONFIG.serversDir,
    { recursive: true }
  );

  await fsp.mkdir(
    CONFIG.logsDir,
    { recursive: true }
  );

}


ensureDirectories()
  .catch(error => {

    console.error(
      "Directory initialization failed:",
      error
    );

    process.exit(1);

  });


// ============================================================
// LOGGING
// ============================================================

function log(...args) {

  console.log(
    new Date().toISOString(),
    ...args
  );

}


// ============================================================
// FIRESTORE HELPERS
// ============================================================

async function updateServer(
  serverId,
  data
) {

  await db
    .collection("servers")
    .doc(serverId)
    .set(
      data,
      { merge: true }
    );

}


async function updateJob(
  jobId,
  data
) {

  await db
    .collection("jobs")
    .doc(jobId)
    .set(
      data,
      { merge: true }
    );

}


// ============================================================
// SAFE PATH
// ============================================================

function serverDirectory(serverId) {

  // Firestore IDs normally contain safe characters,
  // but don't trust external input.

  const safe =
    String(serverId)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

  return path.join(
    CONFIG.serversDir,
    safe
  );

}


// ============================================================
// DOWNLOAD
// ============================================================

function downloadFile(
  url,
  destination
) {

  return new Promise(
    (resolve, reject) => {

      const client =
        url.startsWith("https:")
          ? https
          : http;


      const request =
        client.get(
          url,
          response => {

            // Redirect

            if (
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {

              response.resume();

              downloadFile(
                response.headers.location,
                destination
              )
                .then(resolve)
                .catch(reject);

              return;

            }


            if (
              response.statusCode !== 200
            ) {

              response.resume();

              reject(
                new Error(
                  `Download failed: HTTP ${response.statusCode}`
                )
              );

              return;

            }


            const file =
              fs.createWriteStream(
                destination
              );


            response.pipe(file);


            file.on(
              "finish",
              () => {

                file.close(
                  () => resolve()
                );

              }
            );


            file.on(
              "error",
              error => {

                file.close(
                  () => {}
                );

                reject(error);

              }
            );

          }
        );


      request.on(
        "error",
        reject
      );

    }
  );

}


// ============================================================
// GET MINECRAFT SERVER URL
// ============================================================

async function getMinecraftServerUrl(
  version
) {

  const manifestUrl =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";


  const manifest =
    await fetchJson(
      manifestUrl
    );


  const versionInfo =
    manifest.versions.find(
      item =>
        item.id === version
    );


  if (!versionInfo) {

    throw new Error(
      `Minecraft version ${version} was not found.`
    );

  }


  const metadata =
    await fetchJson(
      versionInfo.url
    );


  const server =
    metadata.downloads &&
    metadata.downloads.server;


  if (
    !server ||
    !server.url
  ) {

    throw new Error(
      `No official server download is available for ${version}.`
    );

  }


  return server.url;

}


// ============================================================
// JSON DOWNLOAD
// ============================================================

function fetchJson(url) {

  return new Promise(
    (resolve, reject) => {

      const client =
        url.startsWith("https:")
          ? https
          : http;


      client.get(
        url,
        response => {

          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {

            response.resume();

            fetchJson(
              response.headers.location
            )
              .then(resolve)
              .catch(reject);

            return;

          }


          if (
            response.statusCode !== 200
          ) {

            response.resume();

            reject(
              new Error(
                `HTTP ${response.statusCode}`
              )
            );

            return;

          }


          let data = "";


          response.setEncoding(
            "utf8"
          );


          response.on(
            "data",
            chunk => {
              data += chunk;
            }
          );


          response.on(
            "end",
            () => {

              try {

                resolve(
                  JSON.parse(data)
                );

              } catch (error) {

                reject(error);

              }

            }
          );

        }
      )
      .on(
        "error",
        reject
      );

    }
  );

}


// ============================================================
// FIND JAVA
// ============================================================

function findJava() {

  return new Promise(
    resolve => {

      execFile(
        "java",
        [
          "-version"
        ],
        {
          windowsHide: true
        },
        error => {

          if (!error) {

            resolve("java");

            return;

          }


          const candidates = [

            "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe",

            "C:\\Program Files\\Java\\jdk-21.0.1\\bin\\java.exe",

            "C:\\Program Files\\Java\\jdk-21.0.2\\bin\\java.exe",

            "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe",

            "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.1\\bin\\java.exe",

            "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.2\\bin\\java.exe"

          ];


          for (
            const candidate of candidates
          ) {

            if (
              fs.existsSync(candidate)
            ) {

              resolve(candidate);

              return;

            }

          }


          resolve(null);

        }
      );

    }
  );

}


// ============================================================
// FIND FREE PORT
// ============================================================

function isPortFree(
  port
) {

  return new Promise(
    resolve => {

      const net =
        require("net");


      const server =
        net.createServer();


      server.once(
        "error",
        () => {

          resolve(false);

        }
      );


      server.once(
        "listening",
        () => {

          server.close(
            () => resolve(true)
          );

        }
      );


      server.listen(
        port,
        "0.0.0.0"
      );

    }
  );

}


async function findFreePort() {

  for (
    let port = CONFIG.firstPort;
    port <= CONFIG.lastPort;
    port++
  ) {

    const free =
      await isPortFree(port);


    if (free) {

      return port;

    }

  }


  throw new Error(
    "No free Minecraft ports are available."
  );

}


// ============================================================
// GET USER LIMITS
// ============================================================

async function getUserProfile(
  uid
) {

  const snap =
    await db
      .collection("users")
      .doc(uid)
      .get();


  if (!snap.exists) {

    return {

      ramLimit:
        CONFIG.defaultRamMB,

      maxServers:
        CONFIG.maxServersPerUser

    };

  }


  const data =
    snap.data();


  return {

    ramLimit:
      Number(
        data.ramLimit ||
        CONFIG.defaultRamMB
      ),

    maxServers:
      Number(
        data.maxServers ||
        CONFIG.maxServersPerUser
      )

  };

}


// ============================================================
// GET USER SERVERS
// ============================================================

async function getUserServers(
  uid
) {

  const snap =
    await db
      .collection("servers")
      .where(
        "owner",
        "==",
        uid
      )
      .get();


  return snap.docs.map(
    doc => ({
      id: doc.id,
      ...doc.data()
    })
  );

}


// ============================================================
// VALIDATE RESOURCES
// ============================================================

async function validateServerResources(
  job,
  requestedRam
) {

  const profile =
    await getUserProfile(
      job.owner
    );


  const servers =
    await getUserServers(
      job.owner
    );


  const active =
    servers.filter(
      server =>
        server.status === "online" ||
        server.status === "starting" ||
        server.status === "provisioning"
    );


  if (
    active.length >=
    profile.maxServers
  ) {

    throw new Error(
      `Server limit reached (${profile.maxServers}).`
    );

  }


  const usedRam =
    active.reduce(
      (total, server) =>
        total +
        Number(server.ram || 0),
      0
    );


  if (
    usedRam + requestedRam >
    profile.ramLimit
  ) {

    throw new Error(
      `RAM limit exceeded. ` +
      `Available: ${
        Math.max(
          0,
          profile.ramLimit - usedRam
        )
      } MB`
    );

  }

}


// ============================================================
// EULA
// ============================================================

async function ensureEula(
  dir
) {

  const eula =
    path.join(
      dir,
      "eula.txt"
    );


  if (
    !fs.existsSync(eula)
  ) {

    await fsp.writeFile(
      eula,
      "eula=true\r\n",
      "utf8"
    );

  }

}


// ============================================================
// PROVISION
// ============================================================

async function provisionServer(
  jobId,
  job
) {

  const serverId =
    job.serverId;


  if (!serverId) {

    throw new Error(
      "Job has no serverId."
    );

  }


  const serverRef =
    db
      .collection("servers")
      .doc(serverId);


  const serverSnap =
    await serverRef.get();


  if (!serverSnap.exists) {

    throw new Error(
      "Server document does not exist."
    );

  }


  const server =
    serverSnap.data();


  const ram =
    Number(
      server.ram ||
      CONFIG.defaultRamMB
    );


  const version =
    server.version ||
    "1.21.11";


  // Check limits again on the trusted agent.

  await validateServerResources(
    job,
    ram
  );


  const dir =
    serverDirectory(
      serverId
    );


  await fsp.mkdir(
    dir,
    {
      recursive: true
    }
  );


  await updateServer(
    serverId,
    {

      status:
        "provisioning",

      console:
        "Preparing server…",

      updatedAt:
        Date.now()

    }
  );


  log(
    `Provisioning ${serverId} (${version}, ${ram} MB)`
  );


  // Find Minecraft server download.

  const url =
    await getMinecraftServerUrl(
      version
    );


  const jar =
    path.join(
      dir,
      "server.jar"
    );


  if (
    !fs.existsSync(jar)
  ) {

    await updateServer(
      serverId,
      {

        console:
          "Downloading Minecraft server…"

      }
    );


    await downloadFile(
      url,
      jar
    );

  }


  await ensureEula(
    dir
  );


  // Allocate port.

  const port =
    server.port ||
    await findFreePort();


  await updateServer(
    serverId,
    {

      port,

      address:
        `${CONFIG.publicHost}:${port}`,

      status:
        "offline",

      console:
        "Server provisioned. Ready to start.",

      updatedAt:
        Date.now()

    }
  );


  // Index files.

  await indexFiles(
    serverId,
    job.owner,
    dir
  );


  return {

    port,
    dir

  };

}


// ============================================================
// START SERVER
// ============================================================

async function startServer(
  jobId,
  job
) {

  const serverId =
    job.serverId;


  const serverRef =
    db
      .collection("servers")
      .doc(serverId);


  const snap =
    await serverRef.get();


  if (!snap.exists) {

    throw new Error(
      "Server not found."
    );

  }


  const server =
    snap.data();


  // Already running.

  if (
    processes.has(serverId)
  ) {

    await updateServer(
      serverId,
      {

        status:
          "online"

      }
    );

    return;

  }


  const dir =
    serverDirectory(
      serverId
    );


  const jar =
    path.join(
      dir,
      "server.jar"
    );


  if (
    !fs.existsSync(jar)
  ) {

    throw new Error(
      "server.jar is missing. Provision the server first."
    );

  }


  const java =
    await findJava();


  if (!java) {

    throw new Error(
      "Java was not found. Install a compatible Java runtime and add java.exe to PATH."
    );

  }


  const ram =
    Number(
      server.ram ||
      CONFIG.defaultRamMB
    );


  const port =
    Number(
      server.port ||
      await findFreePort()
    );


  await updateServer(
    serverId,
    {

      status:
        "starting",

      port,

      address:
        `${CONFIG.publicHost}:${port}`,

      console:
        "Starting Minecraft…",

      updatedAt:
        Date.now()

    }
  );


  await ensureEula(
    dir
  );


  // Make sure server.properties has the allocated port.

  await configureServerProperties(
    dir,
    port
  );


  const args = [

    `-Xms${ram}M`,

    `-Xmx${ram}M`,

    "-jar",

    "server.jar",

    "nogui"

  ];


  log(
    `Starting ${serverId} using ${java}`
  );


  const child =
    spawn(
      java,
      args,
      {

        cwd:
          dir,

        windowsHide:
          true,

        stdio:
          [
            "pipe",
            "pipe",
            "pipe"
          ]

      }
    );


  const state = {

    process:
      child,

    startedAt:
      Date.now(),

    consoleBuffer:
      ""

  };


  processes.set(
    serverId,
    state
  );


  function handleOutput(
    chunk
  ) {

    const text =
      chunk.toString();


    process.stdout.write(
      `[${serverId}] ${text}`
    );


    state.consoleBuffer +=
      text;


    // Keep the database document reasonably small.

    if (
      state.consoleBuffer.length >
      12000
    ) {

      state.consoleBuffer =
        state.consoleBuffer.slice(
          -12000
        );

    }


    updateServer(
      serverId,
      {

        console:
          state.consoleBuffer,

        updatedAt:
          Date.now()

      }
    ).catch(
      console.error
    );


    if (
      /Done \([0-9.]+s\)! For help, type "help"/i
        .test(text)
    ) {

      updateServer(
        serverId,
        {

          status:
            "online",

          console:
            state.consoleBuffer,

          updatedAt:
            Date.now()

        }
      ).catch(
        console.error
      );

    }

  }


  child.stdout.on(
    "data",
    handleOutput
  );


  child.stderr.on(
    "data",
    handleOutput
  );


  child.on(
    "error",
    error => {

      log(
        `Minecraft process error ${serverId}:`,
        error
      );


      processes.delete(
        serverId
      );


      updateServer(
        serverId,
        {

          status:
            "error",

          console:
            `${state.consoleBuffer}\n${error.message}`,

          updatedAt:
            Date.now()

        }
      ).catch(
        console.error
      );

    }
  );


  child.on(
    "close",
    code => {

      log(
        `Minecraft ${serverId} exited with code ${code}`
      );


      processes.delete(
        serverId
      );


      updateServer(
        serverId,
        {

          status:
            "offline",

          console:
            `${state.consoleBuffer}\nProcess exited with code ${code}.`,

          updatedAt:
            Date.now()

        }
      ).catch(
        console.error
      );

    }
  );


  // Give Minecraft a little time to start.

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        3000
      )
  );

}


// ============================================================
// SERVER.PROPERTIES
// ============================================================

async function configureServerProperties(
  dir,
  port
) {

  const file =
    path.join(
      dir,
      "server.properties"
    );


  let content = "";


  if (
    fs.existsSync(file)
  ) {

    content =
      await fsp.readFile(
        file,
        "utf8"
      );

  }


  const lines =
    content
      .split(/\r?\n/)
      .filter(Boolean);


  let foundPort =
    false;


  const output =
    lines.map(
      line => {

        if (
          line.startsWith(
            "server-port="
          )
        ) {

          foundPort =
            true;

          return `server-port=${port}`;

        }


        return line;

      }
    );


  if (!foundPort) {

    output.push(
      `server-port=${port}`
    );

  }


  await fsp.writeFile(
    file,
    output.join("\r\n") +
      "\r\n",
    "utf8"
  );

}


// ============================================================
// STOP SERVER
// ============================================================

async function stopServer(
  jobId,
  job
) {

  const serverId =
    job.serverId;


  const state =
    processes.get(
      serverId
    );


  if (!state) {

    await updateServer(
      serverId,
      {

        status:
          "offline",

        updatedAt:
          Date.now()

      }
    );

    return;

  }


  await updateServer(
    serverId,
    {

      status:
        "stopping",

      updatedAt:
        Date.now()

    }
  );


  try {

    // Minecraft command.

    state.process.stdin.write(
      "stop\n"
    );

  } catch {

    // Ignore stdin errors.

  }


  // Give Minecraft time to save.

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        10000
      )
  );


  if (
    processes.has(serverId)
  ) {

    try {

      state.process.kill();

    } catch {

      // Ignore.

    }

  }


  processes.delete(
    serverId
  );


  await updateServer(
    serverId,
    {

      status:
        "offline",

      updatedAt:
        Date.now()

    }
  );

}


// ============================================================
// RESTART
// ============================================================

async function restartServer(
  jobId,
  job
) {

  const serverId =
    job.serverId;


  await stopServer(
    jobId,
    job
  );


  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        2000
      )
  );


  await startServer(
    jobId,
    job
  );

}


// ============================================================
// FILE INDEX
// ============================================================

async function indexFiles(
  serverId,
  owner,
  dir
) {

  if (
    !fs.existsSync(dir)
  ) {

    return;

  }


  const files =
    await walkFiles(
      dir
    );


  const batch =
    db.batch();


  // Delete/rewriteing individual records is intentionally
  // limited to files we currently discover.

  for (
    const file of files
  ) {

    const relative =
      path
        .relative(
          dir,
          file.path
        )
        .replace(
          /\\/g,
          "/"
        );


    const fileId =
      `${owner}_${serverId}_${relative}`
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );


    const ref =
      db
        .collection(
          "serverFiles"
        )
        .doc(fileId);


    batch.set(
      ref,
      {

        owner,

        serverId,

        path:
          relative,

        type:
          "file",

        size:
          file.size,

        updatedAt:
          Date.now()

      },
      {
        merge:
          true
      }
    );

  }


  if (
    files.length
  ) {

    await batch.commit();

  }

}


// ============================================================
// WALK FILES
// ============================================================

async function walkFiles(
  dir
) {

  const result = [];


  async function walk(
    current
  ) {

    const entries =
      await fsp.readdir(
        current,
        {
          withFileTypes:
            true
        }
      );


    for (
      const entry of entries
    ) {

      // Don't index huge/world internals unnecessarily.

      if (
        entry.name === "logs"
      ) {

        continue;

      }


      const full =
        path.join(
          current,
          entry.name
        );


      if (
        entry.isDirectory()
      ) {

        await walk(
          full
        );

      } else {

        try {

          const stat =
            await fsp.stat(
              full
            );


          result.push({

            path:
              full,

            size:
              stat.size

          });

        } catch {

          // File may disappear while walking.

        }

      }

    }

  }


  await walk(
    dir
  );


  return result;

}


// ============================================================
// PROCESS JOB
// ============================================================

async function processJob(
  jobId,
  job
) {

  if (
    jobLocks.has(jobId)
  ) {

    return;

  }


  jobLocks.add(
    jobId
  );


  try {

    // --------------------------------------------------------
    // Claim the job
    // --------------------------------------------------------

    await updateJob(
      jobId,
      {

        status:
          "processing",

        processingAt:
          Date.now(),

        agent:
          os.hostname()

      }
    );


    log(
      `Processing job ${jobId}: ${job.type}`
    );


    // --------------------------------------------------------
    // Execute
    // --------------------------------------------------------

    switch (
      job.type
    ) {

      case "provision":

        await provisionServer(
          jobId,
          job
        );

        break;


      case "start":

        await startServer(
          jobId,
          job
        );

        break;


      case "stop":

        await stopServer(
          jobId,
          job
        );

        break;


      case "restart":

        await restartServer(
          jobId,
          job
        );

        break;


      default:

        throw new Error(
          `Unknown job type: ${job.type}`
        );

    }


    // --------------------------------------------------------
    // Complete
    // --------------------------------------------------------

    await updateJob(
      jobId,
      {

        status:
          "completed",

        completedAt:
          Date.now()

      }
    );


    log(
      `Job completed: ${jobId}`
    );


  } catch (error) {

    console.error(
      `Job ${jobId} failed:`,
      error
    );


    await updateJob(
      jobId,
      {

        status:
          "failed",

        error:
          error.message,

        completedAt:
          Date.now()

      }
    );


    if (
      job.serverId
    ) {

      await updateServer(
        job.serverId,
        {

          status:
            "error",

          console:
            `Agent error: ${error.message}`,

          updatedAt:
            Date.now()

        }
      ).catch(
        console.error
      );

    }

  } finally {

    jobLocks.delete(
      jobId
    );

  }

}


// ============================================================
// FIRESTORE JOB LISTENER
// ============================================================

function startJobListener() {

  log(
    "Connecting to Firestore jobs..."
  );


  const queryRef =
    db
      .collection("jobs")
      .where(
        "status",
        "==",
        "pending"
      );


  queryRef.onSnapshot(
    snapshot => {

      log(
        `Firestore listener active. Pending jobs: ${snapshot.size}`
      );


      snapshot.docChanges()
        .forEach(
          change => {

            if (
              change.type !==
              "added"
            ) {

              return;

            }


            const jobId =
              change.doc.id;


            const job =
              change.doc.data();


            processJob(
              jobId,
              job
            );

          }
        );

    },

    error => {

      console.error(
        "Firestore listener error:",
        error
      );


      // Retry.

      setTimeout(
        startJobListener,
        5000
      );

    }
  );

}


// ============================================================
// PERIODIC FILE INDEX
// ============================================================

async function refreshRunningServerFiles() {

  for (
    const [
      serverId,
      state
    ] of processes
  ) {

    try {

      const snap =
        await db
          .collection("servers")
          .doc(serverId)
          .get();


      if (!snap.exists) {

        continue;

      }


      const server =
        snap.data();


      await indexFiles(
        serverId,
        server.owner,
        serverDirectory(
          serverId
        )
      );

    } catch (error) {

      console.error(
        "File indexing error:",
        error
      );

    }

  }

}


// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown() {

  log(
    "Agent shutting down..."
  );


  for (
    const [
      serverId,
      state
    ] of processes
  ) {

    try {

      state.process.stdin.write(
        "stop\n"
      );

    } catch {

      // Ignore.

    }

  }


  setTimeout(
    () => process.exit(0),
    10000
  );

}


process.on(
  "SIGINT",
  shutdown
);


process.on(
  "SIGTERM",
  shutdown
);


// ============================================================
// START
// ============================================================

(async () => {

  try {

    await ensureDirectories();


    const java =
      await findJava();


    if (java) {

      log(
        `Java detected: ${java}`
      );

    } else {

      console.warn(
        "WARNING: Java was not detected yet."
      );

      console.warn(
        "Minecraft servers will fail to start until Java is installed."
      );

    }


    log(
      "LocalNode Agent is ready."
    );


    log(
      `Machine: ${os.hostname()}`
    );


    log(
      `Server directory: ${CONFIG.serversDir}`
    );


    log(
      `Public host: ${CONFIG.publicHost}`
    );


    log(
      "Waiting for Firestore jobs..."
    );


    startJobListener();


    // Periodic file indexing.

    setInterval(
      refreshRunningServerFiles,
      CONFIG.fileIndexInterval
    );


  } catch (error) {

    console.error(
      "Agent startup failed:",
      error
    );

    process.exit(1);

  }

})();
