import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { LOGO_CONTENT_ID, LOGO_FILENAME, LOGO_PNG_BASE64 } from "./assets/logo";
import { buildOtpEmail } from "./templates/otp-email";

export interface SendOtpEmailParams {
  to: string;
  code: string;
  expiresInMinutes: number;
  /**
   * Distinguishes each send of the same challenge. Resend dedupes on
   * `idempotencyKey` for 24h, so a resend that reused the challenge id
   * alone would be silently swallowed and the user would never get a
   * second code.
   */
  idempotencySuffix: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.from = this.configService.get<string>("RESEND_FROM_EMAIL");

    if (!apiKey || !this.from) {
      this.logger.error(
        "RESEND_API_KEY / RESEND_FROM_EMAIL are not configured — OTP emails will not be delivered",
      );
      this.resend = null;
      return;
    }

    this.resend = new Resend(apiKey);
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  /**
   * Delivers a verification code. Returns whether the provider accepted the
   * message; the caller decides how to surface a failure. Provider errors are
   * logged here and never returned, so no upstream handler can accidentally
   * pipe a Resend error body into an API response.
   */
  async sendOtpEmail(params: SendOtpEmailParams): Promise<boolean> {
    const { to, code, expiresInMinutes, idempotencySuffix } = params;

    if (!this.resend || !this.from) {
      this.logger.error("sendOtpEmail called while Resend is not configured");
      return false;
    }

    const { subject, html, text } = buildOtpEmail(code, expiresInMinutes);

    // A network-level failure (DNS, TLS, socket) rejects the promise; a
    // provider-level failure (bad key, 429, suppressed recipient) resolves
    // with `error` set. Both have to be handled.
    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: this.from,
          to: [to],
          subject,
          html,
          text,
          // Inline, not a visible attachment: `contentId` is what lets the
          // template reach it via `cid:`. A `data:` URI would be stripped by
          // Gmail and Outlook and render as a broken image.
          attachments: [
            {
              filename: LOGO_FILENAME,
              content: Buffer.from(LOGO_PNG_BASE64, "base64"),
              contentType: "image/png",
              contentId: LOGO_CONTENT_ID,
            },
          ],
          tags: [{ name: "category", value: "auth_otp" }],
        },
        // In resend v6 the idempotency key is a request option, not a
        // payload field.
        { idempotencyKey: `google-otp/${idempotencySuffix}` },
      );

      if (error) {
        this.logger.error(
          `Resend rejected the OTP email: ${error.name} — ${error.message}`,
        );
        return false;
      }

      this.logger.log(`OTP email queued (resend id: ${data?.id})`);
      return true;
    } catch (error) {
      this.logger.error(
        `OTP email transport failure: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return false;
    }
  }
}
