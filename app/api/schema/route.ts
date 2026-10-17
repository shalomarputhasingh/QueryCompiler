import { handleSchema } from "@/lib/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return handleSchema();
}
