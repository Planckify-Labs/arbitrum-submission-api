/**
 * push-notif-test.ts
 *
 * Fire a single test push to an Expo push token from the terminal.
 * Uses the same `expo-server-sdk` integration the backend uses in
 * production (`src/push/push.service.ts`), so a green run here is a
 * real signal that production sends will work too.
 *
 * Usage:
 *   pnpm pushNotif:test ExponentPushToken[xxxxxxxxxxxxxxxxxxxx]
 *   pnpm pushNotif:test ExponentPushToken[xxx] "Custom title" "Custom body"
 *
 * Env:
 *   EXPO_ACCESS_TOKEN — optional. When set, runs against Expo's
 *                       authenticated relay (bypasses per-IP
 *                       throttling). Pass inline:
 *
 *     EXPO_ACCESS_TOKEN=xxxxx pnpm pushNotif:test ExponentPushToken[xxx]
 *
 *                       or export it in your shell first:
 *
 *     export $(grep -v '^#' .env | xargs)
 *     pnpm pushNotif:test ExponentPushToken[xxx]
 *
 * Exit codes:
 *   0 — ticket accepted (Expo has the message queued for delivery)
 *   1 — invalid token format / send failed / ticket returned an error
 */

import { setDefaultResultOrder } from "node:dns";
import {
  Expo,
  type ExpoPushErrorReceipt,
  type ExpoPushMessage,
} from "expo-server-sdk";

// Force IPv4-first DNS resolution. On networks where the IPv6 path to
// `exp.host` (NAT64) is unreachable, Node's `fetch` (undici) tries v6,
// hits ENETUNREACH, falls back to v4, and the v4 connect times out —
// surfacing as a bare "fetch failed" with no detail. `curl` works on
// the same box because it does Happy-Eyeballs. Prefer v4 to skip the
// dead leg entirely.
setDefaultResultOrder("ipv4first");

async function main(): Promise<void> {
  const [, , rawToken, customTitle, customBody] = process.argv;

  if (!rawToken) {
    console.error(
      "Usage: pnpm pushNotif:test <ExponentPushToken[...]> [title] [body]",
    );
    process.exit(1);
  }

  if (!Expo.isExpoPushToken(rawToken)) {
    console.error(
      `[pushNotif:test] '${rawToken}' is not a valid Expo push token.`,
    );
    console.error(
      "  Expected format: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] (44 chars in brackets).",
    );
    process.exit(1);
  }

  const accessToken = process.env.EXPO_ACCESS_TOKEN ?? "";
  const expo = new Expo({
    accessToken: accessToken.length > 0 ? accessToken : undefined,
  });

  console.log(
    `[pushNotif:test] mode=${accessToken ? "authenticated" : "anonymous"} to=${rawToken}`,
  );

  const message: ExpoPushMessage = {
    to: rawToken,
    sound: "default",
    title: customTitle ?? "TakumiPay test push",
    body: customBody ?? "If you can see this, Expo Push is wired up correctly.",
    data: {
      kind: "pushNotif_test",
      sentAt: new Date().toISOString(),
    },
    priority: "high",
  };

  // Retry transient connect failures. Even with `ipv4first` (above),
  // we've observed the v4 path to `exp.host` time out intermittently,
  // surfacing as `fetch failed` with `cause.code` in
  // `ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN`. A handful of
  // exponentially-backed-off retries makes the script reliable on
  // flaky links without masking real errors (auth, bad token, etc.).
  const MAX_ATTEMPTS = 4;
  let tickets;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      tickets = await expo.sendPushNotificationsAsync([message]);
      break;
    } catch (err) {
      const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
      const isTransient =
        err instanceof Error &&
        (err.message === "fetch failed" ||
          /ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN|UND_ERR/.test(
            causeCode ?? "",
          ));
      if (!isTransient || attempt === MAX_ATTEMPTS) {
        console.error(
          `[pushNotif:test] sendPushNotificationsAsync threw: ${
            err instanceof Error ? err.message : String(err)
          }${causeCode ? ` (cause=${causeCode})` : ""}`,
        );
        process.exit(1);
      }
      const delayMs = 500 * 2 ** (attempt - 1);
      console.warn(
        `[pushNotif:test] transient network error (${causeCode ?? "fetch failed"}); retrying in ${delayMs}ms (${attempt}/${MAX_ATTEMPTS - 1})`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  if (!tickets) {
    console.error("[pushNotif:test] no tickets after retries");
    process.exit(1);
  }

  const ticket = tickets[0];
  if (!ticket) {
    console.error("[pushNotif:test] Expo returned no ticket.");
    process.exit(1);
  }

  if (ticket.status === "ok") {
    console.log("[pushNotif:test] ✓ ticket accepted by Expo");
    console.log(`  ticket id: ${ticket.id}`);
    console.log(
      "  Check your device within ~5s. If nothing arrives, see troubleshooting below.",
    );
    process.exit(0);
  }

  const errDetails = (ticket as { details?: ExpoPushErrorReceipt["details"] })
    .details;
  console.error(
    `[pushNotif:test] ✗ ticket error: ${ticket.message ?? "unknown"} (code=${
      errDetails?.error ?? "n/a"
    })`,
  );
  if (errDetails?.error === "DeviceNotRegistered") {
    console.error(
      "  → The device uninstalled the app or the token rotated. Get a fresh token from a recent app launch.",
    );
  } else if (errDetails?.error === "InvalidCredentials") {
    console.error(
      "  → EXPO_ACCESS_TOKEN is wrong or has been revoked. Recreate it on expo.dev.",
    );
  } else if (errDetails?.error === "MessageRateExceeded") {
    console.error(
      "  → Hit the per-source-IP anonymous rate limit. Set EXPO_ACCESS_TOKEN to bypass.",
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(
    `[pushNotif:test] uncaught: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exit(1);
});
