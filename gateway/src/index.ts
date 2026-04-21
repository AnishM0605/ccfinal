import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { StrokeEvent, ReplicaSnapshot } from "../../shared/src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

/* ────────────────────────────────────────────────────────────
   STATIC FILE SERVING
──────────────────────────────────────────────────────────── */
const publicPath = path.resolve(__dirname, "../../frontend/public");
const distPath = path.resolve(__dirname, "../../dist");

app.use(express.static(publicPath));
app.use("/dist", express.static(distPath));

/* ────────────────────────────────────────────────────────────
   🔥 FIX: LOCAL REPLICA CONFIG (NO DOCKER HOSTNAMES)
──────────────────────────────────────────────────────────── */
const REPLICAS: string[] = [
  "http://localhost:5001",
  "http://localhost:5002",
  "http://localhost:5003"
];

let currentLeaderUrl: string | null = null;

/* ────────────────────────────────────────────────────────────
   LEADER DISCOVERY
──────────────────────────────────────────────────────────── */
async function discoverLeader(): Promise<string | null> {
  for (const url of REPLICAS) {
    try {
      const resp = await fetch(`${url}/status`);
      if (resp.ok) {
        const status = (await resp.json()) as ReplicaSnapshot;
        if (status.state === "leader") {
          currentLeaderUrl = url;
          return url;
        }
      }
    } catch {
      // ignore unreachable replica
    }
  }
  return null;
}

// Initial discovery
(async () => {
  const leader = await discoverLeader();
  if (leader) {
    console.log(`[gateway] Initial leader found: ${leader}`);
  } else {
    console.log("[gateway] No leader found at startup");
  }
})();

/* ────────────────────────────────────────────────────────────
   HEALTH + API ROUTES
──────────────────────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "gateway",
    leader: currentLeaderUrl,
    replicas: REPLICAS
  });
});

app.get("/leader", async (_req, res) => {
  const leader = await discoverLeader();
  if (leader) {
    res.json({ leader });
  } else {
    res.status(503).json({ error: "No leader found in cluster" });
  }
});

app.get("/log", async (_req, res) => {
  const urls = currentLeaderUrl
    ? [currentLeaderUrl, ...REPLICAS]
    : REPLICAS;

  for (const url of urls) {
    try {
      const resp = await fetch(`${url}/log`);
      if (resp.ok) {
        const data = await resp.json();
        return res.json(data);
      }
    } catch {
      // try next replica
    }
  }

  res.status(503).json({ error: "Could not fetch log from cluster" });
});

/* ────────────────────────────────────────────────────────────
   WEBSOCKET SERVER
──────────────────────────────────────────────────────────── */
const port = Number(process.env.GATEWAY_PORT ?? 4000);
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[gateway] Client connected. Total: ${clients.size}`);

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "stroke") {
        const stroke = message.data as StrokeEvent;

        // Ensure we have leader
        let leader = currentLeaderUrl || (await discoverLeader());

        if (!leader) {
          ws.send(JSON.stringify({
            type: "error",
            message: "No leader available"
          }));
          return;
        }

        try {
          const resp = await fetch(`${leader}/stroke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stroke)
          });

          if (resp.ok) {
            const result = await resp.json();

            broadcast({
              type: "stroke-committed",
              data: result.entry
            });

          } else if (resp.status === 403) {
            // leader changed → retry
            console.log("[gateway] Leader changed, rediscovering...");
            currentLeaderUrl = null;

            const newLeader = await discoverLeader();
            if (!newLeader) return;

            const retryResp = await fetch(`${newLeader}/stroke`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(stroke)
            });

            if (retryResp.ok) {
              const result = await retryResp.json();

              broadcast({
                type: "stroke-committed",
                data: result.entry
              });
            }
          }

        } catch (err) {
          console.error("[gateway] Forward error:", err);
          currentLeaderUrl = null;
        }
      }

    } catch (err) {
      console.error("[gateway] Message parse error:", err);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[gateway] Client disconnected. Total: ${clients.size}`);
  });
});

/* ────────────────────────────────────────────────────────────
   BROADCAST
──────────────────────────────────────────────────────────── */
function broadcast(message: any) {
  const payload = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/* ────────────────────────────────────────────────────────────
   START SERVER
──────────────────────────────────────────────────────────── */
server.listen(port, () => {
  console.log(`[gateway] listening on http://localhost:${port}`);
});