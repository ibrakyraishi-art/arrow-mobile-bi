import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let browserClient: SupabaseClient | null = null;

// Singleton browser client. `@supabase/ssr` transparently syncs the session
// with cookies/localStorage so the same instance works across the whole SPA.
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase не сконфигурирован: задайте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return browserClient;
}

export type UserRole = "admin" | "analyst" | "buyer" | "manager";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  company: string | null;
  created_at: string;
  updated_at: string;
}
