'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useRecipe } from '@/hooks/use-recipes';
import { useCreateRecipeShare } from '@/hooks/use-recipe-shares';
import { useAsyncSubmit } from '@/hooks/use-async-submit';
import { getErrorMessage } from '@/lib/utils';

interface ShareRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string | null;
  onShared?: () => void;
}

const MESSAGE_LIMIT = 300;

export function ShareRecipeDialog({
  open,
  onOpenChange,
  recipeId,
  onShared,
}: ShareRecipeDialogProps) {
  const createShare = useCreateRecipeShare();
  const { data: recipe } = useRecipe(open ? recipeId : null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { clearError, error, isSubmitting, reset, run } = useAsyncSubmit({
    getErrorMessage: (submissionError) =>
      getErrorMessage(submissionError, 'Unable to share recipe.'),
  });

  useEffect(() => {
    if (!open) {
      setRecipientEmail('');
      setMessage('');
      reset();
      setSuccessMessage(null);
    }
  }, [open, reset]);

  const handleSubmit = async () => {
    if (!recipe) return;
    setSuccessMessage(null);

    await run(async () => {
      const result = await createShare.mutateAsync({
        recipeId: recipe.id,
        recipientEmail,
        message,
      });
      if (result.deduplicated) {
        setSuccessMessage('A pending share already exists for this recipient.');
      } else {
        setSuccessMessage('Recipe shared successfully.');
      }
      onShared?.();
    });
  };

  const canSubmit =
    !!recipe &&
    recipientEmail.trim().length > 0 &&
    message.length <= MESSAGE_LIMIT &&
    !createShare.isPending &&
    !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Share Recipe</DialogTitle>

        {recipe ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">Recipe</p>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {recipe.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                {recipe.category}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="share-recipient-email"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Recipient email
              </label>
              <Input
                id="share-recipient-email"
                type="email"
                placeholder="friend@example.com"
                value={recipientEmail}
                onChange={(e) => {
                  setRecipientEmail(e.target.value);
                  if (error) clearError();
                }}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="share-message"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Message (optional)
              </label>
              <Textarea
                id="share-message"
                placeholder="Thought you'd like this one..."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) clearError();
                }}
                maxLength={MESSAGE_LIMIT}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 text-right">
                {message.length}/{MESSAGE_LIMIT}
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                {successMessage}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createShare.isPending || isSubmitting}
              >
                Close
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {createShare.isPending || isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Share
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
