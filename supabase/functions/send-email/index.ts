// Supabase "Send Email" auth hook: sends sign-up (welcome + confirm), password reset,
// magic link, invite, email change and re-authentication emails through the Resend API.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   RESEND_API_KEY          your Resend API key (re_...)
//   SEND_EMAIL_HOOK_SECRET  from Authentication > Hooks > Send Email (starts with v1,whsec_)
// Deploy with JWT verification off: Supabase signs hook calls itself.
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const FROM = "NaijaSinglesConnect <no-reply@naijasinglesconnect.com>";
const SITE = "https://naijasinglesconnect.com";
const LOGO = SITE + "/assets/nsc-logo.png";

type EmailData = {
  token: string; token_hash: string; redirect_to: string; email_action_type: string;
  site_url: string; token_new?: string; token_hash_new?: string;
};
type HookUser = { email: string; new_email?: string; user_metadata?: Record<string, string> };

const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function verifyLink(d: EmailData, hash = d.token_hash) {
  const to = d.redirect_to || SITE + "/dashboard";
  return `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(d.email_action_type)}&redirect_to=${encodeURIComponent(to)}`;
}

function layout(o: { preheader: string; title: string; body: string; button?: { label: string; url: string }; code?: string; foot: string }) {
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
      Questions? Reply to the NSC team from your dashboard, or write to support@naijasinglesconnect.com
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function build(user: HookUser, d: EmailData) {
  const first = esc(user.user_metadata?.first || "");
  const hi = first ? `Hi ${first},` : "Hello,";
  const ignore = "If you didn't ask for this, you can ignore this email. Nothing will change.";
  switch (d.email_action_type) {
    case "signup":
      return {
        subject: `${d.token} is your NaijaSinglesConnect code`,
        html: layout({
          preheader: `Your code is ${d.token}. Enter it to confirm your email and log in.`,
          title: `Welcome to NSC${first ? ", " + first : ""}`,
          body: `${hi}<br><br>Thank you for joining a community of people who are serious about marriage. Enter this code on the sign-up page to confirm your email. You'll go straight to your dashboard.`,
          code: d.token,
          foot: `<b style="color:#13261D">What happens next</b><br>1. Complete your profile, about 10 minutes<br>2. Pay by bank transfer and upload your receipt<br>3. Our team reviews you, usually within 24 hours<br>4. Meet members who share your faith and your plans<br><br>
            Can't use the code? <a href="${verifyLink(d)}" style="color:#07764B">Confirm with this link instead</a>. The code expires in 1 hour. ${ignore}`,
        }),
        text: `${hi}\n\nWelcome to NaijaSinglesConnect. Your confirmation code is ${d.token}\n\nEnter it on the sign-up page to confirm your email and log in. Or open this link:\n${verifyLink(d)}\n\nThe code expires in 1 hour. ${ignore}`,
      };
    case "recovery":
      return {
        subject: "Reset your NaijaSinglesConnect password",
        html: layout({
          preheader: "Choose a new password for your NSC account.",
          title: "Reset your password",
          body: `${hi}<br><br>We received a request to reset the password for your NaijaSinglesConnect account. Click below to choose a new one.`,
          button: { label: "Choose a new password", url: verifyLink({ ...d, redirect_to: d.redirect_to || SITE + "/auth?reset=1" }) },
          foot: "This link expires in 1 hour. " + ignore,
        }),
        text: `${hi}\n\nReset your NaijaSinglesConnect password:\n${verifyLink(d)}\n\nThis link expires in 1 hour. ${ignore}`,
      };
    case "magiclink":
      return {
        subject: "Your NaijaSinglesConnect sign-in link",
        html: layout({ preheader: "Sign in to NSC with one click.", title: "Sign in to NSC", body: `${hi}<br><br>Click below to sign in.`, button: { label: "Sign in", url: verifyLink(d) }, foot: "This link expires in 1 hour. " + ignore }),
        text: `${hi}\n\nSign in to NaijaSinglesConnect:\n${verifyLink(d)}\n\n${ignore}`,
      };
    case "invite":
      return {
        subject: "You're invited to NaijaSinglesConnect",
        html: layout({ preheader: "Accept your invitation to NSC.", title: "You're invited", body: `${hi}<br><br>You've been invited to join NaijaSinglesConnect.`, button: { label: "Accept invitation", url: verifyLink(d) }, foot: ignore }),
        text: `${hi}\n\nAccept your invitation to NaijaSinglesConnect:\n${verifyLink(d)}`,
      };
    case "email_change":
      return {
        subject: "Confirm your new email address",
        html: layout({ preheader: "Confirm the change to your NSC email.", title: "Confirm your new email", body: `${hi}<br><br>Confirm that you want to use this email address for your NaijaSinglesConnect account.`, button: { label: "Confirm email change", url: verifyLink(d, d.token_hash_new || d.token_hash) }, foot: ignore }),
        text: `${hi}\n\nConfirm your new email address:\n${verifyLink(d, d.token_hash_new || d.token_hash)}`,
      };
    case "reauthentication":
      return {
        subject: "Your NaijaSinglesConnect security code",
        html: layout({ preheader: "Your one-time security code.", title: "Your security code", body: `${hi}<br><br>Enter this code to confirm it's you.`, code: d.token, foot: "The code expires in 10 minutes. " + ignore }),
        text: `${hi}\n\nYour NaijaSinglesConnect security code is ${d.token}. ${ignore}`,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!RESEND_API_KEY || !HOOK_SECRET) {
    return Response.json({ error: { http_code: 500, message: "Email is not configured: set RESEND_API_KEY and SEND_EMAIL_HOOK_SECRET." } }, { status: 500 });
  }
  const payload = await req.text();
  let user: HookUser, email_data: EmailData;
  try {
    ({ user, email_data } = new Webhook(HOOK_SECRET).verify(payload, Object.fromEntries(req.headers)) as { user: HookUser; email_data: EmailData });
  } catch (_e) {
    return Response.json({ error: { http_code: 401, message: "Invalid hook signature" } }, { status: 401 });
  }

  const msg = build(user, email_data);
  if (!msg) return Response.json({}, { status: 200 });
  const to = email_data.email_action_type === "email_change" && user.new_email ? user.new_email : user.email;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: msg.subject, html: msg.html, text: msg.text,
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() } }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error("Resend error", r.status, detail);
    return Response.json({ error: { http_code: 500, message: "Could not send the email. Please try again shortly." } }, { status: 500 });
  }
  return Response.json({}, { status: 200 });
});
