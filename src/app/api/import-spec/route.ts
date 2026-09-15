import { NextResponse } from "next/server";
import { intakeFilesForFacility } from "@/lib/intake-files";

// Download a blank CSV template for one of the import files. The header row is the
// spec's column names; a second row documents which columns are required. Clients
// fill it in and upload, so the column mapping lines up the first time.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "").trim();
  const file = intakeFilesForFacility().find((f) => f.key === type);
  if (!file) {
    return NextResponse.json({ error: "Unknown file type" }, { status: 404 });
  }

  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = file.spec.map((c) => esc(c.name)).join(",");
  const reqRow = file.spec.map((c) => esc(c.required ? "REQUIRED" : "optional")).join(",");
  const csv = `${header}\n${reqRow}\n`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.key}-template.csv"`,
    },
  });
}
