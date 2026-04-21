# Mini Raft Distributed Drawing Board

A real-time collaborative drawing application built on a **custom implementation of the Raft consensus algorithm**, ensuring **fault tolerance, leader election, and log replication** across multiple nodes.

---

## Overview

This project demonstrates how distributed systems maintain **consistency and partition tolerance** using Raft.

Users can draw on a canvas, and all strokes are:

* Replicated across multiple nodes
* Committed only after majority agreement
* Recovered after node failures

---

## Architecture

```
        ┌────────────┐
        │  Browser   │
        └─────┬──────┘
              │ WebSocket
        ┌─────▼──────┐
        │  Replica   │  ← Leader
        └─────┬──────┘
       ┌──────┼────────┐
       ▼      ▼        ▼
   Replica  Replica  Replica
   (Follower nodes)
```

---

## Key Features

### 🔹 Raft Consensus Implementation

* Leader election with randomized timeouts
* Heartbeat mechanism for leader liveness
* Majority-based commit rule
* Term-based state transitions

### 🔹 Log Replication

* Each stroke is stored as a **log entry**
* Entries are replicated to all peers
* Committed only after majority acknowledgment

### 🔹 Fault Tolerance

* Leader failure triggers automatic re-election
* Nodes can rejoin after failure
* Log recovery and synchronization implemented

### 🔹 Real-Time UI Sync

* WebSocket-based communication
* Canvas updates propagate across all replicas
* Full-state recovery on node restart

---

## Project Structure

```
.
├── frontend/        # UI (Canvas + WebSocket client)
├── replica1/        # Node 1
├── replica2/        # Node 2
├── replica3/        # Node 3
├── gateway/         # request router
├── shared/          # Raft logic + types
│   ├── raftNode.ts
│   ├── strokeLog.ts
│   └── config.ts
└── dist/            # Compiled JS output
```

---

## Technologies Used

* **TypeScript**
* **Node.js (Express + WebSocket)**
* **Custom Raft Implementation**
* **HTML5 Canvas**
* **CSS (Modern UI Dashboard)**
* **Docker**

---

## How to Run

### 1. Install dependencies

```bash
npm install
```

---

### 2. Compile TypeScript

```bash
npx tsc
```

---

### 3. Start replicas (in separate terminals)

```bash
npm run dev:replica1
npm run dev:replica2
npm run dev:replica3
```

---

### 4. Open in browser

```
http://localhost:5001
http://localhost:5002
http://localhost:5003
```

---

## Testing Scenarios

### Leader Election

* Start all nodes
* Observe one node becoming leader

---

### Leader Failure

* Kill leader process
* New leader is elected automatically

---

### Node Recovery

* Restart a stopped node
* Node syncs log and rejoins as follower

---

### Real-Time Sync

* Draw on any node
* Observe updates across all replicas

---

## Learning Outcomes

* Practical understanding of Raft consensus
* Handling distributed failures and recovery
* Designing real-time synchronized systems
* Debugging consistency issues in distributed environments

---

## Author

**Anish M**
**Anika P**
**Ankita Anand**
