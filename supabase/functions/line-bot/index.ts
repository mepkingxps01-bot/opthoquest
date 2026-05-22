import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

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
  const [{ data: patients }, { data: tasks }] = await Promise.all([
    supabase.from("patients").select("*").order("created_at"),
    supabase.from("tasks").select("*").order("created_at"),
  ]);

  return (patients ?? []).map((p: any) => ({
    name: p.name,
    ward: p.ward ?? "A",
    tasks: (tasks ?? [])
      .filter((t: any) => t.patient_id === p.id)
      .map((t: any) => ({ text: t.text, done: t.done })),
  }));
}

async function askClaude(userMessage: string, wardData: any[]): Promise<string> {
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
      system: `คุณคือ AI assistant สำหรับแอป "Ophtho Ward Quest" ที่ใช้ในหอผู้ป่วยจักษุวิทยา
ตอบเป็นภาษาไทยเสมอ ตอบสั้นกระชับ นี่คือข้อความใน LINE กลุ่ม
ไม่เกิน 300 คำ ใช้ bullet points สำหรับรายการ ไม่ต้องใช้ markdown headers
แต่ละผู้ป่วยมี tasks ที่ทำแล้ว (done) และยังไม่ทำ (pending)

ข้อมูล ward ปัจจุบัน:
${JSON.stringify(wardData, null, 2)}`,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const json = await res.json();
  console.log("Claude response:", JSON.stringify(json));
  return json.content?.[0]?.text ?? "ขออภัย ไม่สามารถตอบได้ในขณะนี้";
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  const body = await req.text();
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
