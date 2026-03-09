'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { useSavePlanTemplate } from '@/hooks/use-plan-templates';
import { useAsyncSubmit } from '@/hooks/use-async-submit';
import { getErrorMessage } from '@/lib/utils';

interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeIds: string[];
  dayAssignments: Record<string, number> | null;
  categorySelection: Record<string, number> | null;
}

export function SaveTemplateDialog({
  open,
  onOpenChange,
  recipeIds,
  dayAssignments,
  categorySelection,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState('');
  const saveTemplate = useSavePlanTemplate();
  const undoToast = useUndoToast();
  const { isSubmitting, run } = useAsyncSubmit({
    getErrorMessage: (error) => getErrorMessage(error, `Failed to save template "${name.trim()}"`),
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    const templateName = name.trim();

    await run(async () => {
      await saveTemplate.mutateAsync({
        name: templateName,
        recipeIds,
        dayAssignments,
        categorySelection,
      });
      undoToast.show({
        message: `Template "${templateName}" saved with ${recipeIds.length} planned recipe${recipeIds.length === 1 ? '' : 's'}`,
        duration: 4000,
      });
      setName('');
      onOpenChange(false);
    }, {
      onError: (error) => {
        undoToast.show({
          message: getErrorMessage(error, `Failed to save template "${templateName}"`),
          duration: 4000,
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Save as Template</DialogTitle>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">
              Template Name
            </Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weeknight Favorites"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSave();
                }
              }}
              autoFocus
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Saves {recipeIds.length} recipe
            {recipeIds.length !== 1 ? 's' : ''} with their
            day assignments as a reusable template.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !name.trim() || saveTemplate.isPending || isSubmitting
            }
          >
            {saveTemplate.isPending || isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
