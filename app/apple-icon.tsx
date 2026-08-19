import { ImageResponse } from "next/og";
import { OpsCenterAppIcon } from "./icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<OpsCenterAppIcon dimension={size.width} />, { ...size });
}
