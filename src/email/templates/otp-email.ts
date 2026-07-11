import { LOGO_CONTENT_ID } from "../assets/logo";

export interface OtpEmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Verification-code email. The code is the only dynamic value; everything
 * else is fixed copy so a template change can never interpolate untrusted
 * input into the markup.
 *
 * Table-based layout with inline styles — Gmail strips `<style>` blocks and
 * Outlook's Word rendering engine ignores flexbox, so neither is used.
 *
 * The logo is referenced as `cid:` and travels as an inline attachment (see
 * `EmailService`). The wordmark below it is live text, not part of the image,
 * so the brand still reads if a client blocks images.
 */
export function buildOtpEmail(
  code: string,
  expiresInMinutes: number,
): OtpEmailContent {
  const spacedCode = code.split("").join(" ");

  return {
    subject: `${code} is your TakumiPay verification code`,
    text: [
      "Verify your email",
      "",
      "Use the code below to verify your email:",
      "",
      code,
      "",
      `This code expires in ${expiresInMinutes} minutes.`,
      "",
      "If you didn't try to sign in to TakumiPay, you can ignore this email.",
      "Never share this code with anyone.",
      "",
      "TakumiPay — Your Financial AI Companion",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f5f5f7;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Use the code below to verify your email. It expires in ${expiresInMinutes} minutes.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:20px;padding:40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <img
                  src="cid:${LOGO_CONTENT_ID}"
                  alt="TakumiPay"
                  width="56"
                  height="56"
                  style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;margin:0 auto 12px;"
                />
                <span style="font-size:20px;font-weight:700;color:#20222c;letter-spacing:-0.3px;">TakumiPay</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;font-weight:700;color:#20222c;padding-bottom:12px;">
                Verify your email
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;color:#5c5f6c;padding-bottom:28px;">
                Use the code below to verify your email.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <div style="background-color:#f5f5f7;border:1px solid rgba(32,34,44,0.08);border-radius:14px;padding:18px 16px;font-size:24px;font-weight:700;color:#20222c;letter-spacing:6px;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;">
                  ${spacedCode}
                </div>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#7a7d8a;padding-bottom:28px;">
                This code expires in <strong style="color:#20222c;">${expiresInMinutes} minutes</strong>.
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid rgba(32,34,44,0.08);padding-top:24px;font-size:13px;line-height:21px;color:#7a7d8a;">
                If you didn't try to sign in to TakumiPay, you can ignore this
                email. Never share this code with anyone.
              </td>
            </tr>
          </table>
          <div style="max-width:480px;padding-top:20px;font-size:12px;color:#9a9ca6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            TakumiPay — Your Financial AI Companion
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
