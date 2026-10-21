import { recipeIngredientText } from "@/lib/recipe-plain-text";
import { formatRecipeTime } from "@/lib/recipe-structure";
import { getAuthoredYieldText } from "@/lib/recipe-quantity";
import {
  buildRecipeSubmissionData,
  getRecipeCreationPreviewError,
  type RecipeDialogFormValues,
} from "./recipe-dialog.defaults";

export function RecipeReplacementReview({
  updated,
  unparsed,
  warnings,
  variant = "replace",
  compact = false,
  onEdit,
  onEditSource,
  onKeepUnparsed,
}: {
  updated: RecipeDialogFormValues;
  unparsed: string[];
  warnings: string[];
  variant?: "create" | "replace";
  compact?: boolean;
  onEdit?: (section: "details" | "ingredients" | "instructions") => void;
  onEditSource?: () => void;
  onKeepUnparsed?: () => void;
}) {
  const previewError =
    variant === "create" ? getRecipeCreationPreviewError(updated) : null;
  if (previewError)
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl space-y-4 rounded-xl border border-destructive p-5"
      >
        <p>{previewError}</p>
        <button
          type="button"
          className="min-h-11 rounded-lg border px-3"
          onClick={() => onEdit?.("ingredients")}
        >
          Edit ingredients
        </button>
      </div>
    );
  // Use the save boundary so this draft reflects normalized persisted content.
  const recipe = buildRecipeSubmissionData(updated);
  let instructionNumber = 0;
  return (
    <div
      className={`mx-auto w-full ${variant === "create" ? "max-w-5xl" : "max-w-3xl"} space-y-6 py-4 text-base sm:py-6`}
      data-testid="replacement-review"
    >
      {variant === "replace" && (
        <p className="text-muted-foreground">
          Updates this recipe. Its link, favorite and cooking history stay the
          same.
        </p>
      )}
      {unparsed.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive p-4">
          <h3 className="font-semibold">Some text could not be included</h3>
          <p>
            Return to the text and move this content into a supported section,
            such as Notes. Saving is blocked until it can all be included.
          </p>
          {variant === "create" && (
            <div className="flex flex-wrap gap-4">
              <button
                type="button"
                className="min-h-11 font-semibold underline"
                onClick={onEditSource}
              >
                Edit source
              </button>
              <button
                type="button"
                className="min-h-11 font-semibold underline"
                onClick={onKeepUnparsed}
              >
                Keep in Notes
              </button>
            </div>
          )}
          <ul className="mt-3 list-inside list-disc whitespace-pre-wrap">
            {unparsed.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <details open className="rounded-xl border p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">
            Parsing notes ({warnings.length})
          </summary>
          <ul className="list-inside list-disc">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <article className="space-y-6" data-testid="replacement-draft">
        <header className="space-y-2">
          {onEdit && (
            <button
              type="button"
              className="min-h-11 rounded-lg border px-3 text-sm"
              onClick={() => onEdit("details")}
            >
              Edit details
            </button>
          )}
          <h2
            className={`font-display text-3xl font-semibold sm:text-4xl ${variant === "create" ? "text-primary" : ""}`}
          >
            {recipe.name}
          </h2>
          <p>{getAuthoredYieldText(recipe.yield_metadata, updated.servings)}</p>
          <p>{recipe.category}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(
              [
                ["Prep", recipe.prep_time_minutes],
                ["Cook", recipe.cook_time_minutes],
                ["Total", recipe.total_time_minutes],
              ] as const
            ).map(
              ([label, time]) =>
                time != null && (
                  <p key={label}>
                    {label} {formatRecipeTime(time)}
                  </p>
                ),
            )}
          </div>
          {variant === "replace" && !!recipe.tags?.length && (
            <p>{recipe.tags.join(", ")}</p>
          )}
          {variant === "replace" && recipe.image_url && (
            <p className="break-words">Image: {recipe.image_url}</p>
          )}
        </header>
        <div
          className={
            variant === "create" ? "grid gap-8 lg:grid-cols-2" : "space-y-6"
          }
        >
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-2xl font-semibold">Ingredients</h3>
              {onEdit && (
                <button
                  type="button"
                  className="min-h-11 rounded-lg border px-3 text-sm"
                  onClick={() => onEdit("ingredients")}
                >
                  Edit ingredients
                </button>
              )}
            </div>
            {recipe.ingredient_sections?.map((section, index) =>
              variant === "create" ? (
                <details
                  key={index}
                  open={!compact || index === 0}
                  className="space-y-2 border-b pb-4"
                  data-ingredient-group={section.label || ""}
                >
                  <summary className="min-h-11 cursor-pointer font-semibold text-primary">
                    {section.label || "Ingredients"} ·{" "}
                    {section.ingredients.length} ingredients
                  </summary>
                  <ul className="list-inside list-disc space-y-2">
                    {section.ingredients.map((ingredient, ingredientIndex) => (
                      <li className="break-words" key={ingredientIndex}>
                        {recipeIngredientText(
                          ingredient,
                          updated.servings,
                          updated.servings,
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <section
                  key={index}
                  className="space-y-2"
                  data-ingredient-group={section.label || ""}
                >
                  {section.label && (
                    <h4 className="text-lg font-semibold">{section.label}</h4>
                  )}
                  <ul className="list-inside list-disc space-y-2">
                    {section.ingredients.map((ingredient, ingredientIndex) => (
                      <li className="break-words" key={ingredientIndex}>
                        {recipeIngredientText(
                          ingredient,
                          updated.servings,
                          updated.servings,
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </section>
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-2xl font-semibold">Instructions</h3>
              {onEdit && (
                <button
                  type="button"
                  className="min-h-11 rounded-lg border px-3 text-sm"
                  onClick={() => onEdit("instructions")}
                >
                  Edit instructions
                </button>
              )}
            </div>
            {recipe.instruction_sections?.map((section, index) => {
              const start = instructionNumber + 1;
              instructionNumber += section.steps.length;
              return (
                <section
                  key={index}
                  className="space-y-2"
                  data-instruction-group={section.label || ""}
                >
                  {section.label && (
                    <h4 className="text-lg font-semibold">{section.label}</h4>
                  )}
                  <ol
                    start={start}
                    className="list-inside list-decimal space-y-3"
                  >
                    {section.steps.map((step, stepIndex) => (
                      <li
                        className="whitespace-pre-wrap break-words"
                        key={stepIndex}
                      >
                        {step}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </section>
        </div>
        {!!recipe.notes?.length && (
          <section className="space-y-3" data-testid="replacement-draft-notes">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-2xl font-semibold">Notes</h3>
              {onEdit && (
                <button
                  type="button"
                  className="min-h-11 rounded-lg border px-3 text-sm"
                  onClick={() => onEdit("details")}
                >
                  Edit notes
                </button>
              )}
            </div>
            <ul className="list-inside list-disc space-y-2">
              {(variant === "create"
                ? recipe.notes.slice(0, 1)
                : recipe.notes
              ).map((note, index) => (
                <li className="whitespace-pre-wrap break-words" key={index}>
                  {note}
                </li>
              ))}
            </ul>
            {variant === "create" && recipe.notes.length > 1 && (
              <details className="rounded-xl border p-4">
                <summary className="min-h-11 cursor-pointer font-semibold text-primary">
                  Show all {recipe.notes.length} notes
                </summary>
                <ul className="list-inside list-disc space-y-2">
                  {recipe.notes.slice(1).map((note, index) => (
                    <li className="whitespace-pre-wrap break-words" key={index}>
                      {note}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
        {variant === "create" && (
          <details className="rounded-xl border p-4">
            <summary className="min-h-11 cursor-pointer text-muted-foreground">
              Photo, tags & other details · Optional
            </summary>
            {recipe.tags?.length ? <p>{recipe.tags.join(", ")}</p> : null}
            <button
              type="button"
              className="min-h-11 font-semibold underline"
              onClick={() => onEdit?.("details")}
            >
              Edit optional details
            </button>
          </details>
        )}
      </article>
    </div>
  );
}
