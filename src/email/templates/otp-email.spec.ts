import { LOGO_CONTENT_ID, LOGO_PNG_BASE64 } from "../assets/logo";
import { buildOtpEmail } from "./otp-email";

describe("buildOtpEmail", () => {
  const { subject, html, text } = buildOtpEmail("483920", 10);

  it("carries the code and expiry in both parts", () => {
    expect(subject).toContain("483920");
    expect(text).toContain("Use the code below to verify your email");
    expect(text).toContain("483920");
    expect(text).toContain("10 minutes");
    expect(html).toContain("Use the code below to verify your email");
    expect(html).toContain("10 minutes");
    // Rendered letter-spaced in the HTML, so match the spaced form.
    expect(html).toContain("4 8 3 9 2 0");
  });

  it("references the logo by cid, never as a data URI", () => {
    expect(html).toContain(`src="cid:${LOGO_CONTENT_ID}"`);
    // Gmail and Outlook strip `data:` URIs from <img src>. Using one here
    // would render the logo as a broken image for most recipients.
    expect(html).not.toContain("data:image");
  });

  it("keeps the wordmark as live text so branding survives blocked images", () => {
    expect(html).toContain(">TakumiPay</span>");
    expect(html).toContain('alt="TakumiPay"');
  });

  it("leaves no unsubstituted template placeholders", () => {
    expect(html).not.toContain("${");
    expect(text).not.toContain("${");
  });

  it("ships a decodable PNG for the inline attachment", () => {
    const buf = Buffer.from(LOGO_PNG_BASE64, "base64");
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // Keep the payload small — it rides along on every sign-in email.
    expect(buf.length).toBeLessThan(20_000);
  });
});
