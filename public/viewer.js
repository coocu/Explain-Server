// viewer.js
// 고객 실시간 미러링

const params = new URLSearchParams(window.location.search);
const empNo = params.get("empNo");

if (!empNo) {
  alert("empNo 누락됨");
}

const img = document.getElementById("viewImage");

const evt = new EventSource(`/events/${empNo}`);

evt.onmessage = (event) => {
  try {
    const obj = JSON.parse(event.data);

    if (obj.type === "image") {
      // base64 이미지 표시
      img.src = obj.data;
    }

    if (obj.type === "reset") {
      img.src = "";
    }
  } catch (err) {
    console.log("SSE 파싱 오류:", err);
  }
};

