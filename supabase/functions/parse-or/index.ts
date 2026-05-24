import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (!text) return new Response(JSON.stringify({ patients: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: `You extract patient data from an OR (Operating Room) schedule table.
Return ONLY a valid JSON array — no explanation, no markdown, no extra text.
Each item must have exactly these fields:
  "name"      — Patient's full name exactly as shown
  "hn"        — HN number (hospital number) as a string
  "operation" — Proposed Op / operation to be performed

Skip any header rows. Include every patient row you find.
Example output: [{"name":"นายสมชาย ใจดี","hn":"1234567","operation":"Phaco + IOL, RE"}]`,
        messages: [{ role: "user", content: text }],
      }),
    });

    const json = await res.json();
    const raw = json.content?.[0]?.text?.trim() ?? "[]";

    let patients: { name: string; hn: string; operation: string }[] = [];
    try {
      patients = JSON.parse(raw);
    } catch {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) patients = JSON.parse(match[0]);
    }

    return new Response(JSON.stringify({ patients }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ patients: [], error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
