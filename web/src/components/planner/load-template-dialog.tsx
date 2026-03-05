'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Trash2, Calendar, Pencil, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  usePlanTemplates,
  useDeletePlanTemplate,
  useRenamePlanTemplate,
} from '@/hooks/use-plan-templates';
import { useRecipes } from '@/hooks/use-recipes';
import type { PlanTemplate } from '@/types/database';

interface LoadTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadTemplate: (template: PlanTemplate) => void;
}

export function LoadTemplateDialog({
  open,
  onOpenChange,
  onLoadTemplate,
}: LoadTemplateDialogProps) {
  const { data: templates, isLoading } =
    usePlanTemplates();
  const { data: recipes } = useRecipes();
  const deleteTemplate = useDeletePlanTemplate();
  const renameTemplate = useRenamePlanTemplate();
  const [deleteTarget, setDeleteTarget] =
    useState<PlanTemplate | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleLoad = (template: PlanTemplate) => {
    onLoadTemplate(template);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteTemplate.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const startRename = (template: PlanTemplate) => {
    setRenamingId(template.id);
    setRenameValue(template.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const submitRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    await renameTemplate.mutateAsync({
      templateId: renamingId,
      name: renameValue.trim(),
    });
    setRenamingId(null);
    setRenameValue('');
  };

  // Check which recipe IDs from a template still exist
  const getValidRecipeCount = (
    template: PlanTemplate
  ): { valid: number; missing: number } => {
    if (!recipes) {
      return {
        valid: template.recipe_ids.length,
        missing: 0,
      };
    }
    const recipeIdSet = new Set(
      recipes.map((r) => r.id)
    );
    const valid = template.recipe_ids.filter((id) =>
      recipeIdSet.has(id)
    ).length;
    return {
      valid,
      missing: template.recipe_ids.length - valid,
    };
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogTitle>Load Template</DialogTitle>
          <div className="flex-1 overflow-y-auto py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !templates || templates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No saved templates yet. Generate a plan
                and save it as a template to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => {
                  const { valid, missing } =
                    getValidRecipeCount(template);
                  return (
                    <div
                      key={template.id}
                      className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      {renamingId === template.id ? (
                        <>
                          <div className="flex-1 min-w-0">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') cancelRename();
                              }}
                              autoFocus
                              className="h-8 text-sm"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={submitRename}
                            disabled={!renameValue.trim() || renameTemplate.isPending}
                            className="shrink-0 text-primary hover:text-primary"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={cancelRename}
                            className="shrink-0 text-muted-foreground"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              handleLoad(template)
                            }
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="font-medium truncate">
                              {template.name}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                              <Calendar className="h-3 w-3" />
                              {valid} recipe
                              {valid !== 1 ? 's' : ''}
                              {missing > 0 && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  ({missing} deleted)
                                </span>
                              )}
                              <span>
                                {template.created_at
                                  ? new Date(template.created_at).toLocaleDateString()
                                  : "Unknown date"}
                              </span>
                            </div>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              startRename(template)
                            }
                            className="shrink-0 text-muted-foreground hover:text-primary"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setDeleteTarget(template)
                            }
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete Template
            </AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;?
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
