'use client';

import { useState } from 'react';
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
import { useSavePlanTemplate } from '@/hooks/use-plan-templates';

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

  const handleSave = async () => {
    if (!name.trim()) return;
    await saveTemplate.mutateAsync({
      name: name.trim(),
      recipeIds,
      dayAssignments,
      categorySelection,
    });
    setName('');
    onOpenChange(false);
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
              !name.trim() || saveTemplate.isPending
            }
          >
            {saveTemplate.isPending ? (
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
