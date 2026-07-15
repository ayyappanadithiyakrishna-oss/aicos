import { generateDebate } from "@/lib/committeeLive";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* GET /api/committee?ticker=NVDA  (Server-Sent Events)
   Streams the committee meeting: meta → line* → scores → decision → done.
   The client controls typing pace; the server controls the order and timing
   of arrivals so the room feels alive whether the debate is Claude-generated
   or the deterministic fallback. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "NVDA").toUpperCase().trim();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      try {
        const debate = await generateDebate(ticker);

        send("meta", {
          ticker: debate.ticker,
          company: debate.company,
          live: debate.live,
        });

        for (const line of debate.lines) {
          send("line", line);
          // brief beat between speakers; the client types each line out
          await wait(line.kind === "ruling" ? 250 : 120);
        }

        send("scores", debate.scores);
        send("decision", debate.decision);
        send("done", { ok: true });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "stream failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
