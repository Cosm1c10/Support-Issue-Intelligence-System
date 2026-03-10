import { NextResponse } from "next/server";

interface TicketInput {
  subject: string;
  description?: string;
  priority?: string;
}

/* ── Realistic mock summaries keyed by rough cluster theme ── */
const MOCK_SUMMARIES: { keywords: string[]; summary: string }[] = [
  {
    keywords: ["setup", "install", "onboard", "configuration", "start"],
    summary:
      "Tickets consistently reveal that users are blocked during first-time device registration due to a mismatch between the bundled firmware version and the latest desktop client requirements. The root cause is a production release gap where hardware units shipped without the v2.4 firmware pre-loaded, causing the setup wizard to stall at the pairing step.",
  },
  {
    keywords: ["crash", "freeze", "unresponsive", "black screen", "force quit"],
    summary:
      "A recurring memory leak introduced in the v3.1.2 application update is causing the process to exceed its 512 MB heap limit after approximately 45 minutes of continuous use, triggering a fatal exception. The issue is isolated to devices running macOS 14.3+ where the new graphics compositor conflicts with the legacy rendering pipeline.",
  },
  {
    keywords: ["network", "connectivity", "offline", "disconnect", "wifi", "internet"],
    summary:
      "Customers are experiencing intermittent disconnection events traced to an aggressive Wi-Fi sleep policy introduced in the recent firmware update that drops the connection after 90 seconds of low data-rate activity. The underlying cause is an incorrect DTIM interval setting (set to 10 instead of 1) that causes the router to stop buffering packets for the device.",
  },
  {
    keywords: ["login", "auth", "password", "sign in", "account", "token", "session"],
    summary:
      "An expired OAuth token rotation policy is causing users to be silently logged out every 24 hours without re-authentication prompts, which is particularly impacting enterprise SSO customers whose IdP tokens have a shorter-than-default TTL. The fix requires updating the token refresh logic to honour the IdP-provided `expires_in` field rather than the hardcoded 86,400-second default.",
  },
  {
    keywords: ["billing", "payment", "charge", "invoice", "subscription", "refund"],
    summary:
      "Duplicate billing events are being generated when customers update their payment method within the same billing cycle, caused by a race condition between the webhook processor and the subscription scheduler that fires two `invoice.created` events in under 200 ms. Idempotency key handling is missing on the `/update-payment` endpoint, allowing the downstream payment processor to charge the card twice.",
  },
  {
    keywords: ["data", "sync", "lost", "missing", "backup", "save", "restore"],
    summary:
      "Data loss is occurring when users switch between devices before the background sync completes, because the conflict-resolution algorithm incorrectly treats the lower device-clock timestamp as the authoritative version, overwriting newer local changes. The root cause is reliance on wall-clock time rather than vector clocks for merge ordering, which breaks across timezone boundaries.",
  },
  {
    keywords: ["slow", "performance", "lag", "delay", "loading", "speed"],
    summary:
      "Dashboard load times have degraded from ~400 ms to over 4 seconds following last week's analytics feature rollout, which introduced N+1 query patterns that fire one SQL round-trip per cluster row instead of a single aggregated join. The primary query is missing an index on `cluster_members.cluster_id`, causing full-table scans on a 80k-row table with every page load.",
  },
];

function getMockSummary(clusterName: string): string {
  const name = clusterName.toLowerCase();
  for (const entry of MOCK_SUMMARIES) {
    if (entry.keywords.some((k) => name.includes(k))) {
      return entry.summary;
    }
  }
  return "Analysis of the support ticket patterns reveals a systemic gap between customer expectations and the current product behaviour, likely originating from an undocumented breaking change in the latest release. Immediate investigation of the change-log diff between the two most recent production deployments is recommended to pinpoint the regression.";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { clusterName, tickets } = body as {
    clusterName: string;
    tickets: TicketInput[];
  };

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ summary: getMockSummary(clusterName ?? ""), mock: true });
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    const ticketList = (tickets ?? [])
      .slice(0, 10)
      .map((t) => `• ${t.subject}`)
      .join("\n");

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a senior support analyst at a D2C hardware company. Analyse the provided support tickets and return exactly 2 sentences: (1) what the root cause is, (2) what its technical impact is. Be specific, technical, and actionable. No filler. No bullet points—just 2 plain sentences.",
        },
        {
          role: "user",
          content: `Issue cluster: "${clusterName}"\n\nRecent tickets:\n${ticketList}\n\nProvide a 2-sentence root cause summary.`,
        },
      ],
      max_tokens: 160,
      temperature: 0.25,
    });

    const summary =
      completion.choices[0]?.message?.content?.trim() ||
      getMockSummary(clusterName ?? "");

    return NextResponse.json({ summary, mock: false });
  } catch (err) {
    console.error("[/api/generate-summary]", err);
    return NextResponse.json({
      summary: getMockSummary(clusterName ?? ""),
      mock: true,
    });
  }
}
