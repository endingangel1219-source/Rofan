/**
 * 레포트 신청 → 노션 데이터베이스
 *
 * 환경변수 (Vercel → Settings → Environment Variables)
 *   NOTION_TOKEN       노션 내부 통합 시크릿 (ntn_ 으로 시작)       [필수]
 *   NOTION_DATA_SOURCE 데이터 소스 ID                              [권장]
 *   NOTION_DB          데이터베이스 ID (구버전 방식 대비용)         [선택]
 *
 * 연결이 잘 됐는지 보려면 브라우저로 /api/apply 를 그냥 열어보세요.
 */

const DEFAULT_DATA_SOURCE = "41f62932-4562-8181-95ca-000be065c455";
const DEFAULT_DB = "41f62932-4562-81ae-8265-c88ae3e6b8a9";

const CHARACTERS = ["성기사", "치유사", "황금 기사", "음유시인", "마법사", "수호자", "모험가", "검사", "외교관"];
const AGES = ["10대", "20대", "30대", "40대 이상"];
const GENDERS = ["남", "여"];

const clean = (v, max = 120) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const pick = (v, list) => (list.indexOf(v) >= 0 ? { select: { name: v } } : { select: null });
const normGender = (v) => (v.indexOf("남") === 0 ? "남" : v.indexOf("여") === 0 ? "여" : "");
const normCharacter = (v) => CHARACTERS.find((c) => v.indexOf(c) >= 0) || "";

function notion(path, token, version, init) {
  return fetch("https://api.notion.com/v1" + path, Object.assign({
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": version,
      "Content-Type": "application/json"
    }
  }, init));
}

/* 브라우저로 열었을 때 보여주는 연결 점검 결과 */
async function selfTest(res, token, dataSource, db) {
  const line = [];
  line.push("■ 노션 연결 점검");
  line.push("");
  line.push("NOTION_TOKEN        : " + (token ? "있음 (" + token.slice(0, 4) + "…)" : "없음 ← 설정하세요"));
  line.push("NOTION_DATA_SOURCE  : " + dataSource);
  line.push("NOTION_DB           : " + db);
  line.push("");

  if (!token) {
    line.push("결과: 토큰이 없습니다. Vercel 환경변수에 NOTION_TOKEN 을 넣고 Redeploy 하세요.");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(line.join("\n"));
  }

  let okAny = false;
  for (const t of [
    { label: "새 방식 (data_sources)", path: "/data_sources/" + dataSource, version: "2025-09-03" },
    { label: "구 방식 (databases)", path: "/databases/" + db, version: "2022-06-28" }
  ]) {
    try {
      const r = await notion(t.path, token, t.version, { method: "GET" });
      if (r.ok) { line.push("✅ " + t.label + " : 연결됨"); okAny = true; }
      else {
        const j = await r.json().catch(() => ({}));
        line.push("❌ " + t.label + " : " + r.status + " " + (j.code || "") + " " + (j.message || "").slice(0, 160));
      }
    } catch (e) {
      line.push("❌ " + t.label + " : 요청 실패 " + (e && e.message));
    }
  }

  line.push("");
  line.push(okAny
    ? "결과: 연결 정상입니다. 테스트에서 신청서를 제출해보세요."
    : "결과: 토큰은 있는데 데이터베이스를 못 읽습니다.\n      노션에서 DB 우측 상단 ⋯ → 연결 → 만든 통합을 선택했는지 확인하세요.");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(line.join("\n"));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const TOKEN = process.env.NOTION_TOKEN;
  const DATA_SOURCE = process.env.NOTION_DATA_SOURCE || DEFAULT_DATA_SOURCE;
  const DB = process.env.NOTION_DB || DEFAULT_DB;

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return selfTest(res, TOKEN, DATA_SOURCE, DB);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  if (!TOKEN) {
    console.error("[apply] NOTION_TOKEN 이 비어 있습니다");
    return res.status(500).json({ ok: false, error: "config" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const name = clean(body.name, 40);
  const phone = clean(body.phone, 30);
  if (!name || !phone) return res.status(400).json({ ok: false, error: "missing" });
  if (!/^[0-9+\-() .]{8,}$/.test(phone)) return res.status(400).json({ ok: false, error: "phone" });

  const matchRaw = Number(body.match);
  const match = Number.isFinite(matchRaw) ? Math.max(0, Math.min(100, Math.round(matchRaw))) : null;

  const properties = {
    "이름": { title: [{ text: { content: name } }] },
    "연락처": { phone_number: phone },
    "인물": pick(normCharacter(clean(body.character, 40)), CHARACTERS),
    "성별": pick(normGender(clean(body.gender, 6)), GENDERS),
    "나이대": pick(clean(body.age, 10), AGES),
    "거주지": { rich_text: [{ text: { content: clean(body.region, 60) } }] },
    "일치율": { number: match },
    "개인정보 동의": { checkbox: body.consent === true },
    "상태": { status: { name: "신청 접수" } }
  };

  /* 노션이 새 구조(데이터 소스)로 바뀌는 중이라 두 방식을 차례로 시도한다 */
  const attempts = [
    { version: "2025-09-03", parent: { type: "data_source_id", data_source_id: DATA_SOURCE } },
    { version: "2022-06-28", parent: { database_id: DB } }
  ];

  let lastError = "";
  for (const a of attempts) {
    try {
      const r = await notion("/pages", TOKEN, a.version, {
        method: "POST",
        body: JSON.stringify({ parent: a.parent, properties })
      });
      if (r.ok) return res.status(200).json({ ok: true });
      lastError = r.status + " " + (await r.text()).slice(0, 300);
      console.error("[apply] 실패 (" + a.version + ")", lastError);
    } catch (err) {
      lastError = String(err && err.message);
      console.error("[apply] 요청 오류 (" + a.version + ")", lastError);
    }
  }
  return res.status(502).json({ ok: false, error: "notion" });
};
