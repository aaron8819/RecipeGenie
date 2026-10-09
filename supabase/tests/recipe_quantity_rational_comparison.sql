begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(33);

-- Full validator coverage, including the coffee cake's mixed recurring fraction.
select extensions.is(
  private.recipe_quantity_is_valid(jsonb_build_object(
    'version', 1, 'kind', 'exact', 'authored', lexeme, 'source', 'authored',
    'lexeme', lexeme, 'value', jsonb_build_object('numerator', numerator, 'denominator', denominator)
  )), expected, description
)
from (values
  ('1 1/3', '4', '3', true, 'mixed recurring thirds preserve authored value'),
  ('2 1/6', '13', '6', true, 'mixed recurring sixths are exact'),
  ('1⅓', '4', '3', true, 'Unicode mixed thirds are exact'),
  ('2⅚', '17', '6', true, 'Unicode mixed sixths are exact'),
  ('2/3', '2', '3', true, 'simple recurring fraction remains valid'),
  ('1 1/3', '8', '6', true, 'equivalent unreduced rational remains valid'),
  ('1.25', '5', '4', true, 'finite decimal matches rational'),
  ('2', '2', '1', true, 'whole quantity remains valid'),
  ('1 1/3', '133333333333', '100000000000', false, 'rounded approximation is not exact'),
  ('1 1/3', '5', '3', false, 'mismatched fraction is rejected'),
  ('1/0', '1', '1', false, 'zero lexical denominator remains rejected'),
  ('1 1/3', '4', '0', false, 'zero rational denominator remains rejected'),
  ('0', '0', '1', false, 'zero exact quantity remains rejected'),
  ('100000001', '100000001', '1', false, 'magnitude limit remains enforced')
) as cases(lexeme, numerator, denominator, expected, description);

select extensions.ok(private.recipe_quantity_is_valid(
  '{"version":1,"kind":"range","authored":"1 1/3–2 1/3","source":"authored","startLexeme":"1 1/3","endLexeme":"2 1/3","separator":"–","start":{"numerator":"4","denominator":"3"},"end":{"numerator":"7","denominator":"3"}}'
), 'both range endpoints use exact rational equality');
select extensions.ok(not private.recipe_quantity_is_valid(
  '{"version":1,"kind":"range","authored":"2 1/3–1 1/3","source":"authored","startLexeme":"2 1/3","endLexeme":"1 1/3","separator":"–","start":{"numerator":"7","denominator":"3"},"end":{"numerator":"4","denominator":"3"}}'
), 'reversed range remains rejected');
select extensions.ok(not private.recipe_quantity_is_valid(
  '{"version":1,"kind":"exact","authored":"about 1 1/3","source":"authored","lexeme":"1 1/3","value":{"numerator":"4","denominator":"3"}}'
), 'qualifier mismatch remains rejected');
select extensions.ok(not private.recipe_quantity_is_valid(
  '{"version":1,"kind":"exact","authored":"1 1/3","source":"authored","lexeme":"1 1/3","value":{"numerator":"4","denominator":"3"},"extra":true}'
), 'unexpected quantity fields remain rejected');
select extensions.ok(not has_function_privilege('anon', 'private.recipe_quantity_lexeme_matches_rational(text,jsonb)', 'execute'), 'helper is unavailable to anon');
select extensions.ok(not has_function_privilege('authenticated', 'private.recipe_quantity_lexeme_matches_rational(text,jsonb)', 'execute'), 'helper is unavailable to authenticated');
select extensions.ok(not (select prosecdef from pg_proc where oid = 'private.recipe_quantity_lexeme_matches_rational(text,jsonb)'::regprocedure), 'helper remains security invoker');

select extensions.ok(private.recipe_quantity_matches_legacy('{"version": 1, "kind": "exact", "authored": "1 1/3", "source": "authored", "lexeme": "1 1/3", "value": {"numerator": "4", "denominator": "3"}}'::jsonb, '"1 1/3"'::jsonb), 'mixed string amount matches exact rational');
select extensions.ok(private.recipe_quantity_matches_legacy('{"version": 1, "kind": "range", "authored": "1 1/3–2 1/3", "source": "authored", "startLexeme": "1 1/3", "endLexeme": "2 1/3", "separator": "–", "start": {"numerator": "4", "denominator": "3"}, "end": {"numerator": "7", "denominator": "3"}}'::jsonb, '"1 1/3–2 1/3"'::jsonb), 'mixed string range matches rational endpoints');
select extensions.ok(private.recipe_yield_metadata_is_valid('{"version": 1, "authoredText": "1 1/3 servings", "kind": "servings", "scalingBasis": {"numerator": "4", "denominator": "3"}, "value": {"numerator": "4", "denominator": "3"}}'::jsonb), 'exact yield preserves mixed authored fraction');
select extensions.ok(private.recipe_yield_metadata_is_valid('{"version": 1, "authoredText": "1 1/3–2 1/3 servings", "kind": "servings", "scalingBasis": {"numerator": "4", "denominator": "3"}, "range": {"startLexeme": "1 1/3", "endLexeme": "2 1/3", "separator": "–", "start": {"numerator": "4", "denominator": "3"}, "end": {"numerator": "7", "denominator": "3"}}}'::jsonb), 'range yield preserves mixed authored fractions');
select extensions.ok(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "all-purpose flour", "unit": "cup", "amount": "1 1/3", "quantityV1": {"version": 1, "kind": "exact", "authored": "1 1/3", "source": "authored", "lexeme": "1 1/3", "value": {"numerator": "4", "denominator": "3"}}}]}]'::jsonb), 'canonical ingredient sections accept mixed recurring amount');
select extensions.ok(private.recipe_share_snapshot_is_valid('{"name": "Coffee Cake", "category": "Dessert", "servings": 9, "tags": [], "ingredient_sections": [{"label": "Cake", "ingredients": [{"item": "all-purpose flour", "unit": "cup", "amount": "1 1/3", "quantityV1": {"version": 1, "kind": "exact", "authored": "1 1/3", "source": "authored", "lexeme": "1 1/3", "value": {"numerator": "4", "denominator": "3"}}}]}], "instruction_sections": [{"label": null, "steps": ["Bake"]}], "notes": ["Source: https://sallysbakingaddiction.com/coffee-cake-recipe/"]}'::jsonb), 'canonical snapshot accepts mixed amount and keeps source URL');

select extensions.is(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "flour", "unit": "cup", "amount": 0.6666666666666666, "quantityV1": {"version": 1, "kind": "exact", "authored": "2/3", "source": "authored", "lexeme": "2/3", "value": {"numerator": "2", "denominator": "3"}}}]}]'::jsonb), true, 'parsed recurring simple fraction numeric amount');
select extensions.is(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "flour", "unit": "cup", "amount": 1.3333333333333333, "quantityV1": {"version": 1, "kind": "exact", "authored": "1 1/3", "source": "authored", "lexeme": "1 1/3", "value": {"numerator": "4", "denominator": "3"}}}]}]'::jsonb), true, 'parsed recurring mixed fraction numeric amount');
select extensions.is(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "flour", "unit": "cup", "amount": 0.6666666666666667, "quantityV1": {"version": 1, "kind": "exact", "authored": "2/3", "source": "authored", "lexeme": "2/3", "value": {"numerator": "2", "denominator": "3"}}}]}]'::jsonb), false, 'adjacent binary64 projection is rejected');
select extensions.is(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "flour", "unit": "cup", "amount": 1.3333333333333335, "quantityV1": {"version": 1, "kind": "exact", "authored": "1 1/3", "source": "authored", "lexeme": "1 1/3", "value": {"numerator": "4", "denominator": "3"}}}]}]'::jsonb), false, 'wrong mixed fraction projection is rejected');
select extensions.is(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "flour", "unit": "cup", "amount": 1.6666666666666665, "quantityV1": {"version": 1, "kind": "exact", "authored": "1⅔", "source": "authored", "lexeme": "1⅔", "value": {"numerator": "5", "denominator": "3"}}}]}]'::jsonb), true, 'Unicode mixed amount preserves client whole plus fraction arithmetic');
select extensions.is(private.recipe_ingredient_sections_are_valid('[{"label": "Cake", "ingredients": [{"item": "flour", "unit": "cup", "amount": 1.6666666666666667, "quantityV1": {"version": 1, "kind": "exact", "authored": "1⅔", "source": "authored", "lexeme": "1⅔", "value": {"numerator": "5", "denominator": "3"}}}]}]'::jsonb), false, 'Unicode mixed amount rejects different binary64 formula');
select * from extensions.finish();
rollback;
