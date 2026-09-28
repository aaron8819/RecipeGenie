import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canonicalShoppingPayload, readShoppingCommand, SHOPPING_COMMAND_BYTES } from '@/lib/shopping-command';
import { planShoppingCommand, type ShoppingCommandContext } from '@/lib/shopping-command-planner';

export const runtime = 'nodejs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function boundedBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('InvalidInput');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SHOPPING_COMMAND_BYTES) { await reader.cancel(); throw new Error('InvalidInput'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  // Cookie-authenticated mutations accept same-origin requests only.
  const origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    const parsed = new URL(origin || '');
    sameOrigin = parsed.host === request.headers.get('host') &&
      ['http:', 'https:'].includes(parsed.protocol);
  } catch { /* Missing or malformed Origin cannot authorize a mutation. */ }
  if (!sameOrigin) return response({ status: 'Forbidden' }, 403);
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return response({ status: 'Unauthenticated' }, 401);
  let input;
  try { input = await boundedBody(request); } catch { return response({ status: 'InvalidInput' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return response({ status: 'InvalidInput' }, 400);
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['operationId', 'phase', 'command', 'sequence'].includes(key)) ||
    typeof body.operationId !== 'string' || !uuid.test(body.operationId) ||
    !['admit', 'recover', 'execute'].includes(String(body.phase))) return response({ status: 'InvalidInput' }, 400);
  const command = readShoppingCommand(body.command);
  if (!command) return response({ status: 'UpdateRequired' }, 400);
  const hash = createHash('sha256').update(canonicalShoppingPayload(command)).digest('hex');
  const admin = createAdminClient();
  const args = { p_owner: user.id, p_operation: body.operationId, p_hash: hash };
  try {
    if (body.phase !== 'execute') {
      const { data, error: rpcError } = await admin.rpc('shopping_admit', {
        ...args, p_recover: body.phase === 'recover',
      });
      if (rpcError) throw rpcError;
      return response(data);
    }
    if (typeof body.sequence !== 'string' || !/^[1-9][0-9]{0,17}$/.test(body.sequence)) return response({ status: 'UnknownAdmission' }, 400);
    const ticket = { ...args, p_sequence: body.sequence };
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: context, error: contextError } = await admin.rpc('shopping_command_context', ticket);
      if (contextError) throw contextError;
      if (context.status !== 'Pending') return response(context);
      const snapshot = context as ShoppingCommandContext;
      const plan = planShoppingCommand(snapshot, command);
      const action = command.mutation.type === 'undoClear' ? 'restoreContent' :
        ['initialize', 'complete', 'restoreContent', 'pantry', 'deleteRecipe'].includes(command.mutation.type)
        ? command.mutation.type : 'mutation';
      const { data: committed, error: commitError } = await admin.rpc('shopping_commit', {
        ...ticket, p_revision: snapshot.row?.content_revision ?? null,
        p_dependency: snapshot.dependencyRevision, p_document: plan.document,
        p_outcome: plan.outcome, p_action: action, p_pantry_item: plan.pantryItem,
        p_recipe: command.mutation.type === 'deleteRecipe' ? command.mutation.recipeId : null,
      });
      if (commitError) throw commitError;
      if (committed.status === 'Replan') continue;
      return response({ ...committed, before: committed.status === 'Applied' ? plan.before : undefined });
    }
    // A transient race leaves the slot Pending. Retrying uses this same ticket.
    return response({ status: 'DependencyUnavailable' }, 503);
  } catch {
    // Never return SQL details, credentials, or a fabricated successful result.
    return response({ status: 'DependencyUnavailable' }, 503);
  }
}
