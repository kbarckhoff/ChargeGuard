// Fee-schedule refresh: discover newest CMS file per source, download, parse to a
// normalized staging file, and DIFF against the current live version. Never
// promotes automatically — review the report, then run promote.mjs.
//
// Usage:
//   node scripts/fee-schedules/refresh.mjs               # all enabled sources
//   node scripts/fee-schedules/refresh.mjs --source=opps_addendum_b
//   node scripts/fee-schedules/refresh.mjs --inspect     # just dump detected headers (confirm column mapping)
import { join } from "node:path";
import { ENABLED_SOURCES, SOURCES } from "./sources.mjs";
import { PARSERS } from "./parsers.mjs";
import {
  httpGet, discoverLatestLink, extractFileHref, bufferToTables,
  quarterRank, quarterLabel, readManifest, writeManifest, writeJson, readJsonIf,
  STAGING_DIR, LIVE_DIR,
} from "./lib.mjs";

const args = process.argv.slice(2);
const inspect = args.includes("--inspect");
const only = args.find((a) => a.startsWith("--source="))?.split("=")[1];
const sources = (only ? SOURCES.filter((s) => s.key === only) : ENABLED_SOURCES);

if (sources.length === 0) { console.error("No matching source."); process.exit(1); }

// --probe=<url>: dump file-like links on a specific page (to fix extractFileHref)
const probe = args.find((a) => a.startsWith("--probe="))?.split("=")[1];
if (probe) {
  console.log(`── probing ${probe} ──`);
  const html = await httpGet(probe, true);
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m, n = 0;
  while ((m = anchorRe.exec(html)) && n < 80) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/\.(zip|xlsx?|csv|txt|pdf)(\?|$)|\/files\/|document|download/i.test(href)) {
      console.log(`  "${text}"  ->  ${href}`); n++;
    }
  }
  if (n === 0) console.log("  (no file-like links in <a> tags)");
  // raw scan: any CMS file URL anywhere in the page source (incl. JSON/script blobs)
  const raw = [...html.matchAll(/(?:https:\/\/www\.cms\.gov)?\/files\/(?:zip|document)\/[^"'\s\\)]+\.(?:zip|xlsx?|csv)/gi)]
    .map((m) => m[0]);
  const uniq = [...new Set(raw)];
  console.log(`  raw file URLs in source: ${uniq.length}`);
  uniq.slice(0, 20).forEach((u) => console.log("   ", u));
  process.exit(0);
}

// --links: dump candidate anchors from each source's landing page (to fix matchers)
if (args.includes("--links")) {
  const re = /(january|april|july|october|addendum|hcpcs|asp|payment limit|\b20\d\d\b)/i;
  for (const source of sources) {
    console.log(`\n── ${source.key}: anchors on ${source.landingUrl} ──`);
    try {
      const html = await httpGet(source.landingUrl, true);
      const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m, n = 0;
      while ((m = anchorRe.exec(html)) && n < 40) {
        const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text && re.test(text + " " + m[1])) { console.log(`  "${text}"  ->  ${m[1]}`); n++; }
      }
      if (n === 0) console.log("  (no matching anchors found in static HTML — page may be JS-rendered)");
    } catch (e) { console.log("  ERROR:", e.message); }
  }
  process.exit(0);
}

const manifest = readManifest();
let anyNew = false;

for (const source of sources) {
  console.log(`\n── ${source.name} [${source.key}] ──`);
  try {
    const latest = await discoverLatestLink(source);
    if (!latest) { console.log("  ! Could not find a quarterly link on the landing page. (Confirm linkMatcher in sources.mjs.)"); continue; }
    const rank = latest.rank;
    console.log(`  newest published: ${latest.label} (${quarterLabel(rank)})`);

    // resolve to an actual downloadable file
    let fileUrl = latest.pageUrl;
    if (!/\.(zip|xlsx?|csv|txt)(\?|$)/i.test(fileUrl)) {
      const page = await httpGet(latest.pageUrl, true);
      const href = extractFileHref(page, latest.pageUrl);
      if (!href) { console.log("  ! Found the quarter page but no downloadable file link on it. (Check extractFileHref.)"); continue; }
      fileUrl = href;
    }
    console.log(`  downloading: ${fileUrl}`);
    const buf = await httpGet(fileUrl);
    const tables = bufferToTables(buf, fileUrl.split("?")[0]);

    const parser = PARSERS[source.parser];
    if (inspect) {
      const info = parser(tables, { inspect: true, source });
      console.log("  detected:", JSON.stringify(info.inspect));
      console.log("  tables in file:", tables.map((t) => t.name).slice(0, 10));
      continue;
    }

    const parsed = parser(tables, { source });
    console.log(`  parsed ${parsed.meta.rows} rows (sheet: ${parsed.meta.sheet})`);

    // write staging
    const stagePath = join(STAGING_DIR, source.key, `${rank}.json`);
    writeJson(stagePath, {
      source: source.key, label: latest.label, rank, fetchedAt: new Date().toISOString(),
      fileUrl, feeds: source.feeds, data: parsed.data, activeCodes: parsed.activeCodes,
    });

    // diff vs live
    const live = readJsonIf(join(LIVE_DIR, `${source.key}.json`));
    const liveRank = live?.rank || 0;
    if (rank > liveRank) {
      anyNew = true;
      const added = Object.keys(parsed.data).length - (live ? Object.keys(live.data || {}).length : 0);
      console.log(`  NEW VERSION: staged ${quarterLabel(rank)} (live is ${live ? quarterLabel(liveRank) : "none"}). Code count delta: ${added >= 0 ? "+" : ""}${added}`);
      console.log(`  review, then: node scripts/fee-schedules/promote.mjs --source=${source.key}`);
    } else {
      console.log(`  up to date (live already ${quarterLabel(liveRank)}).`);
    }
    manifest.sources[source.key] = {
      ...(manifest.sources[source.key] || {}),
      lastChecked: new Date().toISOString(), latestPublished: quarterLabel(rank),
      stagedRank: rank, liveRank,
    };
  } catch (err) {
    console.log("  ERROR:", err.message);
  }
}

writeManifest(manifest);
console.log(anyNew ? "\nNew versions staged — review the deltas above, then run promote.mjs." : "\nAll sources up to date.");
