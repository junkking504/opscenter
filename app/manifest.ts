import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Junk King Louisiana OpsCenter",
    short_name: "OpsCenter",
    description: "Live operations workspace for Junk King Louisiana.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07090d",
    theme_color: "#07090d",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/opscenter-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/opscenter-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/opscenter-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Schedule",
        short_name: "Schedule",
        description: "Open today’s schedule and dispatch board.",
        url: "/jobs",
        icons: [{ src: "/icons/opscenter-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Fleet",
        short_name: "Fleet",
        description: "Open live fleet operations.",
        url: "/fleet",
        icons: [{ src: "/icons/opscenter-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
