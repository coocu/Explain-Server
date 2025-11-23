// explain-server.js
// ================================
// Explain HTTP + SSE 서버
// 실시간 미러링 + 이미지 저장 + 고객관리
// ================================

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5785;

app.use(cors());
app.use(express.json({ limit: "20mb" }));  
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ---- public 폴더 서빙 ----
app.use(express.static(path.join(__dirname, "public")));

// ---- PDF/PNG 저장 폴더 ----
const PDF_DIR = path.join(__dirname, "pdfs");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

const upload = multer({ dest: PDF_DIR });

// ================================
// 1) 미러링 VIEW 페이지 라우터
// ================================
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "public/view.html"));
});

// ================================
// 2) 직원번호(empNo)별 SSE 채널
// ================================
const sseChannels = {}; // empNo → [res...]

app.get("/events/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  console.log("🔥 SSE CONNECT:", empNo);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.flushHeaders?.();

  if (!sseChannels[empNo]) sseChannels[empNo] = [];
  sseChannels[empNo].push(res);

  // heartbeat
  const interval = setInterval(() => {
    res.write(`event: ping\ndata: {}\n\n`);
  }, 30000);

  req.on("close", () => {
    console.log("❌ SSE CLOSE:", empNo);
    clearInterval(interval);
    sseChannels[empNo] = (sseChannels[empNo] || []).filter((r) => r !== res);
  });
});

// 메시지 브로드캐스트
function sendSSE(empNo, payload) {
  const list = sseChannels[empNo];
  if (!list) return;

  const msg =
    `event: message\n` +
    `data: ${JSON.stringify(payload)}\n\n`;

  list.forEach((res) => res.write(msg));
}

// ================================
// 3) Android → Server → Web 실시간 전달
// ================================
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  console.log("📡 /api/send:", empNo, type);

  if (!empNo || !type || !data) {
    return res.status(400).json({ ok: false, error: "필수값 누락" });
  }

  // base64 전송 시 data: "data:image/png;base64,...." 그대로 보내면 OK
  sendSSE(empNo, { type, data });

  res.json({ ok: true });
});

// ================================
// 4) 고객 관리 / PNG 업로드
// ================================
let customers = [];
let nextCustomerId = 1;

// 고객 등록
app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;

  if (!empNo || !name || !phone)
    return res.status(400).json({ ok: false, error: "필수 누락" });

  const entry = {
    id: nextCustomerId++,
    empNo,
    name,
    phone,
    datetime: datetime || new Date().toISOString(),
    pdfFileName: null,
  };
  customers.push(entry);

  res.json({ ok: true, customer: entry });
});

// 고객 조회
app.get("/api/customer/:empNo", (req, res) => {
  const list = customers.filter((c) => c.empNo === req.params.empNo);
  res.json({ ok: true, list });
});

// PNG 업로드 → pdfs 폴더 저장
app.post("/api/upload", upload.single("file"), (req, res) => {
  const id = parseInt(req.body.customerId);
  const file = req.file;

  const cust = customers.find((c) => c.id === id);
  if (!cust) return res.json({ ok: false, error: "고객 없음" });

  const safeName = cust.name.replace(/[^a-zA-Z0-9가-힣]/g, "");
  const safePhone = cust.phone.replace(/[^0-9]/g, "");
  const newName = `${safeName}_${safePhone}.png`;

  fs.renameSync(file.path, path.join(PDF_DIR, newName));
  cust.pdfFileName = newName;

  res.json({ ok: true, filename: newName });
});

// 관리자 페이지
app.get("/admin/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const list = customers.filter((c) => c.empNo === empNo);

  let html = `
  <html><body><h1>상담 이력 - ${empNo}</h1><ul>
  `;
  for (const c of list) {
    html += `<li>${c.name} (${c.phone}) - ${c.pdfFileName}</li>`;
  }
  html += `</ul></body></html>`;
  res.send(html);
});

// ================================
// 서버 시작
// ================================
server.listen(PORT, () => {
  console.log(`🚀 Explain Server Running on PORT: ${PORT}`);
});
