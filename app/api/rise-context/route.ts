import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const content = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf-8");
  return NextResponse.json({ content });
}
