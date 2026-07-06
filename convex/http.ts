import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

/**
 * Verify a Svix webhook signature (Resend webhooks are Svix-signed) without
 * the svix package: HMAC-SHA256 over `${id}.${timestamp}.${payload}` with the
 * base64 secret (whsec_ prefix stripped), compared against each
 * space-delimited `v1,<sig>` entry in the svix-signature header.
 */
async function verifySvixSignature(
  secret: string,
  headers: Headers,
  payload: string,
): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject stale timestamps (replay protection, 5 min window).
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

  const secretBytes = Uint8Array.from(
    atob(secret.startsWith("whsec_") ? secret.slice(6) : secret),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));

  return signatureHeader.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    return version === "v1" && sig === expected;
  });
}

type InboundEmailPayload = {
  type?: string;
  data?: {
    from?: string | { address?: string };
    to?: string | string[] | Array<{ address?: string }>;
    subject?: string;
    text?: string;
    html?: string;
    message_id?: string;
    messageId?: string;
    in_reply_to?: string;
    headers?: Record<string, string>;
    attachments?: Array<{ filename?: string; content_type?: string; size?: number }>;
  };
};

function firstAddress(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "address" in first) {
      return String((first as { address?: string }).address ?? "");
    }
    return "";
  }
  if (value && typeof value === "object" && "address" in value) {
    return String((value as { address?: string }).address ?? "");
  }
  return "";
}

/**
 * Resend Inbound webhook → store raw email → async AI processing. Fail-closed:
 * without a configured RESEND_INBOUND_WEBHOOK_SECRET every request is rejected.
 * Idempotent on the email's Message-ID (webhook retries are no-ops).
 */
http.route({
  path: "/inbound-email",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
    if (!secret) {
      console.warn("[inbound-email] RESEND_INBOUND_WEBHOOK_SECRET unset; rejecting request.");
      return new Response("Webhook not configured", { status: 503 });
    }

    const payload = await request.text();
    const verified = await verifySvixSignature(secret, request.headers, payload).catch(() => false);
    if (!verified) {
      return new Response("Invalid signature", { status: 401 });
    }

    let parsed: InboundEmailPayload;
    try {
      parsed = JSON.parse(payload) as InboundEmailPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const data = parsed.data;
    if (!data) return new Response("No data", { status: 400 });

    const from = firstAddress(data.from);
    const to = firstAddress(data.to);
    const messageId =
      data.message_id ?? data.messageId ?? data.headers?.["message-id"] ?? crypto.randomUUID();
    if (!from || !to) return new Response("Missing addresses", { status: 400 });

    const inboundEmailId = await ctx.runMutation(internal.emailIntake.ingest, {
      from,
      to,
      subject: data.subject ?? "",
      textBody: data.text ?? "",
      htmlBody: data.html,
      messageId,
      inReplyTo: data.in_reply_to ?? data.headers?.["in-reply-to"],
      attachmentsMeta: data.attachments?.map((a) => ({
        fileName: a.filename ?? "attachment",
        contentType: a.content_type ?? "application/octet-stream",
        size: a.size ?? 0,
      })),
    });

    // Duplicate delivery → acknowledge without reprocessing.
    if (inboundEmailId) {
      await ctx.scheduler.runAfter(0, internal.emailIntake.process, { inboundEmailId });
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
