import type { ReactNode } from "react";
import { ArrowMark, ArrowWordmark } from "@/components/layout/ArrowLogo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-3">
        <ArrowMark size={40} />
        <ArrowWordmark className="[&>span:first-child]:text-xl" />
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
