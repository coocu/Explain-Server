// explain-server.js
// ================================
// Explain HTTP + SSE 서버 (로컬/클라우드 공용)
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

// CORS + JSON
app.use(cors());
app.use(express.json());

// ------------------------------------------
// 📌 public 폴더 정적 제공
// ------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------
// 📌 /view 라우트 추가 (고객용 화면)
// ------------------------------------------
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "view.html"));
});

// ------------------------------------------
// PDF/PNG 저장 폴더
// ------------------------------------------
const PDF_DIR = path.join(__dirname, "pdfs");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

// 업로드 (PNG)
const upload = multer({ dest: PDF_DIR });

// ------------------------------------------
// SSE 채널
// ------------------------------------------
const sseChannels = {}; // empNo → res[]

app.get("/events/:empNo", (req, res) => {
  const empNo = req.params.empNo;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.flushHeaders?.();

  if (!sseChannels[empNo]) sseChannels[empNo] = [];
  sseChannels[empNo].push(res);

  const ping = setInterval(() => {
    res.write(":\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(ping);
    sseChannels[empNo] = sseChannels[empNo].filter((r) => r !== res);
  });
});

function broadcast(empNo, payload) {
  const list = sseChannels[empNo];
  if (!list) return;
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  list.forEach((res) => res.write(message));
}

// ------------------------------------------
// 실시간 이벤트 (펜/하이라이트/리셋/이미지 등)
// ------------------------------------------
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  if (!empNo || !type) {
    return res.status(400).json({ ok: false, error: "empNo, type 필수" });
  }

  broadcast(empNo, { type, data, ts: Date.now() });
  res.json({ ok: true });
});

// ------------------------------------------
// 고객 정보 저장
// ------------------------------------------
let nextCustomerId = 1;
const customers = [];

app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;

  if (!empNo || !name || !phone) {
    return res.status(400).json({ ok: false, error: "필수 값 누락" });
  }

  const item = {
    id: nextCustomerId++,
    empNo,
    name,
    phone,
    datetime: datetime || new Date().toISOString(),
    pdfFileName: null,
  };

  customers.push(item);
  res.json({ ok: true, customer: item });
});

// ------------------------------------------
// 고객별 조회
// ------------------------------------------
app.get("/api/customer/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const list = customers.filter((c) => c.empNo === empNo);
  res.json({ ok: true, list });
});

// ------------------------------------------
// PNG 업로드
// ------------------------------------------
app.post("/api/upload", upload.single("file"), (req, res) => {
  const customerId = parseInt(req.body.customerId, 10);
  const file = req.file;

  if (!customerId || !file) {
    return res.status(400).json({ ok: false, error: "customerId 또는 파일 누락" });
  }

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return res.status(404).json({ ok: false, error: "고객 없음" });
  }

  const safeName = customer.name.replace(/[^a-zA-Z0-9가-힣]/g, "");
  const safePhone = customer.phone.replace(/[^0-9]/g, "");
  const newFileName = `${safeName}_${safePhone}.png`;
  const newPath = path.join(PDF_DIR, newFileName);

  fs.renameSync(file.path, newPath);
  customer.pdfFileName = newFileName;

  res.json({
    ok: true,
    filename: newFileName,
    url: `/pdf/${customer.id}`,
  });
});

// ------------------------------------------
// PNG 다운로드
// ------------------------------------------
app.get("/pdf/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const customer = customers.find((c) => c.id === id);

  if (!customer || !customer.pdfFileName)
    return res.status(404).send("파일 없음");

  res.download(path.join(PDF_DIR, customer.pdfFileName));
});

// ------------------------------------------
app.get("/health", (req, res) => res.json({ ok: true }));

// ------------------------------------------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Explain Server Running at http://localhost:${PORT}`);
});
