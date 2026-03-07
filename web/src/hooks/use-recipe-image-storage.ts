"use client"

import { useCallback } from "react"
import { deleteRecipeImage, uploadRecipeImage } from "@/lib/supabase/storage"

export function useRecipeImageStorage() {
  const uploadImage = useCallback((recipeId: string, file: File) => {
    return uploadRecipeImage(recipeId, file)
  }, [])

  const deleteImage = useCallback((imageUrl: string) => {
    return deleteRecipeImage(imageUrl)
  }, [])

  return {
    uploadImage,
    deleteImage,
  }
}
