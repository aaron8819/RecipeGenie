"use client"

import { useState, useMemo } from "react"
import { Trash2, Pencil, Merge, X, Check, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useAllTags,
  useTagsWithCounts,
  useRenameTag,
  useMergeTags,
  useDeleteTag,
} from "@/hooks/use-recipes"
import { getTagClassName } from "@/lib/tag-colors"
import { cn } from "@/lib/utils"

interface TagManagementModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TagManagementModal({ open, onOpenChange }: TagManagementModalProps) {
  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()
  const renameTag = useRenameTag()
  const mergeTags = useMergeTags()
  const deleteTag = useDeleteTag()

  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [tagToManage, setTagToManage] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState("")
  const [mergeSources, setMergeSources] = useState<string[]>([])

  // Create a map of tag to count for quick lookup
  const tagCountMap = useMemo(() => {
    const map = new Map<string, number>()
    tagCounts.forEach(({ tag, count }) => map.set(tag, count))
    return map
  }, [tagCounts])

  const handleStartRename = (tag: string) => {
    setTagToManage(tag)
    setEditName(tag)
    setShowRenameDialog(true)
  }

  const handleConfirmRename = async () => {
    if (!tagToManage || !editName.trim() || editName.trim() === tagToManage) {
      setShowRenameDialog(false)
      setTagToManage(null)
      setEditName("")
      return
    }

    try {
      await renameTag.mutateAsync({
        oldTag: tagToManage,
        newTag: editName.trim(),
      })
      setShowRenameDialog(false)
      setTagToManage(null)
      setEditName("")
    } catch (error) {
      console.error("Failed to rename tag:", error)
      alert(error instanceof Error ? error.message : "Failed to rename tag")
    }
  }

  const handleStartMerge = (tag: string) => {
    setTagToManage(tag)
    setMergeSources([tag])
    setMergeTarget("")
    setShowMergeDialog(true)
  }

  const handleAddMergeSource = (tag: string) => {
    if (!mergeSources.includes(tag)) {
      setMergeSources([...mergeSources, tag])
    }
  }

  const handleRemoveMergeSource = (tag: string) => {
    setMergeSources(mergeSources.filter((t) => t !== tag))
  }

  const handleConfirmMerge = async () => {
    if (!mergeTarget || mergeSources.length === 0) {
      setShowMergeDialog(false)
      setTagToManage(null)
      setMergeSources([])
      setMergeTarget("")
      return
    }

    // Don't allow merging if target is in sources
    if (mergeSources.includes(mergeTarget)) {
      alert("Target tag cannot be one of the source tags")
      return
    }

    try {
      await mergeTags.mutateAsync({
        sourceTags: mergeSources,
        targetTag: mergeTarget,
      })
      setShowMergeDialog(false)
      setTagToManage(null)
      setMergeSources([])
      setMergeTarget("")
    } catch (error) {
      console.error("Failed to merge tags:", error)
      alert(error instanceof Error ? error.message : "Failed to merge tags")
    }
  }

  const handleStartDelete = (tag: string) => {
    setTagToManage(tag)
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    if (!tagToManage) return

    try {
      await deleteTag.mutateAsync(tagToManage)
      setShowDeleteDialog(false)
      setTagToManage(null)
    } catch (error) {
      console.error("Failed to delete tag:", error)
      alert(error instanceof Error ? error.message : "Failed to delete tag")
    }
  }

  const isLoading = renameTag.isPending || mergeTags.isPending || deleteTag.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {allTags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No tags yet. Add tags to recipes to manage them here.
              </div>
            ) : (
              <div className="space-y-2">
                {allTags.map((tag) => {
                  const count = tagCountMap.get(tag) || 0
                  const tagColors = getTagClassName(tag, false)
                  return (
                    <div
                      key={tag}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg border bg-card"
                    >
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", tagColors)}>
                        {tag}
                      </span>
                      <span className="text-xs text-muted-foreground flex-1">
                        {count} recipe{count !== 1 ? "s" : ""}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleStartRename(tag)}
                          disabled={isLoading}
                          title="Rename tag"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-blue-600"
                          onClick={() => handleStartMerge(tag)}
                          disabled={isLoading}
                          title="Merge into another tag"
                        >
                          <Merge className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleStartDelete(tag)}
                          disabled={isLoading}
                          title="Delete tag from all recipes"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <AlertDialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Rename "{tagToManage}" to a new name. This will update all recipes that use this tag.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="New tag name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename()
                if (e.key === "Escape") setShowRenameDialog(false)
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRename} disabled={!editName.trim() || isLoading}>
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Dialog */}
      <AlertDialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Tags</AlertDialogTitle>
            <AlertDialogDescription>
              Merge selected tags into a target tag. All recipes with the source tags will be updated to use the target tag.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Source Tags (to merge):</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {mergeSources.map((tag) => {
                  const tagColors = getTagClassName(tag, false)
                  return (
                    <div
                      key={tag}
                      className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", tagColors)}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveMergeSource(tag)}
                        className="hover:opacity-70"
                        disabled={mergeSources.length === 1}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
              {mergeSources.length < allTags.length && (
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value && !mergeSources.includes(value)) {
                      handleAddMergeSource(value)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add another tag to merge..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allTags
                      .filter((tag) => !mergeSources.includes(tag))
                      .map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Target Tag (merge into):</label>
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target tag..." />
                </SelectTrigger>
                <SelectContent>
                  {allTags
                    .filter((tag) => !mergeSources.includes(tag))
                    .map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmMerge}
              disabled={!mergeTarget || mergeSources.length === 0 || isLoading}
            >
              Merge Tags
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{tagToManage}" from all recipes? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
