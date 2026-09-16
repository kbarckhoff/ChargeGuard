# ChargeGuard auth rebuild — finish-up steps

## UPDATE (2026-09-16): safe to deploy now + Admin area added
- **Deploy is now safe without the AWS email keys.** The email-OTP step auto-skips
  until SES is configured (sign-in is email + password only until then), and turns
  on automatically once you add AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / SES_FROM.
  So you can push now to see the multi-hospital features; nobody gets locked out.
- **New Admin area** (platform-owner only): left-nav "Admin" → create a hospital,
  assign its administrator (name + email), which provisions them with a temporary
  password and emails sign-in instructions, then switches you into that hospital.
- **Client switcher** in the top-right also lets you flip between hospitals.
- Login now lands on the dashboard.
- Nothing above is visible until you deploy (steps 3) — it's all committed code.

---


The new sign-in model (invite-only, temporary password, email OTP at every
sign-in, forced password change on first login) is built and type-checked.
Below is what's already done and the few steps that need you.

## Already done (by Claude)
- Code written + `tsc` clean:
  - Email OTP at sign-in: `src/app/api/auth/otp/send`, `.../verify`,
    `src/app/auth/verify-otp/page.tsx`, gating in `src/lib/supabase/middleware.ts`,
    helpers `src/lib/otp.ts` + `src/lib/otp-cookie.ts`.
  - Forced password change: `src/app/auth/update-password/page.tsx`.
  - Invite = admin creates the user with a temp password, emailed automatically:
    `src/app/api/team/invite/route.ts` (+ Team UI shows the temp password only if
    the email fails).
  - Self-signup removed in the app: `/auth/signup` redirects to login,
    `/api/auth/setup` returns 403, signup link removed from the login page.
- DB migration already run in Supabase: `login_otps` table exists.
- Supabase Auth email already sends through AWS SES (verified earlier).

## You need to do (in this order)

### 1. Add the app's email credentials to Vercel
The app sends the OTP code + temp-password emails through the SES API, which
needs an AWS access key. Reusing the existing SES user `chargeguard-ses-smtp`:

- AWS Console -> IAM -> Users -> `chargeguard-ses-smtp` -> Security credentials
  -> **Create access key** (type: Application running outside AWS). Copy the
  **Access key ID** and **Secret access key**.
- Vercel -> charge-guard -> Settings -> Environment Variables -> add these four
  to Production (and Preview if you use it):
  - `AWS_ACCESS_KEY_ID` = the new access key ID
  - `AWS_SECRET_ACCESS_KEY` = the new secret access key
  - `AWS_REGION` = `us-east-1`
  - `SES_FROM` = `noreply@chargeguard.ameliormss.com`

(If OTP emails later bounce with "AccessDenied", attach the `AmazonSESFullAccess`
policy to `chargeguard-ses-smtp` — but the existing SES sending policy should
already cover it.)

### 2. Turn off self-signup in Supabase (1 click)
Supabase -> Authentication -> Sign In / Providers -> **User Signups** ->
turn OFF "Allow new users to sign up" -> Save changes.
(The app already blocks signup; this closes the raw API too. The dashboard
toggle wouldn't save through automation, so it's a manual click.)

### 3. Deploy
```powershell
cd "C:\Users\kbarc\OneDrive\Desktop\Himformatics\ChargeGuard\chargeguard"
git add -A
git commit -m "Auth: invite-only, temp password, email OTP, forced password change"
git push origin HEAD:main
```
If OneDrive throws a `.git/index.lock` error, run:
`Remove-Item ".git\index.lock" -Force` then retry the push.

### 4. Verify + create your admin account
After Vercel finishes the deploy:
- Sign in as your existing admin (kbarckhoff) at
  https://chargeguard.ameliormss.com/auth/login -> you'll get an emailed code ->
  enter it -> you're in.
- Go to Settings -> Team -> Invite -> `kayleerae@ameliormss.com`. She gets a
  temp password by email, signs in, enters the OTP, and sets her own password.
- Make her a full admin (run in Supabase SQL editor):
  ```sql
  update public.users set is_platform_owner = true, role = 'admin'
  where lower(email) = 'kayleerae@ameliormss.com';
  ```

### 5. Delete two test users I created while probing the signup setting
Supabase -> Authentication -> Users -> search `example.com` -> delete the two
`probe-...@example.com` / `probe2-...@example.com` rows. They're inert (fake,
unconfirmed) but worth removing.

## Note on email deliverability
OTP emails are just a 6-digit code with no links, so they're far less likely to
be flagged than the earlier password-reset test (that one got flagged partly
because its link pointed at supabase.co, a different domain than the sender).
DMARC (`p=none`) and DKIM are already in place for ameliormss.com. If OTP mail
still lands in spam, the polish is a custom MAIL FROM / adding
`include:amazonses.com` to the SPF record — tell me and I'll set it up.
