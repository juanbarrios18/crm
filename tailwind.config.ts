import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Los nombres semánticos existentes (background, primary, muted…) se remapean
 * a los tokens del sistema Atlas para que toda la app comparta el tema claro;
 * la escala `brand-*` expone el acento white-label.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        input: "var(--border-strong)",
        ring: "var(--accent)",
        background: "var(--bg)",
        foreground: "var(--text)",
        subtle: "var(--bg-subtle)",
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "var(--bg-panel)",
          foreground: "var(--text-2)",
        },
        destructive: {
          DEFAULT: "var(--danger)",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--bg-panel)",
          foreground: "var(--text-3)",
        },
        accent: {
          DEFAULT: "var(--bg-hover)",
          foreground: "var(--text)",
        },
        card: {
          DEFAULT: "var(--bg)",
          foreground: "var(--text)",
        },
        popover: {
          DEFAULT: "var(--bg)",
          foreground: "var(--text)",
        },
        brand: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
          tint: "var(--accent-tint)",
          text: "var(--accent-text)",
        },
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        "text-4": "var(--text-4)",
        // Web pública (007): paleta cálida propia, scopeada bajo `.site` para no
        // pelear con el tema Atlas ni con el acento white-label del CRM.
        // Se declaran con `<alpha-value>` para que los modificadores de opacidad
        // (`bg-site-panel/95`) funcionen: con un `var()` plano Tailwind los
        // ignora en silencio y el fondo queda transparente.
        site: {
          bg: "rgb(var(--site-bg-rgb) / <alpha-value>)",
          panel: "rgb(var(--site-panel-rgb) / <alpha-value>)",
          topbar: "rgb(var(--site-topbar-rgb) / <alpha-value>)",
          text: "rgb(var(--site-text-rgb) / <alpha-value>)",
          muted: "rgb(var(--site-muted-rgb) / <alpha-value>)",
          accent: "rgb(var(--site-accent-rgb) / <alpha-value>)",
          "accent-hover": "rgb(var(--site-accent-hover-rgb) / <alpha-value>)",
          border: "rgb(var(--site-border-rgb) / <alpha-value>)",
        },
        chat: "var(--chat-bg)",
        "bubble-out": "var(--bubble-out)",
        "bubble-out-text": "var(--bubble-out-text)",
        success: "var(--success)",
        warning: "var(--warning)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        pop: "var(--shadow-pop)",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "Hanken Grotesk", "-apple-system", "sans-serif"],
        // Titulares de la web pública: serif con más carácter, self-hosted.
        display: ["var(--font-display)", "Georgia", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [animate],
};

export default config;
