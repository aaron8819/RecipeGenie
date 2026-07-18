# Recipe workflow fixture corpus

`recipe-workflow.v1.ts` is the version-1 corpus of realistic pasted recipes.
The corresponding Vitest snapshot is the reviewed, deterministic application
contract for every fixture:

- parsed title and servings
- structured ingredients, quantities, units, modifiers, and alternatives
- flat and grouped instructions, notes, metadata, and parser warnings
- normalized shopping-list buckets and quantities

The snapshot intentionally exercises only local deterministic code:
`parseRecipeText()` followed by `generateShoppingList()`. Recipe Genie's current
paste-import path does not call an external model. URL importing is also
rule-based, but live page content and remote availability are outside this
corpus; those concerns remain covered by isolated URL-parser/API tests.

When behavior intentionally changes, add a new corpus version or review the
specific snapshot changes before updating version 1. Never refresh this
snapshot blindly.
