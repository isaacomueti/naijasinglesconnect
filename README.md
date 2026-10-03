# NaijaSinglesConnect website

Static site, ready for Vercel. No build step.

## Structure
- `index.html`: homepage
- `auth.html`: sign up, log in, verify, reset password (served at `/auth`)
- `dashboard.html`: member dashboard (`/dashboard`): overview, matches, member profiles, introductions, messages, my profile, privacy, membership
- `admin.html`: team dashboard (`/admin`): overview, review queue, members, payments, support inbox, reports
- `404.html`: not-found page
- `assets/css/app.css`: shared styles for the member and admin dashboards
- `assets/js/nsc-store.js`: shared data layer (see below)
- `assets/`: logo, icons, social image and web images
- `vercel.json`: clean URLs, caching and security headers
- `robots.txt`, `sitemap.xml`, `llms.txt`, `site.webmanifest`: SEO and AEO
- `brand/`: logo concepts, full-resolution images and brand mockups (not deployed, see `.vercelignore`)

## How the two sides connect
Both dashboards read and write the same data through `assets/js/nsc-store.js`. Until Supabase is wired in, that data lives in the browser's `localStorage` (`nsc.db.v1`) and syncs live between open tabs, so an admin action in one tab shows up immediately in a member's tab.

| Member does | Admin sees |
| --- | --- |
| Creates an account | New account in Members and in activity; a welcome message in their support thread |
| Submits profile | Profile appears in the Review queue |
| Uploads a receipt | Receipt appears in Payments to confirm |
| Messages support | Conversation appears in the Support inbox |
| Reports a member | Report appears in Reports with the conversation attached |

| Admin does | Member sees |
| --- | --- |
| Approves | Status becomes Approved, matches unlock, a support message arrives |
| Requests changes / rejects / pauses | A banner with the admin's note on the dashboard, plus a support message |
| Confirms or rejects a receipt | Payment status updates, plus a support message |
| Replies in the support inbox | The reply in their NSC Support conversation |

Members chat with each other once an introduction is accepted. Each conversation has a safety note, Report and Block.

## Across borders
Members add a nationality and choose who they are open to meeting: Nigerians, people from other countries, or both. People with Nigerian heritage count as Nigerian. Two members only see each other when each is open to the other's group (NSC.eligible in 
sc-store.js). Sign-up takes any country code, and state of origin and LGA are only asked of Nigerian members.

## Private Circle (members living with HIV)
An optional, opt-in space. Members who join are matched only with other circle members and are hidden from everyone else; joining closes any pending introductions outside the circle. Admins see a "sensitive" banner on circle members.

HIV status is special-category health data under the Nigeria Data Protection Act 2023. Before launch:
- get explicit, separate consent when a member joins the circle, and record it
- store the flag in its own table with row-level security so only the member, matched circle members and named admins can read it
- encrypt it at rest, keep it out of analytics, logs and emails, and never put it in notification or email subject lines
- let members delete it permanently when they leave the circle

## Supabase tables to create
`members` (profile JSON, status, privacy, payment, blocked), `intros`, `messages` (thread is the intro id or `support:<memberId>`), `reports`, `activity`, `reads` (last-read time per reader and thread). Every function in `nsc-store.js` maps to a query or an RPC. Use Supabase Realtime on `messages` and `intros` to replace the cross-tab sync, and Storage for photos and receipts (they are kept as data URLs for now).

## Temporary auth (until Supabase + Resend)
- Sign-up creates a member record and goes straight to `/dashboard`. Email confirmation is switched off with `REQUIRE_EMAIL_VERIFICATION = false` at the top of the script in `auth.html`; set it to `true` to bring back the 6-digit code screen.
- Sessions are per tab (`sessionStorage`), so you can be signed in as two different members in two tabs. "Keep me logged in" also stores the session in `localStorage`.
- Passwords are stored as SHA-256 hashes for the demo only. Supabase Auth replaces this.

## Demo data
The store seeds sample members so every screen has content. Seeded members reply to messages and accept introduction requests automatically so the flows can be reviewed alone; remove `demoReply`, `demoAccept` and `onApproved` before launch.
- Sample member logins: any seeded email such as `tobi@example.com` or `chiamaka@example.com`, password `Demo1234`
- Team login at `/admin`: `admin@naijasinglesconnect.com`, password `Admin1234`
- "Reset demo data" in the admin sidebar restores the sample data.

## Try both sides
1. Run the site locally (below) and sign up at `/auth`.
2. Fill in your profile, upload any image as a receipt, and submit.
3. In a second tab, open `/admin`, sign in, open your profile in the Review queue and approve it.
4. Back in the first tab: matches unlock and two introduction requests arrive. Accept one and send a message.

## Run locally
```
npx serve .
```

## Deploy
```
npx vercel        # preview
npx vercel --prod # production
```
In the Vercel project settings use Framework Preset "Other", no build command, and output directory `.`.
Add naijasinglesconnect.com under Domains when it is registered.

Change the demo admin password and connect real auth before the site goes live.
