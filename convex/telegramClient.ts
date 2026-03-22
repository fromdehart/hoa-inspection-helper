/**
 * Lightweight Telegram Bot API client (fetch only, no SDK).
 * Used by Convex actions; do not import in client code.
 */

const BASE = "https://api.telegram.org/bot";

export type ApiResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string };

async function request<T>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<ApiResult<T>> {
  const url = `${BASE}${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!res.ok) {
      return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    }
    if (!data.ok) {
      return { ok: false, error: data.description ?? "Unknown error" };
    }
    return { ok: true, result: data.result as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export function sendMessage(
  token: string,
  chatId: string,
  text: string
): Promise<ApiResult> {
  return request(token, "sendMessage", { chat_id: chatId, text });
}

export function sendPhoto(
  token: string,
  chatId: string,
  photoUrl: string
): Promise<ApiResult> {
  return request(token, "sendPhoto", { chat_id: chatId, photo: photoUrl });
}

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    photo?: unknown[];
  };
};

export function getUpdates(
  token: string,
  offset?: number,
  timeout = 0
): Promise<ApiResult<TelegramUpdate[]>> {
  const body: Record<string, unknown> = { timeout };
  if (offset !== undefined) body.offset = offset;
  return request<TelegramUpdate[]>(token, "getUpdates", body);
}
