import { NextRequest, NextResponse } from "next/server";
import { checkApiLimit } from "@/lib/log-api-usage";
import { isAdminRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const [anthropic, google] = await Promise.all([
    checkApiLimit("anthropic"),
    checkApiLimit("google"),
  ]);

  // Non-admin callers (the ApiLimitBanner on every page) only need the
  // warning state — the real dollar spend/limit figures are admin data.
  if (!isAdminRequest(req)) {
    const strip = ({ allowed, warningLevel, percentUsed }: typeof anthropic) => ({
      allowed,
      warningLevel,
      percentUsed,
    });
    return NextResponse.json({ anthropic: strip(anthropic), google: strip(google) });
  }

  return NextResponse.json({ anthropic, google });
}
