import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { findingId, status } = await request.json();

    if (!findingId || !status) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const validStatuses = ["open", "in_review", "accepted", "rejected", "resolved"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { status };
    if (status === "resolved") {
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = user.id;
    } else if (status === "open") {
      updates.resolved_at = null;
      updates.resolved_by = null;
    }

    const { error } = await supabaseAdmin
      .from("findings")
      .update(updates)
      .eq("id", findingId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
