import { convex } from "@/lib/convexClient";
import { api } from "../../convex/_generated/api";

export type SendEmailResult =
  | { success: true }
  | { success: false; error: string };

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<SendEmailResult> {
  const result = await convex.action(api.resend.sendEmail, { to, subject, html });
  if (result.success) return { success: true };
  return { success: false, error: result.error ?? "Unknown error" };
}
