import { ImageResponse } from "next/og";
import { ARROW_PATH } from "@/components/layout/ArrowLogo";

// `edge` runtime avoids a Windows-only @vercel/og path-to-URL bug that
// otherwise crashes `next build` during static prerender.
export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Arrow Mobile: белая стрелка «↗» на плитке-градиенте сирень #E4A5FD →
// #A663B9 → коралл #FF6751 (история 6). Геометрия — ARROW_PATH из ArrowLogo.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "linear-gradient(135deg, #E4A5FD, #A663B9 55%, #FF6751)",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d={ARROW_PATH} fill="#FFFFFF" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
