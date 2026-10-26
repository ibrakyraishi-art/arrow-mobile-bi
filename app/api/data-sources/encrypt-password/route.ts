import { NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";
import { getAuthenticatedUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  password?: string;
}

/**
 * Принимает сырой пароль ClickHouse, возвращает зашифрованный блок
 * `iv:ciphertext`. Клиент сохраняет его в Supabase в `password_encrypted`.
 * Ключ шифрования (ENCRYPTION_KEY) живёт только на сервере.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Body;
    const raw = typeof body.password === "string" ? body.password : "";
    const encrypted = encrypt(raw);
    return NextResponse.json({ encrypted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
