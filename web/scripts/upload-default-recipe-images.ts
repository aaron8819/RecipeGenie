/**
 * Upload default recipe images to Supabase Storage (recipe-images/defaults)
 *
 * Usage:
 *   npx tsx scripts/upload-default-recipe-images.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

config({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required environment variables:")
  console.error("  NEXT_PUBLIC_SUPABASE_URL")
  console.error("  SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const IMAGE_DIR_CANDIDATES = [
  path.resolve(process.cwd(), ".cursor", "images"),
  path.resolve(process.cwd(), "..", ".cursor", "images"),
]

const IMAGE_DIR =
  IMAGE_DIR_CANDIDATES.find((candidate) => existsSync(candidate)) ||
  IMAGE_DIR_CANDIDATES[0]

const DEFAULT_IMAGES = [
  "mac-and-cheese.webp",
  "beef-and-broccoli.webp",
  "lamb-meatballs-gyros.webp",
  "mediterranean-turkey-meatballs.webp",
  "mexican-street-tacos-chicken.webp",
  "teriyaki-chicken-broccoli-bowls.webp",
  "thai-basil-fried-rice.webp",
  "turkey-burger.webp",
]

async function uploadImage(fileName: string): Promise<void> {
  const filePath = path.join(IMAGE_DIR, fileName)
  const file = await readFile(filePath)
  const storagePath = `defaults/${fileName}`

  const { error } = await supabase.storage
    .from("recipe-images")
    .upload(storagePath, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: "image/webp",
    })

  if (error) {
    throw new Error(`Failed to upload ${fileName}: ${error.message}`)
  }

  const { data } = supabase.storage.from("recipe-images").getPublicUrl(storagePath)
  console.log(`Uploaded: ${fileName}`)
  console.log(`  Public URL: ${data.publicUrl}`)
}

async function main() {
  console.log("Uploading default recipe images...\n")
  for (const fileName of DEFAULT_IMAGES) {
    await uploadImage(fileName)
  }
  console.log("\nDone.")
}

main().catch((error) => {
  console.error("Upload failed:", error)
  process.exit(1)
})
