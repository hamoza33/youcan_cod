# Dashboard actions and what each click does

This document is the GitHub reference for the admin dashboard. It explains what each visible button, link, filter, and action triggers inside the app, the local database, background jobs, and external systems such as COD Network, YouCan, SerpApi, AI providers, and Google Merchant Center.

## Core processing pipeline

Most product actions eventually use this pipeline:

1. `discover-cod-products`
   - Reads COD Network catalog/drop products for the selected country.
   - Upserts rows into local PostgreSQL `CodProduct`.
   - Queues `ensure-cod-sku`.
2. `ensure-cod-sku`
   - Checks seller/account products in COD Network.
   - If the product is already in the seller account, stores the seller-specific COD SKU.
   - If missing, calls the configured official `COD_NETWORK_ADD_PRODUCT_ENDPOINT`.
   - Creates or updates `ProductMapping` using the clean COD SKU.
   - Queues `enrich-seo`.
3. `enrich-seo`
   - Selects exact product images with SerpApi/image validation.
   - Uses the AI provider fallback chain for Arabic SEO fields.
   - Stores `SeoMetadata`.
   - Maps the generated category to an existing YouCan category if possible.
   - Queues `import-youcan`.
4. `import-youcan`
   - Revalidates SKU, Arabic SEO, category, variant type, and images.
   - Builds the YouCan payload.
   - Creates or updates the YouCan product by COD SKU duplicate protection.
   - Stores YouCan product/variant/URL mapping.
   - Queues `push-gmc` if Google Merchant push is enabled.
5. `push-gmc`
   - Builds Merchant API product input using COD SKU as `offerId`.
   - Sends the product to Google Merchant Center.
   - Stores submission/status details.
6. `sync-stock`
   - Reads seller stock from COD Network.
   - Updates local stock state.
   - Queues YouCan/GMC updates when stock availability changes.

## Products page: `/dashboard/products`

### Search box

Placeholder: `Search title, COD ID, SKU...`

What happens:

1. Submits `/dashboard/products?q=...&page=1`.
2. Server filters products where any of these match:
   - local product name;
   - raw COD name;
   - `codSku`;
   - COD product ID;
   - mapped COD SKU;
   - YouCan product ID;
   - generated SEO title.
3. Pagination is reset to page 1.
4. No external API is called; this is a database-only filter.

### Filter dropdowns

Filters:

- country;
- category;
- stock status;
- SEO status;
- import status;
- GMC status.

What happens:

1. Submits the chosen values as query-string filters.
2. Server builds a Prisma `CodProductWhereInput`.
3. Database returns only matching products.
4. Pagination links keep the active filters.
5. No external API is called.

### Apply filters

1. Submits the filter form.
2. Loads page 1 of the filtered result set.
3. Product selection is cleared because selection is visible-page scoped.

### Clear

1. Opens `/dashboard/products` with no filters.
2. Shows the latest updated products across all enabled countries.
3. Product selection is cleared.

### Pagination controls

Buttons:

- `Previous`;
- individual page numbers;
- `Next`.

What happens:

1. Navigates to `/dashboard/products?page=N` while preserving active filters/search.
2. Server fetches the requested page using `skip` and `take`.
3. Page size is currently 50 products.
4. Selection is scoped to the current page only; products from the previous page are not selected.

### Discover `{country}` catalog

Button label examples:

- `Discover SA catalog`;
- `Discover 6 countries catalog`.

What happens:

1. Browser calls server action `triggerDiscoveryForCountries`.
2. One BullMQ job is queued per selected/enabled country: `discover-cod-products`.
3. Worker calls the COD Network catalog/drop-product endpoint.
4. Each COD product is upserted into `CodProduct`.
5. For each saved product, the worker queues `ensure-cod-sku`.
6. `ensure-cod-sku` confirms the seller-specific COD SKU.
7. Once SKU is confirmed, `enrich-seo` is queued.
8. Once SEO succeeds, `import-youcan` is queued.
9. If Google Merchant push is enabled, successful YouCan import queues `push-gmc`.

Downstream systems touched:

- COD Network;
- local PostgreSQL;
- Redis/BullMQ worker;
- AI provider chain;
- SerpApi image enrichment;
- YouCan;
- optionally Google Merchant Center.

### Process visible products

Button label:

- `Process visible 50` or `Process visible products`.

What happens:

1. Browser calls `triggerProcessBatch` with only IDs from the current visible page.
2. The server reads each product state.
3. For each product:
   - missing COD SKU → queues `ensure-cod-sku`;
   - SEO not ready → queues `enrich-seo`;
   - SEO ready but not imported/updated → queues `import-youcan`.
4. This intentionally processes only the current page, not the full database.

### Sync stock

Button label examples:

- `Sync SA stock`;
- `Sync 6 countries stock`.

What happens:

1. Browser calls `triggerStockSyncForCountries`.
2. One `sync-stock` job is queued per selected/enabled country.
3. Worker reads seller products/stock from COD Network.
4. Local fields update:
   - `stockQuantity`;
   - `stockStatus`;
   - `lastCodSyncAt`.
5. Products with stock changes can be re-imported to YouCan and/or pushed to GMC depending on pipeline rules.

### Sync YouCan categories

Button label:

- `Sync YouCan categories`.

What happens:

1. Browser calls `triggerYouCanCategorySync`.
2. Worker queues/runs `sync-youcan-categories`.
3. YouCan categories are read from the configured YouCan API.
4. Local `Category.youCanCategoryId` mappings are updated when matches are found.
5. Products can then pass category validation required before YouCan import.

### Toolbar anchor shortcuts

Buttons:

- `Bulk SEO`;
- `Push GMC`;
- `Import YouCan`.

What happens:

1. These are anchor links to the selected-products bulk action panel.
2. They do not immediately start jobs.
3. Select one or more visible products, then click the matching bulk action inside the panel.

## Visible-page selection

### Select visible page

Appears in both the bulk panel and the product list header.

What happens:

1. Selects only rows currently rendered on the paginated page.
2. Does not select products from other pages or the full database.
3. When page/filter/search changes, selections that are no longer visible are automatically removed.

### Per-row checkbox

1. Adds/removes that product ID from the client-side selection set.
2. Does not call the server by itself.
3. Bulk action buttons use the selected IDs when clicked.

## Bulk actions panel

### Bulk actions expand/collapse

Button label:

- `Bulk actions`.

What happens:

1. Expands or collapses extra controls for price/category changes.
2. Does not call any backend action.

### Show in YouCan

1. Calls `bulkAction` with action `show` and selected product IDs.
2. Updates selected local products to `visibilityStatus = VISIBLE`.
3. Queues `import-youcan` for every selected product.
4. YouCan product is updated as visible during import/update.

### Hide in YouCan

1. Calls `bulkAction` with action `hide`.
2. Updates selected local products to `visibilityStatus = HIDDEN`.
3. Queues `import-youcan` for every selected product.
4. YouCan product is updated as hidden during import/update.

### Regenerate SEO

1. Calls `bulkAction` with action `regenerate-seo`.
2. Queues `enrich-seo` for selected products with `force: true`.
3. AI provider chain generates Arabic title, description, slug, meta title, meta description, keywords, selling points, and category suggestion.
4. Image selection can be refreshed through SerpApi and image validation.
5. Successful SEO generation queues YouCan import.

### Regenerate images

1. Calls `bulkAction` with action `regenerate-images`.
2. Queues `regenerate-images` for selected products.
3. Worker searches SerpApi Google Lens / Google Images through the active key pool.
4. Images are validated and deduplicated.
5. At least 4 valid exact product images are required.
6. If the product already exists in YouCan, a YouCan import/update is queued after images regenerate.

### Re-import YouCan

1. Calls `bulkAction` with action `import-youcan`.
2. Queues `import-youcan` for selected products.
3. Worker validates:
   - clean COD SKU;
   - Arabic SEO metadata;
   - mapped YouCan category;
   - YouCan text-button variant type;
   - at least 4 valid exact product images.
4. Worker builds the YouCan payload.
5. Product is created or updated by COD SKU duplicate protection.
6. `ProductMapping` is updated with YouCan IDs and public URL.

### Push GMC

1. Calls `bulkAction` with action `push-gmc`.
2. Queues `push-gmc` for selected products.
3. Worker builds Google Merchant product input using COD SKU as offer ID.
4. Product is submitted to Merchant Center.
5. Local `GmcSubmission` and product `gmcStatus` are updated.

### Percent price change

Control:

- `% price change` input + `Apply`.

What happens:

1. Calls `bulkAction` with action `price-percent`.
2. Updates selected products' local base price by the entered percentage.
3. Queues `import-youcan` for each selected product.
4. YouCan prices and quantity discount variants are recalculated from current discount rules.

### Fixed base price

Control:

- `Fixed base price` input + `Set`.

What happens:

1. Calls `bulkAction` with action `price-fixed`.
2. Sets the selected products' local base price.
3. Queues `import-youcan` for each selected product.
4. YouCan prices and quantity discount variants are recalculated.

### Bulk category

Control:

- `Bulk category...` dropdown + `Apply`.

What happens:

1. Calls `bulkAction` with action `category`.
2. Updates selected products' local category.
3. Queues `import-youcan` for each selected product.
4. Category must have a valid `youCanCategoryId` to pass import validation.

## Product row actions

### Product image/title/details link

1. Opens `/dashboard/products/[id]`.
2. No external API is called.
3. The detail page lets you edit price, category, visibility, SEO fields, and inspect images/logs.

### YouCan external button

1. Opens the stored YouCan product public URL in a new tab when available.
2. If unavailable, shows `YouCan N/A`.
3. Does not call the backend.

### COD external button

1. Opens a COD URL generated from `codNetwork.productPageUrlTemplate` or raw COD payload URL when available.
2. If unavailable, shows `COD N/A`.
3. Does not call the backend.

### COD

1. Calls `triggerProductJob(productId, 'ensure-cod-sku')`.
2. Queues `ensure-cod-sku`.
3. Worker confirms the seller-specific COD SKU.
4. If SKU is confirmed, `enrich-seo` is queued.

### SEO

1. Calls `triggerProductJob(productId, 'enrich-seo')`.
2. Queues forced SEO regeneration.
3. AI provider chain generates/updates SEO metadata.
4. SerpApi/image validation can be used during image selection.
5. Successful SEO queues YouCan import.

### YouCan

1. Calls `triggerProductJob(productId, 'import-youcan')`.
2. Queues YouCan import/update.
3. Worker validates prerequisites.
4. Product is created/updated in YouCan.
5. Local mapping is updated.

### GMC

1. Calls `triggerProductJob(productId, 'push-gmc')`.
2. Queues Google Merchant submission.
3. Product input is sent to Google Merchant Center.
4. Local GMC status/submission record is updated.

### Visibility toggle

1. Calls `toggleProductVisibility`.
2. Updates local `visibilityStatus`.
3. Queues `import-youcan`.
4. YouCan product visibility is updated during import/update.
5. If server action fails, the toggle is reverted in the browser.

## Product detail page: `/dashboard/products/[id]`

### Open YouCan

1. Opens the stored YouCan public product URL in a new tab.
2. Does not call the backend.

### Open COD

1. Opens the COD product URL if available/configured.
2. Does not call the backend.

### Back to products

1. Navigates back to `/dashboard/products`.
2. Does not call the backend.

### Product images: open original image

1. Opens the original/proxied image URL in a new tab.
2. Does not change the product.

### Detail page visibility toggle

Same as row visibility toggle:

1. Updates local visibility.
2. Queues YouCan import/update.
3. Pushes visibility to YouCan during import/update.

### Save changes and update YouCan

1. Calls `updateProductAction`.
2. Updates local product:
   - price;
   - category;
   - visibility.
3. Updates SEO metadata if title/description/meta fields were supplied.
4. Queues `import-youcan`.
5. YouCan product is updated with the saved local data.

## Settings page: `/dashboard/settings`

### Save all project settings

1. Calls `saveSettings`.
2. Iterates every setting in `SETTINGS` registry.
3. Saves values into local `Setting` table.
4. Secret fields are unchanged unless revealed/edited.
5. Revalidates products/settings pages.
6. Runtime values affect future server actions/jobs immediately; already-running workers may need restart for concurrency/environment-only changes.

### SerpApi keys: Sync credits

1. Calls `syncSerpApiKeyUsage` with no key ID.
2. Calls SerpApi Account API for all saved SerpApi keys.
3. Updates remote plan/usage/remaining-credit fields.
4. Saves any sync errors on the key.

### SerpApi keys: Save key

1. Calls `updateSerpApiKey`.
2. Updates label, monthly limit, and active/inactive status.
3. Active keys are considered for rotation.
4. Inactive keys are skipped.

### SerpApi keys: Sync this key

1. Calls `syncSerpApiKeyUsage` with one key ID.
2. Syncs only that key's remote account usage.
3. Updates plan/credits or saves the last error.

### SerpApi keys: Delete

1. Calls `deleteSerpApiKey`.
2. Removes the key from the database.
3. It will not be used for future image searches.

### SerpApi keys: Add key

1. Calls `addSerpApiKey`.
2. Saves a new SerpApi key in the database.
3. Defaults monthly limit to 250 unless changed.
4. Key becomes active immediately.
5. Future image searches can use it.

### AI provider tests

Buttons:

- `Test OpenAI-compatible`;
- `Test Anthropic-compatible`;
- `Test fallback chain`.

What happens:

1. Calls `testAiProviderAction` with the selected provider.
2. Sends a tiny JSON request.
3. Shows success/failure in the Settings panel.
4. Writes success/failure details to `/dashboard/logs`.
5. `Test fallback chain` tries providers in `AI_PROVIDER_ORDER`, for example `openai → anthropic` or `anthropic → openai`.
6. Normal SEO/image AI work also uses the same provider chain, so if the first configured provider fails, the next configured provider is tried automatically.

### Save categories

1. Calls `saveCategories`.
2. Updates category names, YouCan category IDs, Google categories, active status, and sort order.
3. Products using mapped categories can pass YouCan import validation.
4. Products are not automatically re-imported by saving categories; use bulk/row YouCan import after mapping changes.

### Save discount rules

1. Calls `saveDiscountRules`.
2. Updates existing quantity discount rules.
3. Adds a new rule if provided.
4. Future YouCan imports generate quantity variant buttons/prices from these rules.
5. Existing YouCan products are updated only when you re-import them.

## Logs page: `/dashboard/logs`

### Source/level filters

The page supports query-string filters:

- `/dashboard/logs?source=AI`;
- `/dashboard/logs?level=ERROR`;
- `/dashboard/logs?source=YOUCAN&level=ERROR`.

What happens:

1. Server reads up to 200 newest matching `LogEvent` records.
2. Includes linked product information when available.
3. No external API is called.

## Error recovery and failed-product import documentation

Run failed-product discovery/recovery with:

```bash
npm run recover:failed-products -- --dry-run
npm run recover:failed-products
```

Use `--dry-run` first. It lists every product with `lastError`, `importStatus=FAILED`, or `seoStatus=FAILED`, classifies the cause, and prints the intended fix. The live command applies auto-fixes and imports what can be imported.

### Error: `Pre-import validation failed: Variant/product SKU must be the clean COD SKU only.`

Cause:

- YouCan import validation detected a SKU that was not the clean COD seller SKU.
- The common bad case was quantity/bundle variant SKUs such as `CODSKU-Q2`, `CODSKU-Q3`, Arabic quantity labels, or bundle words.
- YouCan variants must not invent quantity-specific SKUs; the COD SKU is the duplicate key and must stay unchanged.

Fix applied:

- Added centralized SKU helpers in `src/lib/products/sku.ts`.
- `ensureCodSku`, manual product import, import validation, and YouCan payload generation now normalize/require clean COD SKUs.
- `buildYouCanProductPayload` sends exactly the clean COD SKU for:
  - product-level `sku` when there are no variants;
  - default quantity variant;
  - every discount quantity variant.
- `recover-failed-products.ts` classifies this error as `clean-sku-then-retry-import`, updates the stored local SKU/mapping to the clean SKU when it can be safely derived, then retries YouCan import.

### Error: missing SEO metadata

Example:

- `Cannot import to YouCan before SEO metadata is generated.`

Cause:

- Product was queued/imported before Arabic SEO metadata was ready, or SEO generation previously failed.

Fix:

- Recovery classifies it as `generate-seo-then-import`.
- It runs `enrichSeo(product.id, true)` using the AI provider fallback chain.
- After SEO is saved, it retries `importToYouCan`.

### Error: category missing or not mapped to YouCan

Examples:

- `Product must be assigned to an existing synced YouCan category.`
- `Cannot import to YouCan without a mapped existing YouCan category.`

Cause:

- The local category is missing, inactive, or does not have `youCanCategoryId`.
- YouCan requires the product category ID to already exist in the store.

Fix:

- Click `Sync YouCan categories`.
- Map the category in Settings or assign a mapped category to the product.
- Retry YouCan import.
- Recovery reports this as `manual-fix-category` because choosing the correct category is a business decision.

### Error: not enough valid exact product images

Examples:

- `At least 4 valid exact product images are required before YouCan import.`
- `Image enrichment failed: found X valid exact product images...`

Cause:

- Product has fewer than 4 working images.
- Images were duplicates, broken, too small, or not the exact same physical product.

Fix:

- Click `Regenerate images` for the product or selected products.
- Confirm the images are exact matches.
- Retry YouCan import.
- Recovery reports this as `manual-fix-images` if automated enrichment still cannot find enough images.

### Error: API credential or endpoint missing

Examples:

- `YOUCAN_API_TOKEN is missing.`
- `COD_NETWORK_API_TOKEN is missing.`
- `Missing COD Network add/select product endpoint.`
- AI provider key missing.

Cause:

- Required production credentials are not present in dashboard settings or `.env.production`.
- COD add/select endpoint must be the official endpoint; the app intentionally does not invent it.

Fix:

- Add the missing value in Settings or on the VPS `.env.production`.
- Restart app/worker when environment values change.
- Retry the relevant job.
- Recovery reports this as `manual-fix-credentials` because secrets/endpoints must be supplied by the operator.

### Unknown import error

Cause:

- The last error did not match an automatic recovery category.

Fix:

- Review `/dashboard/logs` and the product detail page recent logs.
- Fix the specific cause manually.
- Retry row action `YouCan` or run the recovery script again.
