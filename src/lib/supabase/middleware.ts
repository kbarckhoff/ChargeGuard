import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { OTP_COOKIE, verifyOtpValue } from "@/lib/otp-cookie";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const redirectTo = (p: string) => {
    const url = request.nextUrl.clone();
    url.pathname = p;
    url.search = "";
    return NextResponse.redirect(url);
  };

  // The OTP endpoints must always be reachable for a password-authenticated
  // (but not-yet-OTP-verified) user, as must the OAuth callback.
  if (path.startsWith("/api/auth/otp") || path === "/auth/callback") {
    return supabaseResponse;
  }

  // Not signed in: only the landing + login pages are public.
  if (!user) {
    if (path === "/" || path === "/auth/login") return supabaseResponse;
    return redirectTo("/auth/login");
  }

  // Signed in with a password. Enforce the second factor (email OTP), then a
  // forced password change if this is a temp-password account.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // Email OTP is only enforced once an email provider (SES) is configured, so a
  // deploy without email keys never locks anyone out. It turns on automatically
  // once AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / SES_FROM are set.
  const otpEnabled = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.SES_FROM);
  const otpOk = !otpEnabled || (await verifyOtpValue(request.cookies.get(OTP_COOKIE)?.value, user.id, secret));
  const mustChange = (user.user_metadata as any)?.must_change_password === true;

  if (!otpOk) {
    // Setting/resetting your own password is allowed before the OTP second
    // factor: the user has already proven identity (password sign-in, or a
    // password-recovery email link). This is what makes "forgot password" work.
    if (path === "/auth/update-password") return supabaseResponse;
    if (path === "/auth/verify-otp") return supabaseResponse;
    return redirectTo("/auth/verify-otp");
  }

  if (mustChange) {
    if (path === "/auth/update-password") return supabaseResponse;
    return redirectTo("/auth/update-password");
  }

  // Fully authenticated — keep them out of the auth funnel pages.
  if (
    path === "/auth/login" ||
    path === "/auth/signup" ||
    path === "/auth/verify-otp" ||
    path === "/auth/update-password"
  ) {
    return redirectTo("/runs");
  }

  return supabaseResponse;
}
