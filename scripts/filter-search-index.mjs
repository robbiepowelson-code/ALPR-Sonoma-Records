import fs from "node:fs/promises"
import path from "node:path"

const projectRoot = process.cwd()
const indexPath = path.join(projectRoot, "public", "static", "contentIndex.json")

async function main() {
  const raw = await fs.readFile(indexPath, "utf8")
  const parsed = JSON.parse(raw)

  const filteredEntries = Object.entries(parsed).filter(([slug]) => slug === "documents" || slug.startsWith("documents/"))
  const filtered = Object.fromEntries(filteredEntries)

  await fs.writeFile(indexPath, `${JSON.stringify(filtered)}\n`, "utf8")
  console.log(`Filtered search index to ${filteredEntries.length} document entries.`)
}

main().catch((error) => {
  console.error(`Failed to filter search index: ${error.message}`)
  process.exit(1)
})
