import { createClient } from '@/lib/supabase/client'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

/**
 * Validates an image file before upload
 */
function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file.type || !ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${ALLOWED_TYPES.join(', ')}`,
    }
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    }
  }

  return { valid: true }
}

/**
 * Compresses/resizes an image file if needed
 * Returns the file (compressed if needed) or original file
 */
async function compressImageIfNeeded(file: File): Promise<File> {
  // If file is already small enough, return as-is
  if (file.size <= 1 * 1024 * 1024) { // 1MB
    return file
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve(file) // Fallback to original if canvas not supported
          return
        }

        // Calculate new dimensions (max 2000px width, maintain aspect ratio)
        const maxWidth = 2000
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: file.type,
                lastModified: Date.now(),
              })
              resolve(compressedFile)
            } else {
              resolve(file) // Fallback to original
            }
          },
          file.type,
          0.85 // 85% quality
        )
      }
      img.onerror = () => resolve(file) // Fallback to original on error
      img.src = e.target?.result as string
    }
    reader.onerror = () => resolve(file) // Fallback to original on error
    reader.readAsDataURL(file)
  })
}

/**
 * Uploads a recipe image to Supabase Storage
 * @param recipeId - The recipe ID
 * @param file - The image file to upload
 * @returns The public URL of the uploaded image
 */
export async function uploadRecipeImage(
  recipeId: string,
  file: File
): Promise<string> {
  // Validate file
  const validation = validateImageFile(file)
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid image file')
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('User not authenticated')
  }

  // Compress image if needed
  const processedFile = await compressImageIfNeeded(file)

  // Determine file extension
  const fileExt = file.name.split('.').pop() || 'jpg'
  const fileName = `${user.id}/${recipeId}.${fileExt}`

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('recipe-images')
    .upload(fileName, processedFile, {
      cacheControl: '3600',
      upsert: true, // Replace if exists
    })

  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`)
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('recipe-images').getPublicUrl(fileName)

  return publicUrl
}

/**
 * Deletes a recipe image from Supabase Storage
 * @param imageUrl - The full URL or path of the image to delete
 */
export async function deleteRecipeImage(imageUrl: string): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('User not authenticated')
  }

  // Extract file path from URL
  // URL format: https://<project>.supabase.co/storage/v1/object/public/recipe-images/<user_id>/<recipe_id>.<ext>
  const urlParts = imageUrl.split('/recipe-images/')
  if (urlParts.length !== 2) {
    // If it's not a Supabase Storage URL, it might be an external URL
    // In that case, we can't delete it, so just return
    console.warn('Cannot delete external image URL:', imageUrl)
    return
  }

  const fileName = urlParts[1]

  // Verify the file belongs to the current user
  if (!fileName.startsWith(`${user.id}/`)) {
    throw new Error('Unauthorized: Cannot delete image belonging to another user')
  }

  const { error } = await supabase.storage
    .from('recipe-images')
    .remove([fileName])

  if (error) {
    throw new Error(`Failed to delete image: ${error.message}`)
  }
}

/**
 * Gets the public URL for a recipe image
 * If the imageUrl is already a full URL, returns it as-is
 * If it's a Supabase Storage path, constructs the public URL
 */
export function getRecipeImageUrl(
  imageUrl: string | null | undefined
): string | null {
  if (!imageUrl) return null

  // If it's already a full URL, return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }

  // If it's a Supabase Storage path, construct public URL
  const supabase = createClient()
  const {
    data: { publicUrl },
  } = supabase.storage.from('recipe-images').getPublicUrl(imageUrl)

  return publicUrl
}
