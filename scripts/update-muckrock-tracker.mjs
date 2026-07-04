import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

const MULTIREQUEST_URL =
  "https://www.muckrock.com/foi/multirequest/flock-safety-alpr-records-contracts-audit-logs-sb-34-communications-180160/"

const PROJECT_ROOT = process.cwd()
const INDEX_PATH = path.join(PROJECT_ROOT, "content", "index.md")
const TRACKER_PAGE_PATH = path.join(PROJECT_ROOT, "content", "requests", "muckrock-flock-tracker.md")
const PROGRESS_STATE_PATH = path.join(PROJECT_ROOT, "scripts", "muckrock-progress-state.json")

const INDEX_START = "<!-- AUTO_MUCKROCK_TRACKER_START -->"
const INDEX_END = "<!-- AUTO_MUCKROCK_TRACKER_END -->"

const statusMeta = {
  submitted: { pct: 15, className: "cpra-filed" },
  filed: { pct: 15, className: "cpra-filed" },
  acknowledged: { pct: 25, className: "cpra-acknowledged" },
  processing: { pct: 15, className: "cpra-processing" },
  "in progress": { pct: 35, className: "cpra-processing" },
  "in review": { pct: 45, className: "cpra-processing" },
  "partially fulfilled": { pct: 70, className: "cpra-partial" },
  "partially complete": { pct: 70, className: "cpra-partial" },
  fulfilled: { pct: 100, className: "cpra-complete" },
  complete: { pct: 100, className: "cpra-complete" },
  completed: { pct: 100, className: "cpra-complete" },
  "for the record": { pct: 100, className: "cpra-complete" },
  closed: { pct: 100, className: "cpra-complete" },
  denied: { pct: 100, className: "cpra-complete" },
  withdrawn: { pct: 100, className: "cpra-complete" },
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
  return statusMeta[normalized] ?? { pct: 15, className: "cpra-processing" }
}

function classForProgress(pct, statusText) {
  const normalized = statusText.toLowerCase()
  if (pct >= 100) return "cpra-complete"
  if (pct >= 70) return "cpra-partial"
  if (normalized.includes("acknowledged")) return "cpra-acknowledged"
  if (normalized.includes("filed") || normalized.includes("submitted")) return "cpra-filed"
  return "cpra-processing"
}

async function loadProgressState() {
  try {
    const raw = await fs.readFile(PROGRESS_STATE_PATH, "utf8")
    const parsed = JSON.parse(raw)
    return {
      requests: parsed?.requests ?? {},
    }
  } catch {
    return { requests: {} }
  }
}

async function saveProgressState(state) {
  const content = `${JSON.stringify(state, null, 2)}\n`
  await fs.writeFile(PROGRESS_STATE_PATH, content, "utf8")
}

function applyMonotonicProgress(requests, priorState) {
  const nextState = {
    requests: { ...(priorState?.requests ?? {}) },
  }

  const mappedRequests = requests.map((req) => {
    const rawMeta = toStatusMeta(req.status)
    const previous = nextState.requests[req.requestId]

    let progressPct = rawMeta.pct
    let displayStatus = req.status

    if (previous && typeof previous.pct === "number" && previous.pct > rawMeta.pct) {
      progressPct = previous.pct
      displayStatus = previous.status ?? req.status
    }

    const progressClass = classForProgress(progressPct, displayStatus)

    nextState.requests[req.requestId] = {
      pct: progressPct,
      status: displayStatus,
      updatedAt: new Date().toISOString(),
    }

    return {
      ...req,
      status: displayStatus,
      progressPct,
      progressClass,
    }
  })

  return {
    requests: mappedRequests,
    state: nextState,
  }
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

async function fetchMultirequestHtml() {
  const response = await fetch(MULTIREQUEST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  })

  if (response.ok) {
    return response.text()
  }

  const fallback = spawnSync("curl", ["-Ls", MULTIREQUEST_URL], { encoding: "utf8" })
  if (fallback.status === 0 && fallback.stdout.includes("10 Requests")) {
    return fallback.stdout
  }

  throw new Error(`Failed to fetch MuckRock page: ${response.status}`)
}

function renderTrackerSection(requests, dateLabel) {
  const rows = requests
    .map((req) => {
      return [
        '  <article class="cpra-tracker-item">',
        "    <header>",
        `      <h3><a href="${req.href}">${req.agency}</a></h3>`,
        `      <p class="cpra-status ${req.progressClass}">${req.status}</p>`,
        "    </header>",
        `    <div class="cpra-progress ${req.progressClass}" style="--cpra-progress: ${req.progressPct}%;" role="img" aria-label="${req.status}: approximately ${req.progressPct} percent complete"></div>`,
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
    "Status scale: Initial/Processing (15%) -> Acknowledged (25%) -> In Progress (35%+) -> Partially Fulfilled (70%) -> Completed/Closed (100%)",
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

async function loadFallbackRequestsFromTrackerPage() {
  try {
    const existing = await fs.readFile(TRACKER_PAGE_PATH, "utf8")
    const requestPattern =
      /<h3><a href="([^"]+)">([^<]+)<\/a><\/h3>[\s\S]*?<p class="cpra-status[^\"]*">([^<]+)<\/p>[\s\S]*?MuckRock Request #(\d+)/g

    const requests = []
    for (const match of existing.matchAll(requestPattern)) {
      requests.push({
        href: normalizeWhitespace(match[1]),
        agency: normalizeWhitespace(decodeEntities(match[2])),
        status: normalizeWhitespace(decodeEntities(match[3])),
        requestId: normalizeWhitespace(match[4]),
      })
    }

    return requests
  } catch {
    return []
  }
}

async function main() {
  let section = null
  let updatedCount = null

  const progressState = await loadProgressState()

  try {
    const html = await fetchMultirequestHtml()
    const requests = parseRequests(html)

    if (requests.length < 10) {
      throw new Error(`Expected at least 10 requests, found ${requests.length}`)
    }

    const tracked = applyMonotonicProgress(requests, progressState)

    const dateLabel = new Date().toISOString().slice(0, 10)
    section = renderTrackerSection(tracked.requests, dateLabel)
    updatedCount = requests.length

    const trackerPage = renderTrackerPage(section)
    await fs.writeFile(TRACKER_PAGE_PATH, `${trackerPage}\n`, "utf8")
    await saveProgressState(tracked.state)
  } catch (error) {
    const fallbackRequests = await loadFallbackRequestsFromTrackerPage()
    if (fallbackRequests.length > 0) {
      const tracked = applyMonotonicProgress(fallbackRequests, progressState)
      const dateLabel = new Date().toISOString().slice(0, 10)
      section = renderTrackerSection(tracked.requests, dateLabel)
      const trackerPage = renderTrackerPage(section)
      await fs.writeFile(TRACKER_PAGE_PATH, `${trackerPage}\n`, "utf8")
      await saveProgressState(tracked.state)
      console.warn(`Using cached tracker rows due to fetch error: ${error.message}`)
      updatedCount = tracked.requests.length
    } else {
      const fallback = await loadFallbackSection()
      if (!fallback) {
        throw error
      }
      section = fallback
      console.warn(`Using cached tracker snapshot due to fetch error: ${error.message}`)
    }
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
