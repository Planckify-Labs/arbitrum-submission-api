/**
 * Structured codes for the Google sign-in endpoints. The mobile client
 * switches on `code` and supplies its own copy — the `message` strings here
 * are for API consumers and logs, never for rendering to an end user.
 *
 * None of these endpoints answer with 401. The mobile `publicApi` treats any
 * 401 as session death: it attempts a silent refresh and then calls
 * `clearTokens()`. A user who mistypes one digit of a verification code, or
 * whose ID token is stale, must not have their existing wallet session wiped
 * as a side effect of a *login* request. Bad input is 400, an unusable
 * account is 403.
 */
export const GoogleAuthErrorCode = {
  INVALID_GOOGLE_TOKEN: "INVALID_GOOGLE_TOKEN",
  ACCOUNT_CONFLICT: "ACCOUNT_CONFLICT",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  RATE_LIMITED: "RATE_LIMITED",
  EMAIL_UNDELIVERABLE: "EMAIL_UNDELIVERABLE",
  INVALID_CODE: "INVALID_CODE",
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
} as const;

export type GoogleAuthErrorCode =
  (typeof GoogleAuthErrorCode)[keyof typeof GoogleAuthErrorCode];
