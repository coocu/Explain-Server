// explain-server.js (완전 작동 버전)
// ================================
// - SSE: 실시간 그림/하이라이트/삭제/리셋
// - PNG 업로드 후 고객 화면 자동 갱신
// - /view?empNo=XXXX 로 고객 화면 제공
// - public 폴더에서 정적파일 제공
// ================================

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5785;

app.use(cors());
app.use(express.json());

// public 정적 파일 서빙
app.use("/", express.static(path.join(__dirname, "public")));

// 저장 폴더
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// PNG 업로드용 multer
const upload = multer({ dest: UPLOAD_DIR });

// SSE 저장소
const channels = {}; // empNo → [res, res...]

// ==============================
// SSE 연결
// ==============================
app.get("/events/:empNo", (req, res) => {
  const { empNo } = req.params;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  res.flushHeaders?.();

  if (!channels[empNo]) channels[empNo] = [];
  channels[empNo].push(res);

  console.log(`🔗 SSE connected: ${empNo}`);

  const heartbeat = setInterval(() => {
    res.write(":\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    channels[empNo] = channels[empNo].filter((r) => r !== res);
    console.log(`❌ SSE disconnected: ${empNo}`);
  });
});

// Broadcaster
function sendSSE(empNo, payload) {
  const list = channels[empNo];
  if (!list) return;

  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  list.forEach((r) => r.write(msg));
}

// ==============================
// 상담사 → 고객 SSE 전송 API
// ==============================
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  if (!empNo || !type) {
    return res.status(400).json({ ok: false, error: "empNo, type required" });
  }

  sendSSE(empNo, { type, data });
  res.json({ ok: true });
});

// ==============================
// PNG 업로드 → 고객 화면 자동 갱신
// ==============================
app.post("/api/upload", upload.single("file"), (req, res) => {
  const empNo = req.body.empNo;
  const file = req.file;

  if (!empNo || !file) {
    return res.status(400).json({ ok: false });
  }

  const newName = `${empNo}_${Date.now()}.png`;
  const newPath = path.join(UPLOAD_DIR, newName);

  fs.renameSync(file.path, newPath);

  // 고객 화면에 이미지 표시 이벤트 발송
  sendSSE(empNo, {
    type: "image",
    url: `/uploads/${newName}`,
  });

  res.json({
    ok: true,
    url: `/uploads/${newName}`,
  });
});

// 업로드 이미지 공개 제공
app.use("/uploads", express.static(UPLOAD_DIR));

// ==============================
// 고객 화면 URL
// ==============================
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "public/view.html"));
});

// ==============================
// 헬스체크
// ==============================
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ==============================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
});
