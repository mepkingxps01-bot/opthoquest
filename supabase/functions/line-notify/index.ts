import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;

const WARD_GROUP_IDS: Record<string, string> = {
  a: Deno.env.get("LINE_GROUP_ID_A") ?? "",
  b: Deno.env.get("LINE_GROUP_ID_B") ?? "",
  c: Deno.env.get("LINE_GROUP_ID_C") ?? "",
  d: Deno.env.get("LINE_GROUP_ID_D") ?? "",
};

async function linePush(text: string, ward: string) {
  const groupId = WARD_GROUP_IDS[ward.toLowerCase()];
  if (!groupId) {
    console.warn(`No LINE group configured for ward: ${ward}`);
    return;
  }
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
  console.log(`LINE push to ward ${ward.toUpperCase()} (${groupId}):`, JSON.stringify(json));
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
        await linePush(`${wardLabel}\n\n${patientName}\n• "${record.text}" เสร็จเรียบร้อยเจ้าค่ะ ✅`, ward);
      }
      if (record?.done === false && old_record?.done === true) {
        await linePush(`${wardLabel}\n\n${patientName}\n• "${record.text}" มันยังไม่เสร็จ ❌`, ward);
      }
    }

    if (table === "patients" && type === "DELETE") {
      const name = old_record?.name ?? "ไม่ทราบชื่อ";
      const ward = (old_record?.ward ?? "a").toLowerCase();
      const emoji = wardEmoji[ward] ?? "🏥";
      await linePush(`${emoji} งานสาย ${ward.toUpperCase()} ${emoji}\n\n${name}\n• discharge แล้วเจ้าค่ะ ✅`, ward);
    }

    if (type === "ROUND") {
      const time = old_record?.time ?? "??:??";
      const ward = (old_record?.ward ?? "a").toLowerCase();
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: patients } = await supabase.from("patients").select("*").order("created_at");
      const { data: tasks } = await supabase.from("tasks").select("*").order("created_at");

      const wardEmojis: Record<string, string> = { a:"🔵", b:"🟢", c:"🟡", d:"🔴" };
      const e = wardEmojis[ward] ?? "🏥";

      // Only patients in this specific ward (ward section = admitted)
      const wardPts = (patients ?? []).filter((p: any) =>
        p.section !== "nonward" && (p.ward ?? "a").toLowerCase() === ward
      );

      let msg = `${e} สาย ${ward.toUpperCase()} ${e}\n`;
      msg += `🕐 เวลาราวน์ : ${time}\n\n`;

      if (wardPts.length === 0) {
        msg += `ไม่มีคนไข้ admit เจ้าค่ะ\n\n`;
      } else {
        wardPts.forEach((p: any, i: number) => {
          const pending = (tasks ?? []).filter((t: any) => t.patient_id === p.id && !t.done);
          msg += `${i + 1}. ${p.name}`;
          msg += pending.length > 0 ? ` (${pending.length} งานค้าง)\n` : ` ✅\n`;
        });
        msg += `\n`;
      }

      msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `📋 งานที่เหลือค้างในสาย\n`;

      // Non-ward patients for this ward only
      const nonWardPts = (patients ?? []).filter((p: any) =>
        p.section === "nonward" && (p.ward ?? "a").toLowerCase() === ward
      );
      const nonWardWithTasks = nonWardPts.filter((p: any) =>
        (tasks ?? []).some((t: any) => t.patient_id === p.id && !t.done)
      );

      if (nonWardWithTasks.length === 0) {
        msg += `ไม่มีงานค้าง เจ้าค่ะ 🎉`;
      } else {
        nonWardWithTasks.forEach((p: any) => {
          const pending = (tasks ?? []).filter((t: any) => t.patient_id === p.id && !t.done);
          msg += `• ${p.name}\n`;
          pending.forEach((t: any) => { msg += `  - ${t.text}\n`; });
        });
      }

      await linePush(msg.trim(), ward);
    }

    if (table === "patients" && type === "CANCEL_DISCHARGE") {
      const name = old_record?.name ?? "ไม่ทราบชื่อ";
      const ward = (old_record?.ward ?? "a").toLowerCase();
      const emoji = wardEmoji[ward] ?? "🏥";
      await linePush(`${emoji} งานสาย ${ward.toUpperCase()} ${emoji}\n\n${name}\n• ยกเลิก discharge แล้วเจ้าค่ะ ↩️`, ward);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Error:", err);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
