import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type OutlookComposeInput = {
  recipients: string[];
  subject: string;
  body: string;
  attachmentPath: string;
};

/**
 * Opent Outlook met een nieuw bericht en PDF-bijlage (alleen Windows + Outlook).
 */
export async function openOutlookWithAttachment(input: OutlookComposeInput): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Outlook-automation is alleen beschikbaar op Windows.");
  }

  const to = input.recipients.join(";");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$to = ${psQuote(to)}`,
    `$subject = ${psQuote(input.subject)}`,
    `$body = ${psQuote(input.body)}`,
    `$attachment = ${psQuote(input.attachmentPath)}`,
    "$outlook = New-Object -ComObject Outlook.Application",
    "$mail = $outlook.CreateItem(0)",
    "if ($to) { $mail.To = $to }",
    "$mail.Subject = $subject",
    "$mail.Body = $body",
    "$mail.Attachments.Add($attachment) | Out-Null",
    "$mail.Display()",
  ].join("; ");

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: 60_000, windowsHide: true },
  );
}
