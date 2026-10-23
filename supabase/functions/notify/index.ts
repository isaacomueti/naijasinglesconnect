// Membership and activity emails. The database (supabase/schema.sql, private.notify)
// posts each event here with a shared secret; this function writes the email and sends it through Resend.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   RESEND_API_KEY  your Resend API key (re_...)
//   NOTIFY_SECRET   the value of: select value from private.config where key = 'notify_secret';
// Deploy with JWT verification off: the shared secret is checked instead.
import { esc, layout, send, SITE, type Email } from "../_shared/email.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";

type Event = {
  kind: string; to: string | string[]; first?: string; name?: string; email?: string; other?: string;
  plan?: string; months?: number; amount?: number; ref?: string; until?: string | null; approved?: boolean;
  status?: string; note?: string; active?: boolean; credit?: boolean; preview?: string;
};

const PLAN: Record<string, string> = { gold: "Gold", platinum: "Platinum" };
const naira = (n?: number) => "₦" + Number(n || 0).toLocaleString("en-NG");
const day = (t?: string | null) => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }) : "";
const term = (m?: number) => m === 1 ? "1 month" : `${m} months`;

function mail(o: { subject: string; title: string; body: string; button?: { label: string; path: string }; foot?: string }): Email {
  const url = o.button ? SITE + o.button.path : "";
  const plain = o.body.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return {
    subject: o.subject,
    html: layout({ preheader: plain.slice(0, 120), title: o.title, body: o.body, button: o.button ? { label: o.button.label, url } : undefined,
      foot: o.foot || "You're receiving this because you have an account on NaijaSinglesConnect." }),
    text: plain + (url ? `\n\n${o.button!.label}: ${url}` : ""),
  };
}

function build(e: Event): Email | null {
  const hi = e.first ? `Hi ${esc(e.first)},` : "Hello,";
  const plan = PLAN[e.plan || ""] || "NSC";
  switch (e.kind) {
    case "receipt":
      return mail({
        subject: `New receipt: ${e.name}, ${plan} ${term(e.months)} (${naira(e.amount)})`,
        title: "A new receipt to check",
        body: `<b>${esc(e.name)}</b> (${esc(e.email)}) uploaded a bank transfer receipt.<br><br>Plan: <b>${plan}, ${term(e.months)}</b><br>Amount due: <b>${naira(e.amount)}</b><br>Reference: <b>${esc(e.ref)}</b><br><br>Match it against the Best of Nature Ventures account before confirming.`,
        button: { label: "Review the receipt", path: "/admin#payments" },
        foot: "Sent to the NSC team because a member uploaded a payment receipt.",
      });
    case "paid":
      return mail({
        subject: `Payment confirmed: your ${plan} membership`,
        title: "Payment confirmed",
        body: `${hi}<br><br>Thank you. We have confirmed your payment of <b>${naira(e.amount)}</b> for <b>${plan}, ${term(e.months)}</b>.<br><br>` +
          (e.approved && e.until ? `Your membership is active until <b>${day(e.until)}</b>. Your matches are waiting.` : "Your membership starts the day our team approves your profile. We'll email you as soon as that happens."),
        button: { label: e.approved ? "See my matches" : "Open my dashboard", path: e.approved ? "/dashboard#matches" : "/dashboard" },
      });
    case "receipt_rejected":
      return mail({
        subject: "We couldn't confirm your receipt",
        title: "We couldn't confirm your receipt",
        body: `${hi}<br><br>${esc(e.note || "We could not match your receipt to a payment in our account.")}<br><br>Please check the amount and your reference, then upload the receipt again.`,
        button: { label: "Upload my receipt", path: "/dashboard#membership" },
      });
    case "status":
      if (e.status === "approved") return mail({
        subject: `You're approved${e.first ? ", " + e.first : ""}!`,
        title: "Welcome to NaijaSinglesConnect",
        body: `${hi}<br><br>Our team has reviewed and approved your profile. ` +
          (e.active ? `Your membership is active until <b>${day(e.until)}</b>, and your matches are ready.` : "Choose a Gold or Platinum plan to start seeing your matches."),
        button: e.active ? { label: "See my matches", path: "/dashboard#matches" } : { label: "Choose a plan", path: "/dashboard#membership" },
      });
      if (e.status === "changes") return mail({
        subject: "A few changes to your NSC profile",
        title: "Almost there",
        body: `${hi}<br><br>Our team reviewed your profile and asked for a few changes:<br><br><i>${esc(e.note)}</i><br><br>Update your profile and submit it again. We'll take another look straight away.`,
        button: { label: "Update my profile", path: "/dashboard#profile" },
      });
      if (e.status === "rejected") return mail({
        subject: "About your NaijaSinglesConnect profile",
        title: "About your profile",
        body: `${hi}<br><br>${esc(e.note || "We are not able to approve your profile at this time.")}<br><br>If you have questions, message our team from your dashboard.`,
        button: { label: "Message the team", path: "/dashboard#messages" },
      });
      if (e.status === "suspended") return mail({
        subject: "Your NSC account is paused",
        title: "Your account is paused",
        body: `${hi}<br><br>${esc(e.note || "Our team has paused your account while we look into recent activity.")}<br><br>Reply from your dashboard if you'd like to share your side.`,
        button: { label: "Message the team", path: "/dashboard#messages" },
      });
      return null;
    case "new_match":
      return mail({
        subject: "You have a new match on NaijaSinglesConnect",
        title: "You have a new match",
        body: "Hello,<br><br>A new member whose faith, values and plans line up with what you're looking for has just joined. Have a look at your matches and send an introduction request if you'd like to meet.",
        button: { label: "See my matches", path: "/dashboard#matches" },
        foot: "You're receiving this because you're an active NSC member. We send at most one email per new match.",
      });
    case "intro_request":
      return mail({
        subject: "Someone would like to be introduced to you",
        title: "A new introduction request",
        body: `${hi}<br><br>A member would like to be introduced to you. Have a look at their profile and accept or decline. There's no pressure either way, and they won't be told why.`,
        button: { label: "See the request", path: "/dashboard#introductions" },
      });
    case "intro_accepted":
      return mail({
        subject: `${e.other || "Your match"} accepted your introduction`,
        title: "You've been introduced",
        body: `${hi}<br><br><b>${esc(e.other || "Your match")}</b> accepted your introduction request. You can now message each other on NSC. Take your time, be kind, and keep conversations on NSC until you're comfortable.`,
        button: { label: "Say hello", path: "/dashboard#messages" },
      });
    case "member_message":
      return mail({
        subject: `${e.other || "Your match"} sent you a message`,
        title: "You have a new message",
        body: `${hi}<br><br><b>${esc(e.other || "Your match")}</b> sent you a message on NaijaSinglesConnect.`,
        button: { label: "Read and reply", path: "/dashboard#messages" },
      });
    case "team_message":
      return mail({
        subject: "New message from the NSC team",
        title: "A message from our team",
        body: `${hi}<br><br><i>"${esc(e.preview)}${(e.preview || "").length >= 220 ? "…" : ""}"</i>`,
        button: { label: "Read and reply", path: "/dashboard#messages" },
      });
    case "support_in":
      return mail({
        subject: `New support message from ${e.name || "a member"}`,
        title: "A member needs the team",
        body: `<b>${esc(e.name || "A member")}</b> wrote:<br><br><i>"${esc(e.preview)}"</i>`,
        button: { label: "Open the support inbox", path: "/admin#support" },
        foot: "Sent to the NSC team. We send at most one alert per conversation each hour.",
      });
    case "test":
      return mail({
        subject: "Test email from NaijaSinglesConnect",
        title: "Emails are working",
        body: "This test was sent from the NSC admin dashboard. Receipt alerts, approval emails and match notifications will arrive the same way.",
        button: { label: "Open the admin dashboard", path: "/admin#settings" },
        foot: "Sent to the NSC team alert address.",
      });
    case "expiring":
      return mail({
        subject: `Your ${plan} membership ends on ${day(e.until)}`,
        title: "Your membership ends soon",
        body: `${hi}<br><br>Your ${plan} membership ends on <b>${day(e.until)}</b>. Renew now to keep your matches, introductions and conversations open.`,
        button: { label: "Renew my membership", path: "/dashboard#membership" },
      });
    case "expired":
      return mail({
        subject: `Your ${plan} membership has ended`,
        title: "Your membership has ended",
        body: `${hi}<br><br>Your ${plan} membership ended on <b>${day(e.until)}</b>. Your profile and conversations are saved. Renew any time to pick up where you left off.`,
        button: { label: "Renew my membership", path: "/dashboard#membership" },
      });
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SECRET || req.headers.get("x-nsc-secret") !== SECRET) return new Response("Unauthorized", { status: 401 });
  if (!RESEND_API_KEY) return new Response("RESEND_API_KEY is not set", { status: 500 });
  let e: Event;
  try { e = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
  const msg = build(e);
  if (!msg) return Response.json({ skipped: e.kind });
  const r = await send(RESEND_API_KEY, e.to, msg);
  // Resend's reason (for example an unverified domain) is shown in /admin > Settings > Email delivery
  if (!r.ok) { console.error("Resend error", e.kind, r.status, r.detail); return new Response(`Resend refused it (${r.status}): ${r.detail}`.slice(0, 280), { status: 502 }); }
  return Response.json({ sent: e.kind });
});
