// explain-server.js
// ================================
// Explain HTTP + SSE 서버 (PNG 전용 버전)
// 상담 고객 정보 저장 + 이미지 업로드 + 관리자 페이지
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

// ------------------------------
// 미들웨어
// ------------------------------
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------
// DB 파일(JSON)
// ------------------------------
const DB_FILE = path.join(__dirname, "db.json");

// DB 초기 생성
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, "[]", "utf8");
}

// DB 로드 & 저장 함수
function loadDB() {
  const raw = fs.readFileSync(DB_FILE, "utf8");
  return JSON.parse(raw);
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ------------------------------
// 이미지 저장 폴더
// ------------------------------
const IMG_DIR = path.join(__dirname, "pdfs"); // 이름 유지
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR);

const upload = multer({ dest: IMG_DIR });

// ------------------------------
// 건강 체크용 API (앱 로그인 확인)
// ------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "alive" });
});

// ------------------------------
// 📌 PNG 업로드 API
// ------------------------------
app.post("/api/upload", upload.single("file"), (req, res) => {
  const id = parseInt(req.body.customerId);
  const file = req.file;

  const db = loadDB();
  const cust = db.find((c) => c.id === id);

  if (!cust) {
    return res.json({ ok: false, error: "고객 없음" });
  }

  const safeName = cust.name.replace(/[^a-zA-Z0-9가-힣]/g, "");
  const safePhone = cust.phone.replace(/[^0-9]/g, "");
  const newName = `${safeName}_${safePhone}.png`;

  fs.renameSync(file.path, path.join(IMG_DIR, newName));

  cust.pngFileName = newName;
  saveDB(db);

  res.json({ ok: true, filename: newName });
});

// ------------------------------
// 📌 고객 정보 저장
// ------------------------------
let nextId = 1;

app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;

  if (!empNo || !name || !phone) {
    return res.status(400).json({ ok: false, error: "필수값 없음" });
  }

  const db = loadDB();

  const entry = {
    id: nextId++,
    empNo,
    name,
    phone,
    datetime,
    pngFileName: null
  };

  db.push(entry);
  saveDB(db);

  res.json({ ok: true, customer: entry });
});

// ------------------------------
// 📌 직원별 상담 조회
// ------------------------------
app.get("/api/customer/:empNo", (req, res) => {
  const db = loadDB();
  const list = db.filter((c) => c.empNo === req.params.empNo);
  res.json({ ok: true, list });
});

// ------------------------------
// 📌 미러링 화면(view.html)
// ------------------------------
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "public/view.html"));
});

// ------------------------------
// 📌 SSE 채널
// ------------------------------
const sseChannels = {};

app.get("/events/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  console.log("🔥 SSE CONNECT:", empNo);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  if (!sseChannels[empNo]) sseChannels[empNo] = [];
  sseChannels[empNo].push(res);

  const interval = setInterval(() => {
    res.write(":\n\n");
  }, 15000);

  req.on("close", () => {
    console.log("❌ SSE CLOSE:", empNo);
    clearInterval(interval);
    sseChannels[empNo] = sseChannels[empNo].filter((r) => r !== res);
  });
});

// SSE 메시지 전송
function sendSSE(empNo, payload) {
  const list = sseChannels[empNo];
  if (!list) return;

  const msg = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  list.forEach((res) => res.write(msg));
}

// ------------------------------
// 📌 Android → Web 미러링 이미지 송신
// ------------------------------
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  if (!empNo || !type || !data) {
    return res.status(400).json({ ok: false, error: "필수값 없음" });
  }

  sendSSE(empNo, { type, data });
  res.json({ ok: true });
});

// ------------------------------
// 📌 관리자 페이지 UI (PNG만 보여줌)
// ------------------------------
app.get("/admin/:empNo", (req, res) => {
  const empNo = req.params.empNo;

  const db = loadDB();
  const list = db.filter((c) => c.empNo === empNo);

  let html = `
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>상담 이력 - ${empNo}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #f5f5f5;
        padding: 20px;
      }
      h1 { text-align:center; margin-bottom:20px; }
      .card {
        background:white; padding:20px; margin:15px auto;
        border-radius:10px; width:90%; max-width:650px;
        box-shadow:0 2px 6px rgba(0,0,0,0.15);
      }
      .row { display:flex; justify-content:space-between; margin:6px 0; }
      .label { font-weight:bold; }
      .thumb {
        width:120px; height:120px; object-fit:cover;
        border-radius:8px; cursor:pointer; border:1px solid #ccc;
      }
      #popup {
        display:none; position:fixed; top:0; left:0;
        width:100%; height:100%; background:rgba(0,0,0,0.75);
        justify-content:center; align-items:center;
      }
      #popup img { max-width:90%; max-height:90%; }
      .btn-download {
        margin-top:10px; display:inline-block; padding:10px 15px;
        background:#2d89ef; color:white; border-radius:8px;
        text-decoration:none;
      }
    </style>
  </head>
  <body>

    <h1>상담 이력 (직원번호 ${empNo})</h1>
  `;

  if (list.length === 0) {
    html += `<p style="text-align:center;">상담 이력이 없습니다.</p>`;
  }

  for (const c of list) {
    const img = c.pngFileName ? `/pdfs/${c.pngFileName}` : null;

    html += `
    <div class="card">
      <div class="row"><div class="label">이름</div><div>${c.name}</div></div>
      <div class="row"><div class="label">연락처</div><div>${c.phone}</div></div>
      <div class="row"><div class="label">일시</div><div>${c.datetime}</div></div>
    `;

    if (img) {
      html += `
        <div style="margin-top:10px;">
          <img class="thumb" src="${img}" onclick="openPopup('${img}')" />
          <br/>
          <a class="btn-download" href="${img}" download>PNG 다운로드</a>
        </div>
      `;
    } else {
      html += `<p style="color:gray;">이미지 없음</p>`;
    }

    html += `</div>`;
  }

  html += `
    <div id="popup" onclick="closePopup()">
      <img id="popupImg" src="">
    </div>

    <script>
      function openPopup(src){
        document.getElementById("popupImg").src = src;
        document.getElementById("popup").style.display = "flex";
      }
      function closePopup(){
        document.getElementById("popup").style.display = "none";
      }
    </script>

  </body>
  </html>
  `;

  res.send(html);
});

// ------------------------------
// 📌 DB 확인용 API (개발 도움용)
// ------------------------------
app.get("/debug/db", (req, res) => {
  const data = fs.readFileSync(DB_FILE, "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(data);
});

// 다운로드
app.get("/debug/download-db", (req, res) => {
  res.download(DB_FILE, "db.json");
});

// ------------------------------
// 서버 시작
// ------------------------------
server.listen(PORT, () => {
  console.log(`🚀 Explain Server Running on PORT: ${PORT}`);
});
