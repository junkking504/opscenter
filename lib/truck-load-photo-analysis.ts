import fs from "node:fs";
import path from "node:path";

export type TruckLoadPhotoAnalysis = {
  loadFraction: number;
  loadLabel: string;
  contents: string;
  confidence: number;
  visibleEnough: boolean;
  notes: string;
  model: string;
};

const LOAD_FRACTIONS: Record<string, number> = {
  empty: 0,
  minimum: 1 / 12,
  "1/8": 1 / 8,
  "1/6": 1 / 6,
  "1/4": 1 / 4,
  "1/3": 1 / 3,
  "3/8": 3 / 8,
  "1/2": 1 / 2,
  "5/8": 5 / 8,
  "2/3": 2 / 3,
  "3/4": 3 / 4,
  "7/8": 7 / 8,
  full: 1,
};

function clean(value: unknown, maximum = 500): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function outputText(payload: Record<string, unknown>): string {
  const direct = clean(payload.output_text, 10_000);
  if (direct) return direct;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (String((part as { type?: unknown }).type) !== "output_text") continue;
      const text = clean((part as { text?: unknown }).text, 10_000);
      if (text) return text;
    }
  }
  return "";
}

export async function analyzeTruckLoadPhoto(filePath: string): Promise<TruckLoadPhotoAnalysis> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey.startsWith("sk-") || apiKey.length < 20) throw new Error("OpenAI truck-photo analysis is not configured.");
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "";
  if (!mimeType) throw new Error("Truck-photo analysis supports JPEG and PNG images only.");
  const image = fs.readFileSync(filePath);
  if (!image.length || image.length > 5 * 1024 * 1024) throw new Error("The truck photo must be between 1 byte and 5 MB.");

  const model = clean(process.env.OPSBOT_TRUCK_VISION_MODEL || "gpt-5.4-mini", 80);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: [
        "You estimate how much of a Junk King box truck's usable cargo volume is occupied.",
        "Judge volume, not visible floor area. Be conservative when the bed walls, floor, or load depth are obscured.",
        "Identify broad operational contents such as junk, metal, furniture, appliances, construction debris, or yard debris.",
        "Set visible_enough false when the cargo area is not clearly shown. Do not identify people or infer sensitive traits.",
      ].join(" "),
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "Estimate this truck's current fullness and summarize its visible contents. This is advisory only and a human will confirm it." },
          { type: "input_image", image_url: `data:${mimeType};base64,${image.toString("base64")}`, detail: "high" },
        ],
      }],
      max_output_tokens: 400,
      text: {
        format: {
          type: "json_schema",
          name: "truck_load_photo_estimate",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["load_label", "contents", "confidence", "visible_enough", "notes"],
            properties: {
              load_label: { type: "string", enum: Object.keys(LOAD_FRACTIONS) },
              contents: { type: "string", maxLength: 300 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              visible_enough: { type: "boolean" },
              notes: { type: "string", maxLength: 300 },
            },
          },
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const apiError = payload.error && typeof payload.error === "object"
      ? clean((payload.error as { message?: unknown }).message, 240)
      : "";
    throw new Error(apiError || `OpenAI truck-photo analysis failed (${response.status}).`);
  }
  const text = outputText(payload);
  if (!text) throw new Error("OpenAI returned no truck-photo estimate.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned an unreadable truck-photo estimate.");
  }
  const loadLabel = clean(parsed.load_label, 20).toLowerCase();
  const loadFraction = LOAD_FRACTIONS[loadLabel];
  const confidence = Number(parsed.confidence);
  if (loadFraction === undefined || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("OpenAI returned an invalid truck-photo estimate.");
  }
  return {
    loadFraction,
    loadLabel,
    contents: clean(parsed.contents) || "Contents unclear",
    confidence,
    visibleEnough: parsed.visible_enough === true,
    notes: clean(parsed.notes),
    model,
  };
}
