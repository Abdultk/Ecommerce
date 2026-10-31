import { expect } from "@playwright/test";
import { settings } from "./config";

type MailSummary = { ID: string; Subject: string; To: { Address: string }[] };
export type Mail = { id: string; subject: string; text: string; links: string[] };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${settings.mailpitUrl}/api/v1${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Waits for the newest email to `to` whose subject matches, via Mailpit's API. Addresses
 * are unique per test, so parallel tests never read each other's mail.
 */
export async function waitForEmail(to: string, subject: RegExp, timeout = 20_000): Promise<Mail> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}"`);
        const { messages } = await getJson<{ messages: MailSummary[] }>(`/search?query=${query}`);
        found = messages.find((m) => subject.test(m.Subject));
        return Boolean(found);
      },
      { message: `email to ${to} matching ${subject}`, timeout, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  const message = await getJson<{ ID: string; Subject: string; Text: string }>(
    `/message/${found!.ID}`,
  );
  return {
    id: message.ID,
    subject: message.Subject,
    text: message.Text,
    links: [...message.Text.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0]),
  };
}

/** The first link in the email that starts with `origin`. */
export function linkTo(mail: Mail, origin: string): string {
  const link = mail.links.find((l) => l.startsWith(origin));
  if (!link) throw new Error(`No ${origin} link in "${mail.subject}":\n${mail.text}`);
  return link;
}
