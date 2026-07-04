import fs from "node:fs/promises"
import path from "node:path"

const MULTIREQUEST_URL =
  "https://www.muckrock.com/foi/multirequest/flock-safety-alpr-records-contracts-audit-logs-sb-34-communications-180160/"

const PROJECT_ROOT = process.cwd()
const INDEX_PATH = path.join(PROJECT_ROOT, "content", "index.md")
const TRACKER_PAGE_PATH = path.join(PROJECT_ROOT, "content", "requests", "muckrock-flock-tracker.md")

const INDEX_START = "<!-- AUTO_MUCKROCK_TRACKER_START -->"
const INDEX_END = "<!-- AUTO_MUCKROCK_TRACKER_END -->"

const statusMeta = {
  filed: { pct: 15, className: "cpra-filed" },
  acknowledged: { pct: 30, className: "cpra-acknowledged" },
  processing: { pct: 55, className: "cpra-processing" },
  "partially fulfilled": { pct: 75, className: "cpra-partial" },
  complete: { pct: 100, className: "cpra-complete" },
  completed: { pct: 100, className: "cpra-complete" },
  "for the record": { pct: 100, className: "cpra-complete" },
}

function decodeEntities(input) {
  return input
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

function normalizeWhitespace(input) {
  return input.replace(/\s+/g, " ").trim()
}

function toStatusMeta(statusText) {
  const normalized = statusText.toLowerCase()
  return statusMeta[normalized] ?? { pct: 45, className: "cpra-processing" }
}

function parseRequests(html) {
  const requests = []
  const pattern =
    /<span class="small badge[^\"]*">([\s\S]*?)<\/span>[\s\S]*?<p class="title">\s*<a href="([\s\S]*?)">([\s\S]*?)<\/a>\s*<\/p>/g

  for (const match of html.matchAll(pattern)) {
    const status = normalizeWhitespace(decodeEntities(match[1]))
    const rawHref = normalizeWhitespace(match[2])
    const href = rawHref.startsWith("http") ? rawHref : `https://www.muckrock.com${rawHref}`
    const title = normalizeWhitespace(decodeEntities(match[3]))

    if (!title.includes("Flock Safety ALPR Records")) {
      continue
    }

    const agencyMatch = title.match(/\(([^()]+)\)\s*$/)
    const agency = agencyMatch ? agencyMatch[1].trim() : title
    const idMatch = href.match(/-(\d+)\/?$/)
    const requestId = idMatch ? idMatch[1] : "Unknown"

    requests.push({
      agency,
      href,
      status,
      requestId,
    })
  }

  const deduped = []
  const seen = new Set()
  for (const req of requests) {
    if (seen.has(req.requestId)) continue
    seen.add(req.requestId)
    deduped.push(req)
  }

  return deduped
}

function renderTrackerSection(requests, dateLabel) {
  const rows = requests
    .map((req) => {
      const meta = toStatusMeta(req.status)
      return [
        '  <article class="cpra-tracker-item">',
        "    <header>",
        `      <h3><a href="${req.href}">${req.agency}</a></h3>`,
        `      <p class="cpra-status ${meta.className}">${req.status}</p>`,
        "    </header>",
        `    <div class="cpra-progress ${meta.className}" role="img" aria-label="${req.status}: approximately ${meta.pct} percent complete"></div>`,
        `    <p class="cpra-request-id">MuckRock Request #${req.requestId}</p>`,
        "  </article>",
      ].join("\n")
    })
    .join("\n\n")

  return [
    "## MuckRock CPRA request tracker",
    "",
    "Follow each request in this project and see where it currently sits in the process.",
    "",
    `[View source multi-request on MuckRock](${MULTIREQUEST_URL})`,
    "",
    "Status scale: Filed (15%) -> Acknowledged (30%) -> Processing (55%) -> Partially Fulfilled (75%) -> Completed (100%)",
    "",
    `_Auto-updated from MuckRock on ${dateLabel}_`,
    "",
    '<div class="cpra-tracker-grid">',
    rows,
    "</div>",
  ].join("\n")
}

function renderTrackerPage(section) {
  return [
    "---",
    'title: "MuckRock CPRA Tracker: Flock Safety ALPR Requests"',
    "tags: [request, tracker, muckrock]",
    "---",
    "",
    section,
    "",
    "## Related local archive pages",
    "",
    "- [[requests/26-5|Santa Rosa NextRequest 26-5]]",
    "- [[documents/gis-map|Map of Documents (GIS Map)]]",
  ].join("\n")
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function injectSectionIntoIndex(indexContent, section) {
  if (!indexContent.includes(INDEX_START) || !indexContent.includes(INDEX_END)) {
    throw new Error("Could not find tracker markers in content/index.md")
  }

  const markerBlock = new RegExp(`${escapeRegex(INDEX_START)}[\\s\\S]*?${escapeRegex(INDEX_END)}`)
  return indexContent.replace(markerBlock, `${INDEX_START}\n\n${section}\n\n${INDEX_END}`)
}

async function loadFallbackSection() {
  try {
    const existing = await fs.readFile(TRACKER_PAGE_PATH, "utf8")
    const start = existing.indexOf("## MuckRock CPRA request tracker")
    const end = existing.indexOf("## Related local archive pages")
    if (start === -1 || end === -1 || end <= start) {
      return null
    }
    return existing.slice(start, end).trim()
  } catch {
    return null
  }
}

async function main() {
  let section = null
  let updatedCount = null

  try {
    const response = await fetch(MULTIREQUEST_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch MuckRock page: ${response.status}`)
    }

    const html = await response.text()
    const requests = parseRequests(html)

    if (requests.length < 10) {
      throw new Error(`Expected at least 10 requests, found ${requests.length}`)
    }

    const dateLabel = new Date().toISOString().slice(0, 10)
    section = renderTrackerSection(requests, dateLabel)
    updatedCount = requests.length

    const trackerPage = renderTrackerPage(section)
    await fs.writeFile(TRACKER_PAGE_PATH, `${trackerPage}\n`, "utf8")
  } catch (error) {
    const fallback = await loadFallbackSection()
    if (!fallback) {
      throw error
    }
    section = fallback
    console.warn(`Using cached tracker snapshot due to fetch error: ${error.message}`)
  }

  const indexContent = await fs.readFile(INDEX_PATH, "utf8")
  const updatedIndex = injectSectionIntoIndex(indexContent, section)
  await fs.writeFile(INDEX_PATH, updatedIndex, "utf8")

  if (updatedCount !== null) {
    const dateLabel = new Date().toISOString().slice(0, 10)
    console.log(`Updated tracker for ${updatedCount} requests (${dateLabel})`)
  } else {
    console.log("Updated homepage tracker section from cached snapshot")
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
