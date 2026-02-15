import type { Config } from "../config.js";

/**
 * Send a message to Slack using the Web API (fetch-based, no dependencies).
 */
export async function sendSlackMessage(text: string, config: Config): Promise<boolean> {
  if (!config.slackBotToken || !config.slackChannel) {
    return false;
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${config.slackBotToken}`,
        },
        body: JSON.stringify({
          channel: config.slackChannel,
          text,
          mrkdwn: true,
        }),
      });

      if (!res.ok) {
        console.error(`Slack API HTTP error: ${res.status} ${res.statusText}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        return false;
      }

      const data = (await res.json()) as { ok: boolean };
      return data.ok;
    } catch (err) {
      console.error(`Slack API request error: ${err}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return false;
    }
  }
  return false;
}
