import { NextResponse } from "next/server";
import { checkApiLimit } from "@/lib/log-api-usage";

export async function GET() {
  const [anthropic, google] = await Promise.all([
    checkApiLimit("anthropic"),
    checkApiLimit("google"),
  ]);

  return NextResponse.json({ anthropic, google });
}
