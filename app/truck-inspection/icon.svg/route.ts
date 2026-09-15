import { INSPECTION_ICON_SVG } from "@/lib/truck-inspection-icon";
export function GET() { return new Response(INSPECTION_ICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } }); }
