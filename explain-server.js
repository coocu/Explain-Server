// explain-server.js
// ================================
// Explain HTTP + SSE 서버 + 고객뷰 실시간 갱신
// ================================

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// ----------------------------
// 서버 기본 세팅
// ----------------------------
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5785;

app.use(cors());
app.use(express.json());

// ----------------------------
// 정적 파일 서빙 (고객용 view.html 표시)
// ----------------------------
app.use(express.static(path.join(__dirname, "public")));

// ----------------------------
// PDF/PNG 저장 폴더
// ----------------------------
const PDF_DIR = path.join(__dirname, "pdfs");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

const upload = multer({ dest: PDF_DIR });

// ----------------------------
// SSE 채널 (실시간 펜/하이라이트 이벤트)
// ----------------------------
const sseChannels = {};

app.get("/events/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  console.log("👤 SSE 연결:", empNo);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.flushHeaders?.();

  if (!sseChannels[empNo]) sseChannels[empNo] = [];
  sseChannels[empNo].push(res);

  const intervalId = setInterval(() => res.write(":\n\n"), 30000);

  req.on("close", () => {
    clearInterval(intervalId);
    sseChannels[empNo] = sseChannels[empNo].filter(r => r !== res);
  });
});

function broadcastSSE(empNo, payload) {
  const list = sseChannels[empNo];
  if (!list) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  list.forEach(res => res.write(msg));
}

// ----------------------------
// 실시간 상담 이벤트
// ----------------------------
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;
  if (!empNo || !type) return res.status(400).json({ ok: false });

  broadcastSSE(empNo, { type, data, ts: Date.now() });
  res.json({ ok: true });
});

// ----------------------------
// 고객정보 저장
// ----------------------------
let nextCustomerId = 1;
const customers = [];

app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;
  if (!empNo || !name || !phone) {
    return res.status(400).json({ ok: false, error: "필수값 누락" });
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
  console.log("💾 고객정보 저장:", item);

  res.json({ ok: true, customer: item });
});

app.get("/api/customer/:empNo", (req, res) => {
  const list = customers.filter(c => c.empNo === req.params.empNo);
  res.json({ ok: true, list });
});

// ================================
// ** 상담사별 최신 PNG 저장소 **
// empNo → 파일경로
// ================================
const latestImageByEmp = {};  // ★ 추가됨

// ----------------------------
// PNG 업로드
// ----------------------------
app.post("/api/upload", upload.single("file"), (req, res) => {
  const customerId = parseInt(req.body.customerId, 10);
  const empNo = req.body.empNo;  // ★ 추가됨
  const file = req.file;

  if (!customerId || !file || !empNo) {
    return res.status(400).json({ ok: false, error: "필수값 누락" });
  }

  const customer = customers.find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ ok: false, error: "고객 없음" });

  const safeName = customer.name.replace(/[^a-zA-Z0-9가-힣]/g, "");
  const safePhone = customer.phone.replace(/[^0-9]/g, "");
  const newFileName = `${safeName}_${safePhone}.png`;

  const newPath = path.join(PDF_DIR, newFileName);
  fs.renameSync(file.path, newPath);

  customer.pdfFileName = newFileName;

  // ★ 상담사별 최신 이미지로 기록
  latestImageByEmp[empNo] = newPath;

  console.log("📸 PNG 저장됨:", newFileName);

  res.json({
    ok: true,
    filename: newFileName,
    url: `/pdf/${customerId}`,
  });
});

// ----------------------------
// 최신 PNG 뷰어 API
// GET /api/latest?empNo=123456
// ----------------------------
app.get("/api/latest", (req, res) => {
  const empNo = req.query.empNo;
  if (!empNo) return res.status(400).json({ ok: false, error: "empNo 필요" });

  const filePath = latestImageByEmp[empNo];
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "이미지 없음" });
  }

  res.json({
    ok: true,
    url: "/latest/" + empNo
  });
});

// 고객이 실제 파일을 받을 라우트
app.get("/latest/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const filePath = latestImageByEmp[empNo];

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send("이미지 없음");
  }

  res.sendFile(filePath);
});

// ----------------------------
// PDF/PNG 다운로드
// ----------------------------
app.get("/pdf/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = customers.find(c => c.id === id);
  if (!customer || !customer.pdfFileName) return res.status(404).send("PDF 없음");

  const filePath = path.join(PDF_DIR, customer.pdfFileName);
  res.download(filePath, customer.pdfFileName);
});

// ----------------------------
// 관리자 페이지
// ----------------------------
app.get("/admin/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const list = customers.filter(c => c.empNo === empNo);

  let html = `
  <html><head><meta charset="UTF-8">
  <title>상담 내역 - ${empNo}</title></head>
  <body style="background:#111;color:#eee;font-family:sans-serif;padding:20px">
  <h1>상담 내역 - ${empNo}</h1>
  <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
    <tr><th>ID</th><th>고객명</th><th>연락처</th><th>일시</th><th>파일</th></tr>
  `;

  list.forEach(c => {
    html += `
      <tr>
        <td>${c.id}</td>
        <td>${c.name}</td>
        <td>${c.phone}</td>
        <td>${c.datetime}</td>
        <td>${c.pdfFileName ? `<a href="/pdf/${c.id}">다운로드</a>` : "없음"}</td>
      </tr>
    `;
  });

  html += "</table></body></html>";
  res.send(html);
});

// ----------------------------
// 헬스체크
// ----------------------------
app.get("/health", (req, res) => res.json({ ok: true }));

// ----------------------------
// 서버 시작
// ----------------------------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Explain 서버 실행 중: http://localhost:${PORT}`);
});
