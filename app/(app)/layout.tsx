import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { StoreSync } from "@/components/auth/StoreSync";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <StoreSync>
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
      </StoreSync>
    </ProtectedRoute>
  );
}
