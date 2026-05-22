import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const LINE_GROUP_ID = Deno.env.get("LINE_GROUP_ID")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

async function linePush(text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: LINE_GROUP_ID,
      messages: [{ type: "text", text }],
    }),
  });
  const json = await res.json();
  console.log("LINE push result:", JSON.stringify(json));
}

async function askClaude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: `คุณคือ AI สำหรับแจ้งเตือนในหอผู้ป่วยจักษุวิทยา
เขียนข้อความแจ้งเตือนสั้นๆ เป็นภาษาไทย 1 บรรทัด
ไม่ใช้ markdown ไม่เกิน 60 ตัวอักษร`,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const json = await res.json();
  return json.content?.[0]?.text ?? prompt;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const payload = await req.json();
    console.log("Webhook payload:", JSON.stringify(payload));

    const { type, table, record, old_record } = payload;

    if (table === "tasks" && type === "UPDATE") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", record.patient_id)
        .single();
      const patientName = patient?.name ?? "ไม่ทราบชื่อ";

      if (record?.done === true && old_record?.done === false) {
        await linePush(`${patientName}\n"${record.text}" เสร็จเรียบร้อยเจ้าค่ะ ✅`);
      }
      if (record?.done === false && old_record?.done === true) {
        await linePush(`${patientName}\n"${record.text}" มันยังไม่เสร็จ ❌`);
      }
    }

    if (table === "patients" && type === "DELETE") {
      const name = old_record?.name ?? "ไม่ทราบชื่อ";
      await linePush(`🏥 ผู้ป่วยชื่อ - ${name}\n• discharge แล้วเจ้าค่ะ ✅`);
    }

    if (table === "patients" && type === "CANCEL_DISCHARGE") {
      const name = old_record?.name ?? "ไม่ทราบชื่อ";
      await linePush(`↩️ ผู้ป่วยชื่อ - ${name}\n• ยกเลิก discharge แล้วเจ้าค่ะ`);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Error:", err);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
