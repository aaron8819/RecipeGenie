'use client';

import React from 'react';
import { Check, Inbox, Loader2, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAcceptRecipeShare,
  useDeclineRecipeShare,
  useIncomingRecipeShares,
  useSentRecipeShares,
} from '@/hooks/use-recipe-shares';
import { getErrorMessage } from '@/lib/utils';

interface SharedRecipesInboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SharedRecipesInbox({
  open,
  onOpenChange,
}: SharedRecipesInboxProps) {
  const incoming = useIncomingRecipeShares();
  const sent = useSentRecipeShares();
  const acceptShare = useAcceptRecipeShare();
  const declineShare = useDeclineRecipeShare();

  const incomingError = incoming.error
    ? getErrorMessage(incoming.error, 'Unable to load inbox')
    : null;
  const sentError = sent.error
    ? getErrorMessage(sent.error, 'Unable to load sent shares')
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden">
        <DialogTitle>Shared Recipes</DialogTitle>

        <Tabs defaultValue="inbox" className="h-full flex flex-col gap-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="inbox">Shared With Me</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="overflow-y-auto pr-1">
            {incoming.isLoading ? (
              <div className="py-10 flex items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading recipes shared with you...
              </div>
            ) : incomingError ? (
              <p className="text-sm text-destructive">{incomingError}</p>
            ) : incoming.data?.length ? (
              <div className="space-y-3">
                {incoming.data.map((share) => {
                  const isPending = share.status === 'pending';
                  const isBusy =
                    acceptShare.isPending || declineShare.isPending;

                  return (
                    <article
                      key={share.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {share.source_recipe_snapshot.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            From {share.sender_email} on{' '}
                            {new Date(share.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="text-xs capitalize rounded-full px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {share.status}
                        </span>
                      </div>

                      {share.message ? (
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          "{share.message}"
                        </p>
                      ) : null}

                      {isPending ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => acceptShare.mutate(share.id)}
                            disabled={isBusy}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => declineShare.mutate(share.id)}
                            disabled={isBusy}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Decline
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                <Inbox className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium text-slate-700 dark:text-slate-200">No recipes shared with you yet</p>
                <p className="mt-2 text-sm">
                  When someone shares a recipe with you, it will appear here to review and accept.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="sent" className="overflow-y-auto pr-1">
            {sent.isLoading ? (
              <div className="py-10 flex items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading recipes you have shared...
              </div>
            ) : sentError ? (
              <p className="text-sm text-destructive">{sentError}</p>
            ) : sent.data?.length ? (
              <div className="space-y-3">
                {sent.data.map((share) => (
                  <article
                    key={share.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-1.5"
                  >
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {share.source_recipe_snapshot.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      To {share.recipient_email} on{' '}
                      {new Date(share.created_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs capitalize text-slate-500 dark:text-slate-400">
                      Status: {share.status}
                    </p>
                    {share.message ? (
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        "{share.message}"
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                <Mail className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium text-slate-700 dark:text-slate-200">No shared recipes sent yet</p>
                <p className="mt-2 text-sm">
                  Open any recipe and use Share when you want to send one to someone else.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
