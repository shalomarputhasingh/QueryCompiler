import { handleAnalyze } from "@/lib/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleAnalyze(req);
}
