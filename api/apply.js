/**
 * 레포트 신청 → 노션 데이터베이스
 *
 * 필요한 환경변수 (Vercel → Settings → Environment Variables)
 *   NOTION_TOKEN : 노션 내부 통합 토큰 (ntn_ 으로 시작)
 *   NOTION_DB    : 신청자 데이터베이스 ID
 */

const CHARACTERS = ["성기사", "치유사", "황금 기사", "음유시인", "마법사", "수호자", "모험가", "검사", "외교관"];
const AGES = ["10대", "20대", "30대", "40대 이상"];
const GENDERS = ["남", "여"];

const clean = (v, max = 120) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const pick = (v, list) => (list.indexOf(v) >= 0 ? { select: { name: v } } : { select: null });

/* 테스트가 보내는 값을 노션 선택지에 맞춘다 */
const normGender = (v) => (v.indexOf("남") === 0 ? "남" : v.indexOf("여") === 0 ? "여" : "");
const normCharacter = (v) => CHARACTERS.find((c) => v.indexOf(c) >= 0) || "";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const TOKEN = process.env.NOTION_TOKEN;
  const DB = process.env.NOTION_DB;
  if (!TOKEN || !DB) {
    console.error("[apply] 환경변수 NOTION_TOKEN / NOTION_DB 가 비어 있습니다");
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

  try {
    const r = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TOKEN,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ parent: { database_id: DB }, properties })
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("[apply] 노션 응답 오류", r.status, text.slice(0, 500));
      return res.status(502).json({ ok: false, error: "notion" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[apply] 전송 실패", err && err.message);
    return res.status(502).json({ ok: false, error: "network" });
  }
};
