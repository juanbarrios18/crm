import type { MetadataRoute } from "next";

// 006 — Manifest de la PWA (instalable). Colores fijos: el tema es claro
// (globals.css) con acento default #3f5972; el white-label por organización
// sigue aplicando dentro de la app (el manifest es estático).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vocero CRM",
    short_name: "Vocero",
    description: "CRM de WhatsApp con agente de IA",
    start_url: "/inbox",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3f5972",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
