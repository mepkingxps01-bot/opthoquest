import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// ── Line helpers ────────────────────────────────────────────────

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

// ── Data fetching ───────────────────────────────────────────────

async function fetchWardData(supabase: ReturnType<typeof createClient>) {
  const [{ data: patients }, { data: tasks }] = await Promise.all([
    supabase.from("patients").select("*").order("created_at"),
    supabase.from("tasks").select("*").order("created_at"),
  ]);

  return (patients ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    ward: p.ward ?? "a",
    section: p.section ?? "ward",
    tasks: (tasks ?? [])
      .filter((t: any) => t.patient_id === p.id)
      .map((t: any) => ({ text: t.text, done: t.done })),
  }));
}

// ── Claude ──────────────────────────────────────────────────────

async function askClaude(userMessage: string, wardData: any[]): Promise<string> {
  const context = JSON.stringify(wardData, null, 2);

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
      system: `You are the AI assistant for "Ophtho Ward Quest", an ophthalmology ward management app.
You have real-time access to ward data below. Reply concisely — this is a Line chat message.
Keep responses under 300 words. Use bullet points for lists. No markdown headers.
If the user writes Thai, reply Thai. If English, reply English.
Wards are A, B, C, D. Each patient has tasks (done/pending) and a section (ward or nonward).

Current ward data:
${context}`,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const json = await res.json();
  return json.content?.[0]?.text ?? "Sorry, I could not generate a response.";
}

// ── Built-in commands ───────────────────────────────────────────

function buildHelp(): string {
  return `🏥 Ophtho Ward Quest AI

Commands:
• summary — สรุปทุก ward
• ward a / ward b / ward c / ward d — สรุป ward นั้น
• pending — งานค้างทั้งหมด
• handover — รายงาน handover ครบ
• หรือถามอะไรก็ได้ เช่น "ward a มีกี่คน?"

Powered by Claude AI 🤖`;
}

function buildSummary(wardData: any[]): string {
  const wards = ["a", "b", "c", "d"];
  let out = "🏥 Ward Summary\n";
  for (const w of wards) {
    const pts = wardData.filter((p) => (p.ward ?? "a") === w);
    if (pts.length === 0) continue;
    const pending = pts.reduce(
      (acc, p) => acc + p.tasks.filter((t: any) => !t.done).length,
      0
    );
    const done = pts.reduce(
      (acc, p) => acc + p.tasks.filter((t: any) => t.done).length,
      0
    );
    out += `\nWard ${w.toUpperCase()} — ${pts.length} patient${pts.length !== 1 ? "s" : ""}\n`;
    out += `  ✅ ${done} done  ⏳ ${pending} pending\n`;
    pts.forEach((p) => {
      const pend = p.tasks.filter((t: any) => !t.done).length;
      out += `  • ${p.name}${pend > 0 ? ` (${pend} tasks left)` : " ✓"}`;
      out += "\n";
    });
  }
  if (out === "🏥 Ward Summary\n") out += "\nNo patients currently admitted.";
  return out.trim();
}

function buildPending(wardData: any[]): string {
  let out = "⏳ Pending Tasks\n";
  let found = false;
  for (const p of wardData) {
    const pend = p.tasks.filter((t: any) => !t.done);
    if (pend.length === 0) continue;
    found = true;
    out += `\n[Ward ${(p.ward ?? "a").toUpperCase()}] ${p.name}\n`;
    pend.forEach((t: any) => (out += `  • ${t.text}\n`));
  }
  if (!found) out += "\nNo pending tasks 🎉";
  return out.trim();
}

// ── Main handler ────────────────────────────────────────────────

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
    const lower = text.toLowerCase();
    const replyToken = event.replyToken;

    // Log group/user ID so operator can find it
    console.log("LINE SOURCE:", JSON.stringify(event.source));

    const wardData = await fetchWardData(supabase);
    let reply = "";

    if (lower === "help" || lower === "ช่วย") {
      reply = buildHelp();
    } else if (lower === "summary" || lower === "สรุป") {
      reply = buildSummary(wardData);
    } else if (lower === "pending" || lower === "งานค้าง") {
      reply = buildPending(wardData);
    } else if (/^ward\s+[abcd]$/i.test(lower)) {
      const w = lower.split(/\s+/)[1];
      const pts = wardData.filter((p) => (p.ward ?? "a") === w);
      reply = await askClaude(
        `Summarize Ward ${w.toUpperCase()} with all patients and their task status. Be concise.`,
        pts.length ? pts : wardData
      );
    } else if (lower === "handover" || lower === "handover report") {
      reply = await askClaude(
        "Generate a complete shift handover report for all wards. Include each patient, ward, and any pending tasks. Format clearly for a medical handover.",
        wardData
      );
    } else {
      // Free-form AI question
      reply = await askClaude(text, wardData);
    }

    await lineReply(replyToken, reply);
  }

  return new Response("OK", { status: 200 });
});
