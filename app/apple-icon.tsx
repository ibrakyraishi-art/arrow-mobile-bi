import { ImageResponse } from "next/og";
import { ARROW_PATH } from "@/components/layout/ArrowLogo";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Arrow Mobile: белая стрелка «↗» на плитке-градиенте сирень → коралл
// (история 6). Геометрия — ARROW_PATH из ArrowLogo.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "linear-gradient(135deg, #E4A5FD, #A663B9 55%, #FF6751)",
          borderRadius: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none">
          <path d={ARROW_PATH} fill="#FFFFFF" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
