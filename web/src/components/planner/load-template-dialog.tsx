'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  weekLabel: string;
  currentRecipeCount: number;
}

export function LoadTemplateDialog({
  open,
  onOpenChange,
  onLoadTemplate,
  weekLabel,
  currentRecipeCount,
}: LoadTemplateDialogProps) {
  const { data: templates, isLoading } =
    usePlanTemplates();
  const { data: recipes } = useRecipes();
  const deleteTemplate = useDeletePlanTemplate();
  const renameTemplate = useRenamePlanTemplate();
  const [deleteTarget, setDeleteTarget] =
    useState<PlanTemplate | null>(null);
  const [loadTarget, setLoadTarget] =
    useState<PlanTemplate | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleLoad = (template: PlanTemplate) => {
    onLoadTemplate(template);
    setLoadTarget(null);
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

  const getTemplateSummary = (
    template: PlanTemplate
  ): { valid: number; missing: number; assigned: number } => {
    const { valid, missing } = getValidRecipeCount(template);
    const assigned = template.day_assignments
      ? Object.keys(template.day_assignments).length
      : 0;
    return { valid, missing, assigned };
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
          <DialogDescription className="sr-only">
            Review a saved template, then confirm loading it into the currently visible week.
          </DialogDescription>
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
                  const { valid, missing, assigned } =
                    getTemplateSummary(template);
                  return (
                    <div
                      key={template.id}
                      className="flex items-start gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
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
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">
                              {template.name}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
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
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              {assigned > 0 ? (
                                <span className="rounded-full bg-muted px-2 py-1">
                                  {assigned} day assignment
                                  {assigned !== 1 ? 's' : ''}
                                </span>
                              ) : (
                                <span className="rounded-full bg-muted px-2 py-1">
                                  No saved day assignments
                                </span>
                              )}
                              {template.category_selection ? (
                                <span className="rounded-full bg-muted px-2 py-1">
                                  Includes meal mix
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setLoadTarget(template)
                            }
                            className="shrink-0"
                          >
                            Load
                          </Button>
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

      <AlertDialog
        open={!!loadTarget}
        onOpenChange={(o) => !o && setLoadTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Load template into {weekLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {loadTarget ? (
                <>
                  This will load &quot;{loadTarget.name}&quot; into the visible week.
                  {currentRecipeCount > 0 ? (
                    <> It will replace {currentRecipeCount} currently planned recipe{currentRecipeCount !== 1 ? 's' : ''}.</>
                  ) : (
                    <> Your current week is empty.</>
                  )}
                  {' '}Rename and delete are unchanged.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {loadTarget ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <div>
                Template: <span className="font-medium text-foreground">{loadTarget.name}</span>
              </div>
              <div>
                Week: <span className="font-medium text-foreground">{weekLabel}</span>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (loadTarget) {
                  handleLoad(loadTarget);
                }
              }}
            >
              Load Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
