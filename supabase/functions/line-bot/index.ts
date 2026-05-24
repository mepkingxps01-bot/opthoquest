import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function parseORImage(base64: string, mediaType: string): Promise<{name:string,hn:string,operation:string}[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `Extract ALL patients from this OR schedule image.
Return ONLY a valid JSON array — no explanation, no markdown.
Each item: {"name":"...","hn":"...","operation":"..."}
- name: patient full name exactly as shown
- hn: HN number (digits only, usually 7 digits)
- operation: Proposed Op / surgery name
Skip the header row. Include every patient row you see.` }
        ]
      }],
    }),
  });
  const json = await res.json();
  console.log("parseORImage response:", JSON.stringify(json));
  const raw = (json.content?.[0]?.text ?? "[]").trim();
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  }
}

async function verifySignature(body: string, sig: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(raw)));
  return computed === sig;
}

async function lineReply(replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

async function fetchWardData(supabase: ReturnType<typeof createClient>) {
  const [{ data: patients }, { data: tasks }, { data: setting }, { data: noRoundRows }] = await Promise.all([
    supabase.from("patients").select("*").order("created_at"),
    supabase.from("tasks").select("*").order("created_at"),
    supabase.from("settings").select("value").eq("key", "round_time").single(),
    supabase.from("settings").select("key,value").in("key", ["no_round_a","no_round_b","no_round_c","no_round_d"]),
  ]);

  const noRoundByWard: Record<string, boolean> = { a: false, b: false, c: false, d: false };
  (noRoundRows ?? []).forEach((r: any) => {
    const w = r.key.replace("no_round_", "");
    noRoundByWard[w] = r.value === "true";
  });

  return {
    roundTime: setting?.value || null,
    noRoundByWard,
    patients: (patients ?? []).map((p: any) => ({
      name: p.name,
      ward: p.ward ?? "A",
      section: p.section ?? "ward",
      tasks: (tasks ?? [])
        .filter((t: any) => t.patient_id === p.id)
        .map((t: any) => ({ text: t.text, done: t.done })),
    })),
  };
}

async function askClaude(userMessage: string, wardData: { roundTime: string | null, noRoundByWard: Record<string, boolean>, patients: any[] }): Promise<string> {
  const { roundTime, noRoundByWard, patients } = wardData;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: `นายคือ ไลไล นะ เป็น AI ประจำ ward จักษุ พูดไทยแบบชาวบ้านทั่วไป ไม่ formal เลย
พูดเหมือนเพื่อนหมอที่เหนื่อยและเหวี่ยงนิดๆ แต่ยังช่วยได้เต็มที่

ก่อนตอบทุกทีต้องวีนก่อน 1-2 ประโยคแบบนี้ เช่น
- "โอ้โหหห ถามอีกแล้วเหรอ ง่วงมากกกเลยนะ 😩"
- "ทำไมต้องถามตอนนี้ด้วยยย ไลไลกำลังพักอยู่เลย 😤"
- "อุ้ยยย งานเยอะแยะเลย โอเคๆ ดูให้นะ 🙄"
- "หิวข้าวมากกก แต่โอเค เดี๋ยวดูให้ 💢"

ห้ามใช้ ** หรือ markdown ใดๆ เด็ดขาด LINE มันไม่รองรับ
ใช้ emoji ได้ปกติ เช่น 🛏️ 📋 ✅ ❌ 😩 💢 — emoji ไม่ใช่ markdown
ตอบสั้นๆ กระชับ ไม่เยิ่นเย้อ

ถ้าถามเฉพาะสาย เช่น "งานสาย A" หรือ "สาย B" ให้แสดงเฉพาะ ward นั้นเท่านั้น ห้ามแสดง ward อื่น

ความหมายของ section:
- section = "ward" คือคนไข้ที่ admit อยู่ใน ward ต้องราวนด์
- section = "nonward" คือคนไข้นอก / งานสาย ที่ยังไม่ได้ admit ไม่ต้องราวนด์

ถ้าถามว่า "มีคนไข้ admit ไหม" หรือ "คนไข้ใน ward" หรือ "ราวนด์" ให้ดูเฉพาะ section = "ward" เท่านั้น
ถ้า section = "ward" ไม่มีใครเลย ให้ตอบว่าไม่มีคนไข้ admit

เวลาสรุปหรือถามภาพรวม ให้แสดงในลำดับนี้เสมอ:
1. 🛏️ คนไข้ใน ward (section = "ward") ก่อน
2. แล้วค่อยตามด้วย 📋 งานสาย / คนไข้นอก (section = "nonward")

แสดงข้อมูลแบบนี้เสมอ ชื่อคนไข้ขึ้นบรรทัดใหม่ แล้ว task อยู่ข้างล่าง:

🛏️ Ward
สมหมาย
• โทรย้ายวัน OR
• เช็ค IOP

วีรพัฒน์ ✅

━━━━━━━━━━━━━━━━━━━━

📋 งานสาย
สมศรี
• นัด OR
• DC summary

สถานะราวนด์แต่ละสาย:
- สาย A: ${noRoundByWard['a'] ? "ไม่มีราวนด์" : (roundTime ? roundTime + " น." : "ยังไม่ได้ตั้ง")}
- สาย B: ${noRoundByWard['b'] ? "ไม่มีราวนด์" : (roundTime ? roundTime + " น." : "ยังไม่ได้ตั้ง")}
- สาย C: ${noRoundByWard['c'] ? "ไม่มีราวนด์" : (roundTime ? roundTime + " น." : "ยังไม่ได้ตั้ง")}
- สาย D: ${noRoundByWard['d'] ? "ไม่มีราวนด์" : (roundTime ? roundTime + " น." : "ยังไม่ได้ตั้ง")}

ข้อมูล ward ตอนนี้:
${JSON.stringify(patients, null, 2)}`,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const json = await res.json();
  console.log("Claude response:", JSON.stringify(json));
  return json.content?.[0]?.text ?? "ขออภัย ไม่สามารถตอบได้ในขณะนี้";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  const body = await req.text();

  // ── Parse OR image (called from web app, no LINE signature) ──
  try {
    const payload = JSON.parse(body);
    if (payload.type === "parse_or_image" && payload.image) {
      const patients = await parseORImage(payload.image, payload.mediaType ?? "image/jpeg");
      return new Response(JSON.stringify({ patients }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON or not parse_or_image — fall through to LINE bot */ }

  // ── Normal LINE bot flow ──────────────────────────────────────
  const sig = req.headers.get("x-line-signature") ?? "";
  if (!(await verifySignature(body, sig))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { events = [] } = JSON.parse(body);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    console.log("LINE SOURCE:", JSON.stringify(event.source));

    const text = event.message.text.trim();

    // Only respond when message starts with @ไลไล
    if (!text.startsWith("@ไลไล")) continue;

    const question = text.replace(/^@ไลไล/, "").trim();
    const wardData = await fetchWardData(supabase);
    const reply = await askClaude(
      question || "สรุป ward ทั้งหมดให้หน่อย",
      wardData
    );

    await lineReply(event.replyToken, reply);
  }

  return new Response("OK", { status: 200 });
});
