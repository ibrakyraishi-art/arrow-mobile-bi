import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRICE_INPUT = 3;
const PRICE_OUTPUT = 15;

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      inputText: string;
      expectedOutputTokens?: number;
    };
    const inputTokens = Math.ceil(body.inputText.length / 3.5);
    const outputTokens = body.expectedOutputTokens ?? 2000;
    const cost =
      (inputTokens / 1_000_000) * PRICE_INPUT +
      (outputTokens / 1_000_000) * PRICE_OUTPUT;
    return NextResponse.json({
      inputTokens,
      outputTokens,
      cost: Number(cost.toFixed(6)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
