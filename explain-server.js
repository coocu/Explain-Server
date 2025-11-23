// explain-server.js
// ================================
// Explain HTTP + SSE 서버 (PNG + 관리자 고급 기능 버전)
// 상담 고객 정보 저장 + PNG 업로드 + 관리자 검색 + 기간 필터 + 엑셀 다운로드
// ================================

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5785;

// ------------------------------
// 공통 미들웨어
// ------------------------------
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// 정적 파일 (public)
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------
// DB 파일(JSON)
// ------------------------------
const DB_FILE = path.join(__dirname, "db.json");

// DB 초기 생성
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, "[]", "utf8");
}

function loadDB() {
  const raw = fs.readFileSync(DB_FILE, "utf8");
  return JSON.parse(raw);
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ------------------------------
// PNG 저장 폴더
// ------------------------------
const IMG_DIR = path.join(__dirname, "pdfs"); // 기존 경로명 유지
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR);

// /pdfs 경로로 PNG 서빙
app.use("/pdfs", express.static(IMG_DIR));

const upload = multer({ dest: IMG_DIR });

// ------------------------------
// 헬스 체크 (앱 로그인용)
// ------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "alive" });
});

// ------------------------------
// 고객 정보 저장
// ------------------------------
app.post("/api/customer", (req, res) => {
  const { empNo, name, phone, datetime } = req.body;

  if (!empNo || !name || !phone) {
    return res.status(400).json({ ok: false, error: "필수값 없음" });
  }

  const db = loadDB();
  const newId =
    db.length > 0 ? Math.max(...db.map((c) => c.id || 0)) + 1 : 1;

  const entry = {
    id: newId,
    empNo,
    name,
    phone,
    datetime,
    pngFileName: null,
  };

  db.push(entry);
  saveDB(db);

  res.json({ ok: true, customer: entry });
});

// 직원별 상담 리스트 JSON
app.get("/api/customer/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const db = loadDB();
  const list =
    empNo === "65465786" ? db : db.filter((c) => c.empNo === empNo);

  res.json({ ok: true, list });
});

// ------------------------------
// PNG 업로드
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
// 미러링 뷰 페이지
// ------------------------------
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "public/view.html"));
});

// ------------------------------
// SSE (미러링용) - 나중에 활용
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
    sseChannels[empNo] = (sseChannels[empNo] || []).filter(
      (r) => r !== res
    );
  });
});

function sendSSE(empNo, payload) {
  const list = sseChannels[empNo];
  if (!list) return;

  const msg = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  list.forEach((res) => res.write(msg));
}

// 안드로이드 → 실시간 미러링 데이터 수신
app.post("/api/send", (req, res) => {
  const { empNo, type, data } = req.body;

  if (!empNo || !type || !data) {
    return res.status(400).json({ ok: false, error: "필수값 없음" });
  }

  sendSSE(empNo, { type, data });
  res.json({ ok: true });
});

// ------------------------------
// 관리자 홈: /admin → /admin/65465786 리다이렉트 (전체)
// ------------------------------
app.get("/admin", (req, res) => {
  res.redirect("/admin/65465786");
});

// ------------------------------
// 관리자 페이지 (검색 + 기간 + 무한 스크롤)
// ------------------------------
app.get("/admin/:empNo", (req, res) => {
  const empNo = req.params.empNo;

  const db = loadDB();
  let list = empNo === "65465786" ? db : db.filter((c) => c.empNo === empNo);

  // 최신순 정렬 (datetime 기준)
  list.sort((a, b) => {
    const ad = a.datetime || "";
    const bd = b.datetime || "";
    return bd.localeCompare(ad);
  });

  const isAdminAll = empNo === "65465786";

  let html = `
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>상담 이력 - ${
      isAdminAll ? "전체(관리자)" : empNo
    }</title>
    <style>
      body {
        font-family: Arial, NanumGothic, sans-serif;
        background: #f5f5f5;
        padding: 20px;
      }
      h1 { text-align:center; margin-bottom:10px; }
      #searchBox {
        background:white; padding:15px; margin:0 auto 20px auto;
        border-radius:10px; width:90%; max-width:900px;
        box-shadow:0 2px 6px rgba(0,0,0,0.1);
        display:flex; flex-wrap:wrap; gap:8px;
      }
      #searchBox input {
        flex:1 1 150px;
        padding:10px;
        border-radius:8px;
        border:1px solid #ccc;
      }
      #excelBtn {
        padding:10px 15px;
        border-radius:8px;
        background:#4caf50;
        color:white;
        text-decoration:none;
        margin-left:auto;
      }
      .card {
        background:white; padding:20px; margin:15px auto;
        border-radius:10px; width:90%; max-width:900px;
        box-shadow:0 2px 6px rgba(0,0,0,0.15);
      }
      .row { display:flex; justify-content:space-between; margin:6px 0; }
      .label { font-weight:bold; }
      .thumb {
        width:140px; height:140px; object-fit:cover;
        border-radius:8px; cursor:pointer; border:1px solid #ccc;
      }
      #popup {
        display:none; position:fixed; top:0; left:0;
        width:100%; height:100%; background:rgba(0,0,0,0.75);
        justify-content:center; align-items:center;
      }
      #popup img { max-width:90%; max-height:90%; border-radius:8px; }
      .no-data { text-align:center; margin-top:30px; font-size:18px; }
    </style>
  </head>
  <body>

    <h1>상담 이력 ${
      isAdminAll ? "(전체 관리자 모드)" : `(사번: ${empNo})`
    }</h1>

    <div id="searchBox">
      <input id="searchName" type="text" placeholder="이름 검색" />
      <input id="searchPhone" type="text" placeholder="전화번호 검색" />
      <input id="startDate" type="date" />
      <input id="endDate" type="date" />
      <a id="excelBtn" href="/admin-export/${empNo}">엑셀 다운로드</a>
    </div>

    <div id="listArea">
  `;

  if (list.length === 0) {
    html += `<div class="no-data">상담 이력이 없습니다.</div>`;
  }

  // 카드 렌더링
  list.forEach((c, idx) => {
    const imgUrl = c.pngFileName ? `/pdfs/${c.pngFileName}` : "";
    const dt = String(c.datetime || "");
    let dateKey = "";

    // yyyyMMdd... or yyyy-MM-dd... 형태를 yyyy-MM-dd 로 정규화
    const m = dt.match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
    if (m) {
      dateKey = `${m[1]}-${m[2]}-${m[3]}`;
    }

    html += `
      <div class="card"
        data-name="${c.name}"
        data-phone="${c.phone}"
        data-date="${dateKey}"
        data-index="${idx}">
        <div class="row"><div class="label">이름</div><div>${c.name}</div></div>
        <div class="row"><div class="label">연락처</div><div>${c.phone}</div></div>
        <div class="row"><div class="label">상담일시</div><div>${c.datetime}</div></div>
        <div class="row"><div class="label">사번</div><div>${c.empNo}</div></div>
    `;

    if (imgUrl) {
      html += `
        <div style="margin-top:10px;">
          <img class="thumb" src="${imgUrl}" onclick="openPopup('${imgUrl}')" />
        </div>
      `;
    } else {
      html += `<p style="color:gray; margin-top:10px;">이미지 없음</p>`;
    }

    html += `</div>`;
  });

  html += `
    </div>

    <div id="popup" onclick="closePopup()">
      <img id="popupImg" src="">
    </div>

    <script>
      // 팝업
      function openPopup(src) {
        document.getElementById("popupImg").src = src;
        document.getElementById("popup").style.display = "flex";
      }
      function closePopup() {
        document.getElementById("popup").style.display = "none";
      }

      // 검색 + 기간 + 무한 스크롤
      const cards = Array.from(document.querySelectorAll(".card"));
      const nameInput = document.getElementById("searchName");
      const phoneInput = document.getElementById("searchPhone");
      const startDateInput = document.getElementById("startDate");
      const endDateInput = document.getElementById("endDate");

      const PAGE_SIZE = 20;
      let showCount = PAGE_SIZE;
      let lastMatchCount = cards.length;

      function applyFilters(reset) {
        if (reset) showCount = PAGE_SIZE;

        const nameVal = nameInput.value.trim();
        const phoneVal = phoneInput.value.trim();
        const startVal = startDateInput.value;
        const endVal = endDateInput.value;

        let matchIdx = 0;

        cards.forEach(card => {
          const cname = card.dataset.name || "";
          const cphone = card.dataset.phone || "";
          const cdate = card.dataset.date || "";

          const matchName = cname.includes(nameVal);
          const matchPhone = cphone.includes(phoneVal);

          let matchDate = true;
          if (startVal && cdate) {
            matchDate = cdate >= startVal;
          }
          if (endVal && cdate) {
            matchDate = matchDate && (cdate <= endVal);
          }

          const isMatch = matchName && matchPhone && matchDate;

          if (isMatch) {
            if (matchIdx < showCount) {
              card.style.display = "block";
            } else {
              card.style.display = "none";
            }
            matchIdx++;
          } else {
            card.style.display = "none";
          }
        });

        lastMatchCount = matchIdx;
      }

      // 초기 렌더
      applyFilters(true);

      nameInput.addEventListener("input", () => applyFilters(true));
      phoneInput.addEventListener("input", () => applyFilters(true));
      startDateInput.addEventListener("change", () => applyFilters(true));
      endDateInput.addEventListener("change", () => applyFilters(true));

      window.addEventListener("scroll", () => {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
          if (showCount < lastMatchCount) {
            showCount += PAGE_SIZE;
            applyFilters(false);
          }
        }
      });
    </script>

  </body>
  </html>
  `;

  res.send(html);
});

// ------------------------------
// 엑셀(XLSX) 다운로드
// ------------------------------
app.get("/admin-export/:empNo", (req, res) => {
  const empNo = req.params.empNo;
  const db = loadDB();

  const list =
    empNo === "65465786" ? db : db.filter((c) => c.empNo === empNo);

  const rows = list.map((c, idx) => ({
    No: idx + 1,
    EmpNo: c.empNo,
    Name: c.name,
    Phone: c.phone,
    DateTime: c.datetime,
    ImageFile: c.pngFileName || "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Consults");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="consult_${empNo}.xlsx"`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(buf);
});

// ------------------------------
// DB 디버그용 (원하면 나중에 삭제해도 됨)
// ------------------------------
app.get("/debug/db", (req, res) => {
  const data = fs.readFileSync(DB_FILE, "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(data);
});

app.get("/debug/download-db", (req, res) => {
  res.download(DB_FILE, "db.json");
});

// ------------------------------
// 서버 시작
// ------------------------------
server.listen(PORT, () => {
  console.log(`🚀 Explain Server Running on PORT: ${PORT}`);
});
