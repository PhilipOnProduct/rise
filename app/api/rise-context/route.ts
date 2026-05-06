import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // CLAUDE.md is the internal product/strategy doc. Treat it as admin-only.
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const content = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf-8");
  return NextResponse.json({ content });
}
