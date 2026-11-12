export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Where replies go, e.g. the visitor who filled in a contact form. */
  replyTo?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Local development: prints the e-mail to the console instead of sending it. */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
  }
}

/** Sends through Resend (https://resend.com). Swap for another provider by implementing Mailer. */
export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(mail: Mail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Mail provider answered ${res.status}`);
  }
}
