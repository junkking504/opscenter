import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpsCenter | Junk King | Louisiana",
    short_name: "OpsCenter",
    description: "Operations workspace for Junk King Louisiana",
    display: "standalone",
    background_color: "#0a0d12",
    theme_color: "#0a0d12",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
