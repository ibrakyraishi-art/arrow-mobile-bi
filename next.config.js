/** @type {import('next').NextConfig} */

// Content-Security-Policy (Report-Only на старте — не ломает приложение, только
// репортит нарушения). Supabase нужен в connect-src по https и wss.
// ВАЖНО: api.telegram.org здесь НЕ нужен — обращения к Telegram идут только
// с сервера (route handlers), не из браузера.
const cspReportOnly = [
  "default-src 'self'",
  // Next.js inline/eval для рантайма и dev; в проде Next использует nonce/inline.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  // HSTS: форсируем HTTPS на 2 года, включая поддомены.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // CSP в режиме Report-Only — наблюдаем, не блокируем. Переключим на
  // Content-Security-Policy (enforce) после проверки отчётов.
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig = {
  reactStrictMode: true,
  // Убираем X-Powered-By: Next — не раскрываем стек.
  poweredByHeader: false,
  experimental: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
