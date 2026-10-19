// Shared by the email functions: the branded NSC layout and sending through Resend.
export const FROM = "NaijaSinglesConnect <no-reply@naijasinglesconnect.com>";
export const SITE = "https://naijasinglesconnect.com";
const LOGO = SITE + "/assets/nsc-logo.png";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type Email = { subject: string; html: string; text: string };

export function layout(o: { preheader: string; title: string; body: string; button?: { label: string; url: string }; code?: string; foot: string }) {
  const btn = o.button
    ? `<tr><td style="padding:8px 0 28px"><a href="${o.button.url}" style="display:inline-block;background:#07764B;color:#F8F5F0;font-weight:800;font-size:16px;text-decoration:none;padding:16px 30px;border-radius:999px">${esc(o.button.label)} &rarr;</a></td></tr>
       <tr><td style="font-size:13px;line-height:20px;color:#6B7A72;padding-bottom:24px">If the button doesn't work, copy this link into your browser:<br><a href="${o.button.url}" style="color:#07764B;word-break:break-all">${o.button.url}</a></td></tr>`
    : "";
  const code = o.code
    ? `<tr><td style="padding:4px 0 28px"><div style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:800;color:#13261D;background:#F8F5F0;border:1px solid #E6E0D3;border-radius:14px;padding:14px 22px">${esc(o.code)}</div></td></tr>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#F8F5F0;font-family:Manrope,'Segoe UI',Helvetica,Arial,sans-serif;color:#13261D">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F5F0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 20px"><img src="${LOGO}" alt="NSC" width="104" style="display:block;height:auto;border:0"></td></tr>
    <tr><td style="background:#FFFFFF;border:1px solid #E6E0D3;border-radius:24px;padding:36px 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:36px;font-weight:600;color:#13261D;padding-bottom:16px">${o.title}</td></tr>
        <tr><td style="font-size:16px;line-height:26px;color:#4A5B52;padding-bottom:24px">${o.body}</td></tr>
        ${btn}${code}
        <tr><td style="border-top:1px solid #E6E0D3;padding-top:20px;font-size:13px;line-height:20px;color:#6B7A72">${o.foot}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 8px 0;font-size:12px;line-height:18px;color:#7A877F;text-align:center">
      NaijaSinglesConnect &middot; Connecting hearts. Building lasting marriages.<br>
      NaijaSinglesConnect is a service of Best of Nature Ventures.<br>
      Questions? Reply to the NSC team from your dashboard, or write to support@naijasinglesconnect.com
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/* one email, or up to 100 identical emails sent individually (recipients never see each other) */
export async function send(apiKey: string, to: string | string[], msg: Email) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return { ok: true, status: 200, detail: "" };
  const single = list.length === 1;
  const r = await fetch(single ? "https://api.resend.com/emails" : "https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(single
      ? { from: FROM, to: list, subject: msg.subject, html: msg.html, text: msg.text, headers: { "X-Entity-Ref-ID": crypto.randomUUID() } }
      : list.slice(0, 100).map((t) => ({ from: FROM, to: [t], subject: msg.subject, html: msg.html, text: msg.text }))),
  });
  return { ok: r.ok, status: r.status, detail: r.ok ? "" : await r.text() };
}
