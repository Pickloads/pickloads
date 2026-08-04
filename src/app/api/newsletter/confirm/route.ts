import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * Double-opt-in confirmation endpoint (audit S-05). Validates the emailed
 * confirm_token and stamps confirmed_at, then redirects to the blog page
 * where NewsletterForm reads ?newsletter=… and shows the matching state.
 */
export async function GET(request: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const redirectTo = (result: "confirmed" | "invalid") =>
    NextResponse.redirect(new URL(`/blog?newsletter=${result}`, siteUrl));

  const token = request.nextUrl.searchParams.get("token");
  const parsed = z.uuid().safeParse(token);
  if (!parsed.success) return redirectTo("invalid");

  const admin = tryCreateAdminClient();
  if (!admin) {
    // Secretless dev: keep the flow walkable end-to-end.
    console.warn("[newsletter] confirm skipped — no service-role key (dev mode)");
    return redirectTo("confirmed");
  }

  try {
    const { data, error } = await admin
      .from("subscribers")
      .select("id, confirmed_at, unsubscribed_at")
      .eq("confirm_token", parsed.data)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.unsubscribed_at) return redirectTo("invalid");
    if (data.confirmed_at) return redirectTo("confirmed"); // idempotent

    const { error: updateError } = await admin
      .from("subscribers")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);
    return redirectTo("confirmed");
  } catch (err) {
    console.error("[newsletter] confirm failed", err);
    return redirectTo("invalid");
  }
}
