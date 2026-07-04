import fs from "node:fs/promises"
import path from "node:path"
import { globby } from "globby"
import YAML from "yaml"

const projectRoot = process.cwd()
const docsGlob = "content/documents/**/*.md"

function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { frontmatterRaw: null, body: raw }
  }

  const end = raw.indexOf("\n---\n", 4)
  if (end === -1) {
    return { frontmatterRaw: null, body: raw }
  }

  return {
    frontmatterRaw: raw.slice(4, end),
    body: raw.slice(end + 5),
  }
}

function markdownToPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function toTitleCase(input) {
  return input
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9-]+$/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(" ")
}

function toReadableTitle(fileName) {
  const extMatch = fileName.match(/\.([A-Za-z0-9]+)$/)
  const fileExt = extMatch ? extMatch[1].toUpperCase() : "DOC"

  const stem = fileName.replace(/\.[A-Za-z0-9]+$/, "")
  const cleaned = stem
    .replace(/\bmsg\b/gi, "")
    .replace(/\bredacted\b/gi, "")
    .replace(/[_\.]+/g, " ")
    .replace(/\s*[-]+\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()

  // Keep IDs and key terms visible while avoiding graph-node overflow.
  const maxChars = 44
  const clamped = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1).trim()}…` : cleaned
  const title = toTitleCase(clamped)

  return `${title} (${fileExt})`
}

function extractMetadata(markdown) {
  const fileMatch = markdown.match(/\*\*File:\*\*\s*`([^`]+)`/i)

  const fileName = fileMatch?.[1]?.trim() || ""

  if (!fileName) {
    return null
  }
  const title = toReadableTitle(fileName)

  return {
    title,
  }
}

async function main() {
  const files = await globby(docsGlob, { cwd: projectRoot, absolute: true })
  let updated = 0

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8")
    const { frontmatterRaw, body } = splitFrontmatter(raw)
    if (frontmatterRaw === null) {
      continue
    }

    const frontmatter = YAML.parse(frontmatterRaw) || {}
    const plainText = markdownToPlainText(body)
    const metadata = extractMetadata(body)
    if (!plainText) {
      continue
    }

    const nextDescription = plainText
    const nextTitle = metadata?.title || frontmatter.title

    if (frontmatter.description === nextDescription && frontmatter.title === nextTitle) {
      continue
    }

    frontmatter.description = nextDescription
    if (nextTitle) {
      frontmatter.title = nextTitle
    }
    const nextFrontmatter = YAML.stringify(frontmatter).trimEnd()
    const next = `---\n${nextFrontmatter}\n---\n\n${body.replace(/^\n+/, "")}`
    await fs.writeFile(filePath, next, "utf8")
    updated++
  }

  console.log(`Updated descriptions in ${updated} document files.`)
}

main().catch((error) => {
  console.error(`Failed to enrich document descriptions: ${error.message}`)
  process.exit(1)
})
