import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type AuthEmailType = "verification" | "password_reset";

interface AuthEmailInput {
  type: AuthEmailType;
  recipient: string;
  link: string;
}

export type EmailDelivery = "sent" | "local" | "failed";

function readApiKey(): string {
  const keyFile = process.env.RESEND_API_KEY_FILE?.trim();
  if (keyFile) {
    try {
      return readFileSync(resolve(keyFile), "utf8").trim();
    } catch {
      return "";
    }
  }
  return process.env.RESEND_API_KEY?.trim() ?? "";
}

function senderAddress(): string {
  const configured = process.env.AUTH_EMAIL_FROM?.trim() ?? "";
  if (configured && configured.length <= 200 && !/[\r\n]/u.test(configured)) {
    return configured;
  }
  return "Haleview <onboarding@resend.dev>";
}

function message(input: AuthEmailInput): { subject: string; text: string } {
  if (input.type === "verification") {
    return {
      subject: "Verify your email",
      text: `Open this link to verify your email:\n\n${input.link}\n\nThis link expires in 24 hours.`
    };
  }
  return {
    subject: "Reset your password",
    text: `Open this link to reset your password:\n\n${input.link}\n\nThis link expires in 1 hour.`
  };
}

export async function sendAuthEmail(input: AuthEmailInput): Promise<EmailDelivery> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return "local";
  }

  const content = message(input);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: senderAddress(),
        to: [input.recipient],
        subject: content.subject,
        text: content.text
      }),
      signal: AbortSignal.timeout(10000)
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
