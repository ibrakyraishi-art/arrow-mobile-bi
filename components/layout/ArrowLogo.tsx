import { useId } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Бренд Arrow Mobile. Знак — жирная стрелка «↗» с градиентной заливкой
 * сирень #E4A5FD → сирень #A663B9 → коралл #FF6751 (палитра arwm.ru).
 * Wordmark — «ARROW MOBILE», жирный плотный гротеск в духе логотипа ARWM.
 */

/** Геометрия стрелки в системе координат 24×24 (используется и в иконках). */
export const ARROW_PATH =
  "M6 3H21V18H17V9.83L5.41 21.41L2.59 18.59L14.17 7H6V3Z";

export function ArrowMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const gid = `arrow-grad-${useId().replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E4A5FD" />
          <stop offset="0.5" stopColor="#A663B9" />
          <stop offset="1" stopColor="#FF6751" />
        </linearGradient>
      </defs>
      <path d={ARROW_PATH} fill={`url(#${gid})`} />
    </svg>
  );
}

export function ArrowWordmark({
  tagline = false,
  className,
}: {
  tagline?: boolean;
  className?: string;
}) {
  // BRAND_NAME = «Arrow Mobile» → «ARROW» жирным, «MOBILE» приглушённо.
  const [first, ...rest] = BRAND_NAME.toUpperCase().split(" ");
  return (
    <div className={cn("flex flex-col leading-none", className)}>
      <span className="whitespace-nowrap text-[15px] font-extrabold uppercase tracking-[-0.01em] text-foreground">
        {first}
        {rest.length > 0 && (
          <span className="ml-1 font-extrabold text-muted-foreground">
            {rest.join(" ")}
          </span>
        )}
      </span>
      {tagline && (
        <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
          media intelligence
        </span>
      )}
    </div>
  );
}

/** Знак + wordmark в одну строку (для сайдбара/хедера/авторизации). */
export function ArrowBrand({
  size = 32,
  tagline = false,
}: {
  size?: number;
  tagline?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <ArrowMark size={size} />
      <ArrowWordmark tagline={tagline} />
    </div>
  );
}
