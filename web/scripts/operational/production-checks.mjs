const EXPECTED_TABLES = [
  "pantry_items", "plan_templates", "recipe_history", "recipe_shares", "recipes",
  "shopping_list",
  "user_config", "weekly_plans",
]

const EXPECTED_COLUMNS = [
  "recipes.recipe_uuid", "recipes.ingredient_sections", "recipes.instruction_sections",
  "recipes.user_id",
  "weekly_plans.recipe_uuids", "weekly_plans.day_assignment_recipe_uuids", "weekly_plans.made_recipe_uuids",
  "plan_templates.recipe_uuids", "plan_templates.day_assignment_recipe_uuids",
  "recipe_history.recipe_uuid", "recipe_shares.source_recipe_uuid", "recipe_shares.accepted_recipe_uuid",
  "shopping_list.document", "shopping_list.content_revision", "shopping_list.updated_at",
  "pantry_items.item",
]

const EXPECTED_CONSTRAINTS = [
  "recipes_pkey", "recipes_recipe_uuid_key", "shopping_list_pkey",
  "pantry_items_user_id_item_key", "shopping_list_document_v1_check",
]

const EXPECTED_INDEXES = [
  "idx_recipes_user_id", "recipe_history_recipe_uuid_idx",
  "recipe_shares_source_recipe_uuid_idx",
]

const EXPECTED_FUNCTIONS = [
  "accept_recipe_share", "delete_recipe", "get_recipe_history_stats",
  "move_shopping_document_item_to_pantry", "resolve_recipe_identity",
  "toggle_weekly_recipe_made",
]

const EXPECTED_TRIGGERS = [
  "enforce_shopping_document_revision_on_update", "enforce_recipe_uuid_insert",
  "prevent_recipe_identity_change", "prevent_recipe_uuid_update",
  "sync_plan_template_recipe_uuids", "sync_recipe_history_uuid", "sync_recipe_share_uuids",
  "sync_weekly_plan_recipe_uuids",
]

function missing(expected, actual) {
  const found = new Set(actual)
  return expected.filter((value) => !found.has(value))
}

async function loadCatalog(query) {
  const rows = await query(`
    select jsonb_build_object(
      'tables', (select jsonb_agg(c.relname order by c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')),
      'columns', (select jsonb_agg(cols.table_name || '.' || cols.column_name order by cols.table_name, cols.ordinal_position)
        from information_schema.columns cols where cols.table_schema = 'public'),
      'constraints', (select jsonb_agg(con.conname order by con.conname)
        from pg_constraint con join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
      'indexes', (select jsonb_agg(indexname order by indexname)
        from pg_indexes where schemaname = 'public'),
      'functions', (select jsonb_agg(distinct p.proname order by p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
      'triggers', (select jsonb_agg(t.tgname order by t.tgname)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal)
    ) as catalog
  `)
  return rows[0].catalog
}

function requireCatalogGroup(label, expected, actual) {
  const absent = missing(expected, actual || [])
  if (absent.length) throw new Error(`missing ${label}: ${absent.join(", ")}`)
  return `${expected.length} required ${label} present`
}

export function createApplicationChecks({
  appUrl,
  expectedSha,
  expectedProjectRef,
  databaseUrl,
  fetchImpl = fetch,
}) {
  const versionUrl = new URL("/api/version", appUrl).toString()
  let manifest
  return {
    getManifest: () => manifest,
    checks: [
      {
        name: "production-application-url",
        run: async () => {
          const response = await fetchImpl(appUrl, { signal: AbortSignal.timeout(10_000) })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return `HTTP ${response.status}`
        },
      },
      {
        name: "deployment-manifest",
        run: async () => {
          const response = await fetchImpl(versionUrl, { signal: AbortSignal.timeout(10_000) })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          manifest = parsePublicManifest(await response.json())
          return "valid public manifest"
        },
      },
      {
        name: "deployed-git-sha",
        run: async () => {
          if (!manifest) throw new Error("deployment manifest unavailable")
          if (!manifest.gitSha) throw new Error("deployed manifest has no Git SHA")
          if (manifest.gitSha.toLowerCase() !== expectedSha.toLowerCase()) {
            throw new Error("deployed SHA does not match explicitly supplied SHA")
          }
          return "deployed SHA matches expected SHA"
        },
      },
      {
        name: "supabase-project-reference",
        run: async () => {
          if (!manifest) throw new Error("deployment manifest unavailable")
          if (manifest.expectedSupabaseProjectRef !== expectedProjectRef) {
            throw new Error("manifest project reference does not match expected project")
          }
          if (!databaseUrlMatchesProject(databaseUrl, expectedProjectRef)) {
            throw new Error("database endpoint identity does not match expected project")
          }
          return "manifest and database endpoint match expected project"
        },
      },
    ],
  }
}

export function createDatabaseChecks(expectedMigration) {
  let catalog
  const migrationVersion = expectedMigration.split("_", 1)[0]
  return [
    {
      name: "database-connectivity",
      run: async ({ query }) => {
        const rows = await query("select current_setting('transaction_read_only') as read_only")
        if (rows[0]?.read_only !== "on") throw new Error("database session is not read-only")
        return "connected with a read-only transaction"
      },
    },
    {
      name: "migration-history-readable",
      run: async ({ query }) => {
        const rows = await query("select to_regclass('supabase_migrations.schema_migrations')::text as relation")
        if (!rows[0]?.relation) throw new Error("supabase_migrations.schema_migrations is missing or unreadable")
        await query("select version from supabase_migrations.schema_migrations limit 0")
        return "migration history is readable"
      },
    },
    {
      name: "expected-migration",
      run: async ({ query }) => {
        const rows = await query("select max(version) as latest, count(*) filter (where version = $1) as matches from supabase_migrations.schema_migrations", [migrationVersion])
        if (Number(rows[0]?.matches) !== 1) throw new Error(`migration ${expectedMigration} is not present`)
        if (rows[0]?.latest !== migrationVersion) throw new Error(`latest migration is ${rows[0]?.latest || "unknown"}, expected ${migrationVersion}`)
        return `${expectedMigration} is the latest migration`
      },
    },
    {
      name: "critical-tables-and-columns",
      run: async ({ query }) => {
        catalog ||= await loadCatalog(query)
        requireCatalogGroup("tables", EXPECTED_TABLES, catalog.tables)
        requireCatalogGroup("columns", EXPECTED_COLUMNS, catalog.columns)
        return `${EXPECTED_TABLES.length} tables and ${EXPECTED_COLUMNS.length} critical columns present`
      },
    },
    {
      name: "critical-constraints-and-indexes",
      run: async ({ query }) => {
        catalog ||= await loadCatalog(query)
        requireCatalogGroup("constraints", EXPECTED_CONSTRAINTS, catalog.constraints)
        requireCatalogGroup("indexes", EXPECTED_INDEXES, catalog.indexes)
        return `${EXPECTED_CONSTRAINTS.length} constraints and ${EXPECTED_INDEXES.length} indexes present`
      },
    },
    {
      name: "critical-functions-rpcs-and-triggers",
      run: async ({ query }) => {
        catalog ||= await loadCatalog(query)
        requireCatalogGroup("functions/RPCs", EXPECTED_FUNCTIONS, catalog.functions)
        requireCatalogGroup("triggers", EXPECTED_TRIGGERS, catalog.triggers)
        return `${EXPECTED_FUNCTIONS.length} functions/RPCs and ${EXPECTED_TRIGGERS.length} triggers present`
      },
    },
    {
      name: "retired-objects-absent",
      run: async ({ query }) => {
        const rows = await query(`select jsonb_build_object(
          'recipe_audits', to_regclass('public.recipe_audits'),
          'legacy_made_rpc', to_regprocedure('public.toggle_weekly_recipe_made(text,text,boolean,timestamp with time zone)'),
          'obsolete_uuid_text_rpc', to_regprocedure('public.toggle_weekly_recipe_made(uuid,text,boolean,timestamp with time zone)'),
          'legacy_recipe_structure_columns', (
            select case when count(*) = 0 then null else count(*) end
            from information_schema.columns
            where table_schema = 'public' and table_name = 'recipes'
              and column_name in ('ingredients', 'instructions', 'instruction_groups')
          ),
          'legacy_recipe_structure_converter', coalesce(
            to_regprocedure('private.recipe_ingredient_sections_from_legacy(jsonb)'),
            to_regprocedure('private.recipe_instruction_sections_from_flat(text[])'),
            to_regprocedure('private.recipe_instruction_sections_from_groups(jsonb)'),
            to_regprocedure('private.recipe_notes_from_legacy(jsonb,text[])')
          )
        ) as retired`)
        const present = Object.entries(rows[0].retired).filter(([, value]) => value !== null).map(([name]) => name)
        if (present.length) throw new Error(`retired objects still present: ${present.join(", ")}`)
        return "repository-defined retired objects are absent"
      },
    },
    {
      name: "representative-application-reads",
      run: async ({ query }) => {
        await query("select recipe_uuid, ingredient_sections, instruction_sections from public.recipes order by recipe_uuid limit 1")
        await query("select item from public.pantry_items order by id limit 1")
        await query("select document, content_revision from public.shopping_list order by user_id limit 1")
        return "recipe, pantry, and Shopping document reads succeeded"
      },
    },
  ]
}

export const expectedCatalog = {
  tables: EXPECTED_TABLES,
  columns: EXPECTED_COLUMNS,
  constraints: EXPECTED_CONSTRAINTS,
  indexes: EXPECTED_INDEXES,
  functions: EXPECTED_FUNCTIONS,
  triggers: EXPECTED_TRIGGERS,
}
import { databaseUrlMatchesProject, parsePublicManifest } from "./runtime.mjs"
