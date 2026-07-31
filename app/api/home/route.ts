import { NextResponse } from "next/server";
import { getRuntimeHomeDirectory } from "@/lib/runtime-home";

export async function GET() {
  return NextResponse.json({ home: getRuntimeHomeDirectory() });
}
