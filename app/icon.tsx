import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export function OpsCenterAppIcon({ dimension }: { dimension: number }) {
  const scale = dimension / 64;
  const point = (value: number) => value * scale;
  const endpoint = (left: number, top: number) => ({
    position: "absolute" as const,
    left: point(left),
    top: point(top),
    width: point(7),
    height: point(7),
    border: `${point(2)}px solid #f5ca62`,
    borderRadius: "50%",
    background: "#151a21",
  });

  return (
    <div style={{ position: "relative", width: dimension, height: dimension, display: "flex", overflow: "hidden", borderRadius: point(17), background: "linear-gradient(145deg, #252a33, #0a0d12)", border: `${point(1.4)}px solid rgba(245, 202, 98, .42)` }}>
      {[
        [17, 24, 29], [17, 37, -29], [40, 24, -29], [40, 37, 29],
      ].map(([left, top, rotation]) => (
        <div key={`${left}-${top}`} style={{ position: "absolute", left: point(left), top: point(top), width: point(17), height: point(2.5), borderRadius: point(2), background: "#f5ca62", transform: `rotate(${rotation}deg)`, transformOrigin: "left center" }} />
      ))}
      <div style={endpoint(10.5, 18)} /><div style={endpoint(10.5, 39)} />
      <div style={endpoint(46.5, 18)} /><div style={endpoint(46.5, 39)} />
      <div style={{ position: "absolute", left: point(21), top: point(20.5), width: point(22), height: point(22), display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(145deg, #ff4b51, #d90d1d)", border: `${point(2)}px solid #f8d274`, transform: "rotate(45deg)" }}>
        <div style={{ width: point(14), height: point(14), display: "flex", alignItems: "center", justifyContent: "center", border: `${point(1.5)}px solid #fff0b1`, borderRadius: "50%", background: "#10141b", transform: "rotate(-45deg)" }}>
          <div style={{ width: point(3), height: point(3), borderRadius: "50%", background: "#f8d274", boxShadow: `0 0 ${point(4)}px #f8d274` }} />
        </div>
      </div>
    </div>
  );
}

export default function Icon() {
  return new ImageResponse(<OpsCenterAppIcon dimension={size.width} />, { ...size });
}
