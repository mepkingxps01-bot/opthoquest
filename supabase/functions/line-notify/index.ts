import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const LINE_GROUP_ID = Deno.env.get("LINE_GROUP_ID")!;

async function linePush(text: string) {
  const groupIds = LINE_GROUP_ID.split(',').map(id => id.trim()).filter(Boolean);
  for (const groupId of groupIds) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text }],
      }),
    });
    const json = await res.json();
    console.log(`LINE push to ${groupId}:`, JSON.stringify(json));
  }
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

    const wardEmoji: Record<string, string> = { a:"🔵", b:"🟢", c:"🟡", d:"🔴" };

    if (table === "tasks" && type === "UPDATE") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: patient } = await supabase
        .from("patients")
        .select("name, ward")
        .eq("id", record.patient_id)
        .single();
      const patientName = patient?.name ?? "ไม่ทราบชื่อ";
      const ward = (patient?.ward ?? "a").toLowerCase();
      const emoji = wardEmoji[ward] ?? "🏥";
      const wardLabel = `${emoji} งานสาย ${ward.toUpperCase()} ${emoji}`;

      if (record?.done === true && old_record?.done === false) {
        await linePush(`${wardLabel}\n\n${patientName}\n• "${record.text}" เสร็จเรียบร้อยเจ้าค่ะ ✅`);
      }
      if (record?.done === false && old_record?.done === true) {
        await linePush(`${wardLabel}\n\n${patientName}\n• "${record.text}" มันยังไม่เสร็จ ❌`);
      }
    }

    if (table === "patients" && type === "DELETE") {
      const name = old_record?.name ?? "ไม่ทราบชื่อ";
      const ward = (old_record?.ward ?? "a").toLowerCase();
      const emoji = wardEmoji[ward] ?? "🏥";
      await linePush(`${emoji} งานสาย ${ward.toUpperCase()} ${emoji}\n\n${name}\n• discharge แล้วเจ้าค่ะ ✅`);
    }

    if (table === "patients" && type === "CANCEL_DISCHARGE") {
      const name = old_record?.name ?? "ไม่ทราบชื่อ";
      const ward = (old_record?.ward ?? "a").toLowerCase();
      const emoji = wardEmoji[ward] ?? "🏥";
      await linePush(`${emoji} งานสาย ${ward.toUpperCase()} ${emoji}\n\n${name}\n• ยกเลิก discharge แล้วเจ้าค่ะ ↩️`);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Error:", err);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
