import express from "express";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

import { loadReplicaConfig } from "../../shared/src/config.js";
import { RaftNode } from "../../shared/src/raftNode.js";

const config = loadReplicaConfig({
  nodeId: "replica2",
  port: 5002,
  peers: ["http://localhost:5001", "http://localhost:5003"]
});

const app = express();
app.use(express.json());

const publicPath = path.resolve(process.cwd(), "frontend/public");
const distPath = path.resolve(process.cwd(), "dist");

app.use(express.static(publicPath));
app.use("/dist", express.static(distPath));

const raftNode = new RaftNode(config);
raftNode.start();
setTimeout(async () => {
  try {
    const snapshot = raftNode.getSnapshot();

    if (snapshot.state !== "leader" && snapshot.leaderId) {
      const leaderPort =
        snapshot.leaderId === "replica1" ? 5001 :
        snapshot.leaderId === "replica2" ? 5002 : 5003;

      const resp = await fetch(`http://localhost:${leaderPort}/log`);
      const data = await resp.json();

      console.log("Syncing full log from leader");

      // ✅ rebuild backend log
      for (const entry of data.entries) {
        try {
          raftNode["log"].append(entry);
        } catch {}
      }

      // 🔥 ADD THIS (IMPORTANT)
      broadcast({
        type: "full-sync",
        data: data.entries
      });
    }

  } catch (err) {
    console.error("Initial sync failed", err);
  }
}, 1000);

const server = http.createServer(app);

const wss = new WebSocketServer({ server });
const clients = new Set<WebSocket>();

const leaderPortMap: any = {
  replica1: 5001,
  replica2: 5002,
  replica3: 5003
};

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.on("message", async (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === "stroke") {
      let entry;
      const snapshot = raftNode.getSnapshot();

      if (snapshot.state === "leader") {
        entry = await raftNode.replicateStroke(msg.data);
      } else {
        const leader = snapshot.leaderId;
        if (!leader) return;

        const leaderPort = leaderPortMap[leader];

        const resp = await fetch(`http://localhost:${leaderPort}/stroke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg.data)
        });

        entry = (await resp.json()).entry;
      }

      broadcast({ type: "stroke-committed", data: entry });
    }
  });

  ws.on("close", () => clients.delete(ws));
});

function broadcast(msg: any) {
  const payload = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

app.get("/status", (_req, res) => {
  res.json(raftNode.getSnapshot());
});

app.get("/log", (_req, res) => {
  res.json({ entries: raftNode.getCommittedLog() });
});

app.post("/stroke", async (req, res) => {
  try {
    const snapshot = raftNode.getSnapshot();
    let entry;

    if (snapshot.state === "leader") {
      entry = await raftNode.replicateStroke(req.body);
    } else {
      const leader = snapshot.leaderId;
      if (!leader) return res.status(503).json({ error: "No leader" });

      const leaderPort = leaderPortMap[leader];

      const resp = await fetch(`http://localhost:${leaderPort}/stroke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
      });

      entry = (await resp.json()).entry;
    }

    broadcast({ type: "stroke-committed", data: entry });
    res.json({ entry });

  } catch {
    res.status(500).json({ error: "Replication failed" });
  }
});

/* RAFT ROUTES */
app.post("/request-vote", async (req, res) => res.json(await raftNode.handleRequestVote(req.body)));
app.post("/heartbeat", async (req, res) => res.json(await raftNode.handleHeartbeat(req.body)));
app.post("/append-entries", async (req, res) => {
  const result = await raftNode.handleAppendEntries(req.body);

  // 🔥 NEW: broadcast entries to local clients
  if (req.body.entries && req.body.entries.length > 0) {
    for (const entry of req.body.entries) {
      broadcast({
        type: "stroke-committed",
        data: entry
      });
    }
  }

  res.json(result);
});
app.post("/sync-log", async (req, res) => res.json(await raftNode.handleSyncLog(req.body)));

server.listen(config.port, () => {
  console.log(`[${config.nodeId}] running on ${config.port}`);
});