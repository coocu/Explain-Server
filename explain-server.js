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
app.use(express.json());

// ----------------------------
// STATIC (public 폴더 전체 제공)
// ----------------------------
app.use("/", express.static(path.join(__dirname, "public")));

console.log("📂 Static folder:", path.join(__dirname, "public"));

// ----------------------------
// SSE 관리
// ----------------------------
const sseChannels = {}; // empNo → [response...]

app.get("/events/:empNo", (req, res) => {
  const empNo = req.params.empNo;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  res.flushHeaders?.();

  if (!sseChannels[empNo]) sseChannels[empNo] = [];
  sseChannels[empNo].push(res);

  const interval = setInterval(() => {
    res.write(":\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(interval);
    sseChannels[empNo] = sseChannels[empNo].filter(r => r !== res);
  });
});

function broadcast(empNo, data) {
  const list = sseChannels[empNo];
  if (!list) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  list.forEach(res => res.write(msg));
}

// ----------------------------
// 상담 이벤트 전송
// ----------------------------
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  if (!empNo || !type) {
    return res.status(400).json({ ok: false });
  }

  broadcast(empNo, { type, data });
  res.json({ ok: true });
});

// ----------------------------
// 고객 저장
// ----------------------------
let nextCustomerId = 1;
const customers = [];

app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;

  const item = {
    id: nextCustomerId++,
    empNo,
    name,
    phone,
    datetime,
    pdfFileName: null
  };

  customers.push(item);

  res.json({ ok: true, customer: item });
});

// ----------------------------
// PNG 업로드
// ----------------------------
const UPLOAD_DIR = path.join(__dirname, "pdfs");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const upload = multer({ dest: UPLOAD_DIR });

app.post("/api/upload", upload.single("file"), (req, res) => {
  const customerId = parseInt(req.body.customerId, 10);
  const file = req.file;

  const customer = customers.find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ ok: false });

  const safeName = customer.name.replace(/[^a-zA-Z0-9가-힣]/g, "");
  const safePhone = customer.phone.replace(/[^0-9]/g, "");

  const newFileName = `${safeName}_${safePhone}.png`;
  const newPath = path.join(UPLOAD_DIR, newFileName);

  fs.renameSync(file.path, newPath);
  customer.pdfFileName = newFileName;

  res.json({ ok: true, url: `/pdf/${customerId}` });
});

// ----------------------------
// PNG 다운로드
// ----------------------------
app.get("/pdf/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = customers.find(c => c.id === id);

  if (!customer?.pdfFileName) return res.status(404).send("not ready");

  const filePath = path.join(UPLOAD_DIR, customer.pdfFileName);
  if (!fs.existsSync(filePath)) return res.status(404).send("not exist");

  res.download(filePath);
});

// ----------------------------
// VIEW 페이지
// ----------------------------
// https://server/view?empNo=19931508
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "viewer.html"));
});

// ----------------------------
// 서버 시작
// ----------------------------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});
