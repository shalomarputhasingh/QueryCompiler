import { handleChat, handleChatStatus } from "@/lib/api/chat-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Quera may legitimately wait for a provider quota window to reset, so allow a long-lived stream. */
export const maxDuration = 300;

export function GET(): Response {
  return handleChatStatus();
}

export function POST(req: Request): Promise<Response> {
  return handleChat(req);
}
