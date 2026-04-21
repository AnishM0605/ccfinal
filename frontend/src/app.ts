interface StrokeEvent {
    id: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    color: string;
    width: number;
    timestamp: number;
}

const canvas = document.getElementById('drawing-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const widthPicker = document.getElementById('width-picker') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const eraserBtn = document.getElementById('eraser-btn') as HTMLButtonElement;
const connStatus = document.getElementById('conn-status') as HTMLElement;
const connStatePulse = document.getElementById('conn-state-pulse') as HTMLElement;
const leaderIdEl = document.getElementById('leader-id') as HTMLElement;
const clusterStatusEl = document.getElementById('cluster-status') as HTMLElement;

let isDrawing = false;
let isErasing = false;
let lastX = 0;
let lastY = 0;
let ws: WebSocket | null = null;

/* 🔥 IMPORTANT CHANGE — dynamic per replica */
const BASE_URL = window.location.origin;
const WS_URL = window.location.origin.replace("http", "ws");

/* ───────── CANVAS ───────── */
function resize() {
    const parent = canvas.parentElement!;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    syncLog();
}
window.addEventListener('resize', resize);
resize();

function stroke(s: StrokeEvent) {
    if (s.color === 'ERASER') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = s.color;
    }

    ctx.beginPath();
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
}

/* ───────── FETCH LOG FROM CURRENT NODE ───────── */
async function syncLog() {
    try {
        const resp = await fetch(`${BASE_URL}/log`);
        const data = await resp.json();

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        data.entries.forEach((entry: any) => {
            stroke(entry.stroke);
        });

        clusterStatusEl.innerText = `Synced (${data.entries.length})`;
    } catch (err) {
        console.error("Log sync failed", err);
    }
}

/* ───────── WEBSOCKET ───────── */
function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        connStatus.innerText = 'Connected';
        connStatePulse.className = 'pulse-dot connected';
        syncLog();
        updateClusterInfo();
    };

    ws.onclose = () => {
        connStatus.innerText = 'Disconnected';
        connStatePulse.className = 'pulse-dot disconnected';
        setTimeout(connect, 2000);
    };

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'stroke-committed') {
        stroke(message.data.stroke);
    }

    // 🔥 ADD THIS BLOCK
    if (message.type === 'full-sync') {
        // clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // redraw all strokes
        for (const entry of message.data) {
            stroke(entry.stroke);
        }
    }
};
}

/* ───────── CLUSTER INFO ───────── */
async function updateClusterInfo() {
    try {
        const resp = await fetch(`${BASE_URL}/status`);
        const data = await resp.json();

        leaderIdEl.innerText = data.leaderId || 'None';
        clusterStatusEl.innerText =
            `Connected to ${BASE_URL} | ${data.state}`;
    } catch {
        leaderIdEl.innerText = 'Error';
    }
}

connect();
setInterval(updateClusterInfo, 5000);

/* ───────── DRAWING ───────── */
canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    [lastX, lastY] = [e.offsetX, e.offsetY];
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;

    const currentX = e.offsetX;
    const currentY = e.offsetY;

    const s: StrokeEvent = {
        id: crypto.randomUUID(),
        x0: lastX,
        y0: lastY,
        x1: currentX,
        y1: currentY,
        color: isErasing ? 'ERASER' : colorPicker.value,
        width: isErasing ? parseInt(widthPicker.value) * 5 : parseInt(widthPicker.value),
        timestamp: Date.now()
    };

    stroke(s);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stroke', data: s }));
    }

    [lastX, lastY] = [currentX, currentY];
});

canvas.addEventListener('mouseup', () => isDrawing = false);
canvas.addEventListener('mouseout', () => isDrawing = false);

clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

eraserBtn.addEventListener('click', () => {
    isErasing = !isErasing;
    eraserBtn.innerText = isErasing ? 'Erase Active' : 'Use Eraser';
});