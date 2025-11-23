// explain-server.js
// ================================
// Explain HTTP + SSE 서버 (로컬/클라우드 공용)
// - SSE: 실시간 상담 필기/하이라이트/페이지 이동
// - 고객정보 저장
// - PNG 저장 (이름_연락처.png)
// - 상담사별 관리 페이지
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

// CORS + JSON 파싱
app.use(cors());
app.use(express.json());

// ----------------------------
// PDF/PNG 저장 폴더
// ----------------------------
const PDF_DIR = path.join(__dirname, "pdfs");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

// Multer 임시 업로드 폴더
const upload = multer({ dest: PDF_DIR });

// ----------------------------
// 1) SSE 채널 구조
// ----------------------------
const sseChannels = {}; // empNo → [res, res...]

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

  const intervalId = setInterval(() => {
    res.write(":\n\n"); // 심장박동
  }, 30000);

  req.on("close", () => {
    console.log("❌ SSE 종료:", empNo);
    clearInterval(intervalId);
    sseChannels[empNo] = sseChannels[empNo].filter((r) => r !== res);
  });
});

// SSE 브로드캐스트
function broadcastSSE(empNo, payload) {
  const list = sseChannels[empNo];
  if (!list) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  list.forEach((res) => res.write(msg));
}

// ----------------------------
// 2) 실시간 상담 이벤트
// ----------------------------
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  if (!empNo || !type) {
    return res.status(400).json({ ok: false, error: "empNo, type 필수" });
  }

  console.log(`📩 이벤트 from ${empNo}:`, { type, data });

  broadcastSSE(empNo, { type, data, ts: Date.now() });
  res.json({ ok: true });
});

// ----------------------------
// 3) 고객정보 저장
// ----------------------------
let nextCustomerId = 1;
const customers = [];

// { id, empNo, name, phone, datetime, pdfFileName }

app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;

  if (!empNo || !name || !phone) {
    return res.status(400).json({ ok: false, error: "empNo, name, phone 필수" });
  }

  const item = {
    id: nextCustomerId++,
    empNo,
    name,
    phone,
    datetime: datetime || new Date().toISOString(),
    pdfFileName: null, // 나중에 업로드될 PNG 파일명
  };

  customers.push(item);

  console.log("💾 고객정보 저장:", item);

  res.json({ ok: true, customer: item });
});

// 판매사원별 고객 조회
app.get("/api/customer/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const list = customers.filter((c) => c.empNo === empNo);
  res.json({ ok: true, list });
});

// ----------------------------
// 4) PNG 업로드 (이름_연락처.png)
// ----------------------------
app.post("/api/upload", upload.single("file"), (req, res) => {
  const customerId = parseInt(req.body.customerId, 10);
  const file = req.file;

  if (!customerId || !file) {
    return res.status(400).json({ ok: false, error: "customerId 또는 파일 누락" });
  }

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return res.status(404).json({ ok: false, error: "고객 ID 없음" });
  }

  // 파일명 = 고객명_전화번호.png
  const safeName = customer.name.replace(/[^a-zA-Z0-9가-힣]/g, "");
  const safePhone = customer.phone.replace(/[^0-9]/g, "");
  const newFileName = `${safeName}_${safePhone}.png`;

  const newPath = path.join(PDF_DIR, newFileName);

  // 파일명 변경
  fs.renameSync(file.path, newPath);

  // 고객 데이터에 파일명 기록
  customer.pdfFileName = newFileName;

  console.log("📸 PNG 저장됨:", newFileName);

  return res.json({
    ok: true,
    filename: newFileName,
    url: `/pdf/${customerId}`,
  });
});

// ----------------------------
// 5) PDF/PNG 다운로드
// ----------------------------
app.get("/pdf/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = customers.find((c) => c.id === id);

  if (!customer || !customer.pdfFileName) {
    return res.status(404).send("PDF 준비 안됨");
  }

  const filePath = path.join(PDF_DIR, customer.pdfFileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("파일 없음");
  }

  res.download(filePath, customer.pdfFileName);
});

// ----------------------------
// 6) 관리자 페이지 (상담기록 조회)
// ----------------------------
app.get("/admin/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const list = customers.filter((c) => c.empNo === empNo);

  let html = `
  <html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>상담 내역 - ${empNo}</title>
    <style>
      body { font-family:sans-serif; padding:20px; background:#111; color:#eee; }
      table { border-collapse: collapse; width: 100%; margin-top: 10px; }
      th, td { border: 1px solid #555; padding: 8px; text-align: left; }
      th { background:#222; }
      a { color:#4fc3f7; }
    </style>
  </head>
  <body>
    <h1>상담 내역 - ${empNo}</h1>
    <table>
      <tr>
        <th>ID</th>
        <th>고객명</th>
        <th>연락처</th>
        <th>상담일시</th>
        <th>PDF/이미지</th>
      </tr>
  `;

  for (const c of list) {
    html += `
      <tr>
        <td>${c.id}</td>
        <td>${c.name}</td>
        <td>${c.phone}</td>
        <td>${c.datetime}</td>
        <td>${c.pdfFileName ? `<a href="/pdf/${c.id}" target="_blank">다운로드</a>` : `준비 안됨`}</td>
      </tr>
    `;
  }

  html += `
    </table>
  </body>
  </html>
  `;

  res.send(html);
});

// ----------------------------
// 7) 헬스체크
// ----------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ----------------------------
// 8) 서버 시작
// ----------------------------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Explain HTTP+SSE 서버 실행 중: http://localhost:${PORT}`);
});
