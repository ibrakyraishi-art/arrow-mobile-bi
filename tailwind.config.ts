import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        // Отдельного дисплейного шрифта нет — заголовки тем же Onest.
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        // Фирменный синий Arrow (#1F5BFF). Оставлен под `brand-*`, чтобы
        // прежние классы (brand-400 / brand-500 / ...) перекрасились сами.
        // 400–600 зависят от темы (CSS-переменные), остальные — фиксированные.
        brand: {
          50: "#eef3ff",
          100: "#dbe5ff",
          200: "#b8caff",
          300: "#8aa7ff",
          400: "hsl(var(--brand-400) / <alpha-value>)",
          500: "hsl(var(--brand-500) / <alpha-value>)",
          600: "hsl(var(--brand-600) / <alpha-value>)",
          700: "#1238a6",
          800: "#0f2c80",
          900: "#343447",
          950: "#1a1a24",
        },
        // Ховер/глубокий оттенок акцента
        iris: {
          DEFAULT: "var(--accent-bright)",
          bright: "var(--accent-bright)",
          deep: "var(--accent-deep)",
        },
        // Дополнительные тонкие рамки / бледный текст
        hair: {
          2: "var(--border-2)",
          3: "var(--border-3)",
        },
        faint: "var(--text-faint)",
        // Палитра графиков — из токенов темы
        chart: {
          1: "hsl(var(--chart-1) / <alpha-value>)",
          2: "hsl(var(--chart-2) / <alpha-value>)",
          3: "hsl(var(--chart-3) / <alpha-value>)",
          4: "hsl(var(--chart-4) / <alpha-value>)",
          5: "hsl(var(--chart-5) / <alpha-value>)",
          6: "hsl(var(--chart-6) / <alpha-value>)",
          7: "hsl(var(--chart-7) / <alpha-value>)",
          8: "hsl(var(--chart-8) / <alpha-value>)",
        },
        // Градиент плиток-акцентов (from-grad-from to-grad-to)
        grad: {
          from: "hsl(var(--grad-from) / <alpha-value>)",
          to: "hsl(var(--grad-to) / <alpha-value>)",
          foreground: "hsl(var(--grad-foreground) / <alpha-value>)",
        },
        // Затемнение под модалками
        overlay: "hsl(var(--overlay) / <alpha-value>)",
        // Светофор выполнения плана
        ok: "hsl(var(--ok) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
        bad: "hsl(var(--bad) / <alpha-value>)",
        // Совместимость: прежние spectrum-* смотрят на палитру графиков
        spectrum: {
          violet: "hsl(var(--chart-3) / <alpha-value>)",
          blue: "hsl(var(--chart-1) / <alpha-value>)",
          cyan: "hsl(var(--chart-7) / <alpha-value>)",
          teal: "hsl(var(--ok) / <alpha-value>)",
          lime: "hsl(var(--chart-6) / <alpha-value>)",
          amber: "hsl(var(--warn) / <alpha-value>)",
          pink: "hsl(var(--chart-5) / <alpha-value>)",
        },
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "glow-accent":
          "0 0 0 1px hsl(var(--grad-from) / 0.6), 0 8px 40px -8px hsl(var(--grad-to) / 0.55)",
      },
      // Минимальные скругления arwm: 2–4px. xl/2xl тоже сжаты, чтобы прежние
      // классы rounded-xl / rounded-2xl не давали «пухлых» карточек.
      borderRadius: {
        "2xl": "var(--radius)",
        xl: "var(--radius)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 1px)",
        sm: "calc(var(--radius) - 2px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        glow: {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.25s ease-out",
        shimmer: "shimmer 2.5s linear infinite",
        "gradient-x": "gradient-x 6s ease infinite",
        glow: "glow 2.5s ease-in-out infinite",
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(to right, hsl(var(--border) / 0.4) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.4) 1px, transparent 1px)",
        "dot-pattern":
          "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
