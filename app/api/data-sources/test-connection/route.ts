import { NextResponse } from "next/server";
import { testConnection, type Credentials } from "@/lib/clickhouse";
import { getAuthenticatedUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body extends Partial<Credentials> {}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Body;
    if (!body.host || !body.database || !body.user) {
      return NextResponse.json(
        { success: false, error: "Укажите host, database и user" },
        { status: 400 },
      );
    }
    const res = await testConnection({
      host: body.host,
      port: Number(body.port ?? 8443),
      database: body.database,
      user: body.user,
      password: body.password ?? "",
      ssl: Boolean(body.ssl ?? true),
    });
    if (res.ok) return NextResponse.json({ success: true });
    return NextResponse.json(
      { success: false, error: res.error },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
