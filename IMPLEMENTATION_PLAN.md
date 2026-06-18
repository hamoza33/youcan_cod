# COD Network → YouCan → Google Merchant Center Automation Plan

## Changes to build

1. Create a new full-stack admin application from the empty repository.
2. Add a PostgreSQL-backed data model for settings, COD products, SKU mappings, YouCan products, Google Merchant Center submissions, SEO metadata, sync jobs, and logs.
3. Implement provider adapters for COD Network, YouCan, Google Merchant Center, OpenAI-compatible AI, image analysis, and web search.
4. Implement the COD-first import pipeline: discover KSA products, ensure each product is added/selected in the seller account, retrieve the account-specific SKU, then import to YouCan.
5. Implement AI-assisted product identification and compliant SEO/content generation using the configurable OpenAI-compatible provider layer, defaulting to DuckCoding.
6. Implement YouCan import/update flows with duplicate protection based on COD Network SKU, product images, visibility, category assignment, pricing, and discount quantity variants.
7. Implement Google Merchant Center submission and status synchronization for KSA products.
8. Implement automated stock/new-product synchronization and retryable background jobs.
9. Build the admin dashboard and settings screens for product management, bulk actions, manual sync, SEO regeneration, and manual GMC push.
10. Add environment-based configuration, `.env.example`, setup documentation, Docker deployment files, and Caddy/VPS deployment instructions.

## Important external API findings and blockers

The repository is currently empty except for git metadata, so this is a greenfield implementation.

API documentation I found:

- COD Network documentation/search results show base API usage with bearer auth and documented seller/drop product read endpoints such as `GET /seller/products` and `GET /seller/drop-products`, but I did not find a documented endpoint for the required step: adding/selecting a drop product into the seller product list/account to generate or retrieve the account-specific SKU. Sources: [COD seller products](https://developer.cod.network/guides/cod-call/Products.html), [COD drop products](https://developer.cod.network/guides/cod-call/DropProducts.html), [COD getting started](https://developer.cod.network/guides/getting-started.html), [COD Postman collection](https://www.postman.com/cod-network-official/codnetwork-api/documentation/2ojd8s5/codnetwork-api).
- YouCan documents `POST https://api.youcan.shop/products` for product creation and `POST https://api.youcan.shop/products/update/{id}` for updates, with product/variant/image/category fields and SKU fields. Sources: [YouCan create product](https://developer.youcan.shop/store-admin/products/create), [YouCan list products](https://developer.youcan.shop/store-admin/products/listing), [YouCan product entity](https://developer.youcan.shop/store-front/entities/product).
- Google Merchant Center should use the newer Merchant API product input flow, `POST https://merchantapi.googleapis.com/products/v1/accounts/{ACCOUNT_ID}/productInputs:insert?dataSource=accounts/{ACCOUNT_ID}/dataSources/{DATASOURCE_ID}`, then read product status from `products.get` after async processing. Sources: [Merchant API add/manage products](https://developers.google.com/merchant/api/guides/products/add-manage), [productInputs.insert](https://developers.google.com/merchant/api/reference/rest/products_v1beta/accounts.productInputs/insert), [Content API productstatuses.get](https://developers.google.com/shopping-content/reference/rest/v2.1/productstatuses/get).

The production COD import flow cannot be fully connected until the exact COD Network add/select endpoint or official Postman collection/API docs are provided. I will still build the adapter interface and the rest of the system so that this endpoint can be plugged in cleanly.

Required missing inputs before live deployment:

- COD Network API token.
- COD Network official endpoint/docs for adding/selecting a drop product to the seller account/product list and retrieving the generated seller SKU.
- YouCan API access token with product edit/read scopes.
- YouCan category IDs or permission to create/manage categories if the API supports it.
- Google Merchant Center account ID.
- Google Merchant API data source ID for an API product data source.
- Google service account/OAuth credentials with `https://www.googleapis.com/auth/content` scope access.
- DuckCoding OpenAI-compatible API key.
- GitHub repository URL or authorization to create one.
- VPS SSH access method/password/key and sudo/deployment permissions for `aichaguimaoune@35.255.81.115`.
- DNS confirmation that `gmc.shopinzo.bond` points to the VPS.

## Architecture

Use a Next.js TypeScript monorepo application with:

- Next.js App Router for the dashboard and authenticated admin UI.
- Route handlers/server actions for dashboard actions.
- Prisma ORM with PostgreSQL for durable mapping and duplicate protection.
- BullMQ + Redis for import, sync, SEO, YouCan, and GMC background jobs.
- Zod for validation and typed settings.
- Pino logs persisted to the database for user-visible operational logs.
- Docker Compose for app, PostgreSQL, Redis, and production deployment.
- Caddy reverse proxy for `gmc.shopinzo.bond`.

## Data model

Create Prisma models for:

- `Setting`: encrypted or environment-referenced configuration values.
- `Category`: predefined category list with YouCan category mapping and optional Google category.
- `DiscountRule`: buy quantity and discount percent rules.
- `CodProduct`: COD product catalog/account fields, country, stock, media, raw payload.
- `ProductMapping`: unique COD product ID + COD SKU mapping to YouCan product ID and Google product ID.
- `SeoMetadata`: generated title, description, slug, meta title, meta description, keywords, AI model, compliance status.
- `ImportJob` / `SyncRun`: pipeline status, retries, timestamps, errors.
- `GmcSubmission`: product input payload hash, status, destination statuses, disapproval issues.
- `LogEvent`: structured logs by source (`cod`, `youcan`, `gmc`, `ai`, `sync`, `dashboard`).

Unique constraints:

- COD SKU globally unique for imported products.
- YouCan product ID unique when present.
- Google product ID unique when present.
- COD product ID + country unique.

## Adapter layer

Implement `src/lib/integrations/*`:

- `cod-network/client.ts`
  - Bearer-token client with retries, pagination support, and logging.
  - `listAvailableProducts({ country: 'SA' })` using documented drop products/catalog endpoint once confirmed.
  - `listSellerProducts()` using documented seller product endpoint.
  - `ensureSellerProduct(dropProductId)` that first checks existing seller products and then calls the missing add/select endpoint once provided.
  - The method will throw a clear `MissingCodEndpointError` if the endpoint is not configured.

- `youcan/client.ts`
  - OAuth/bearer client with retries.
  - List products with variants/images for SKU duplicate checks.
  - Create/update product with SKU, images, visibility, categories, variants, inventory, and descriptions.

- `google-merchant/client.ts`
  - Google auth using credentials from environment variables or mounted secret files.
  - Build ProductInput for KSA with `offerId = COD SKU`, `feedLabel = SA`, currency SAR, availability, title, description, link, imageLink, condition NEW, category fields.
  - Insert/update product inputs and retrieve processed status.

- `ai/openai-compatible.ts`
  - Configurable base URL, API key env var, model, timeouts.
  - Default development values: base URL `https://www.duckcoding.ai/`, model `claude-opus-4-8`.
  - No official OpenAI endpoint hardcoding.

- `search/web-search.ts`
  - Configurable web search provider abstraction.
  - Used only when COD product text is insufficient.

## Import and sync pipeline

Implement jobs:

1. `discoverCodKsaProducts`
   - Fetch COD KSA products.
   - Upsert local COD product records.
   - Queue account-SKU step for new/changed products.

2. `ensureCodSku`
   - Check existing local mapping and COD seller products.
   - If missing, call COD add/select endpoint through `ensureSellerProduct`.
   - Persist generated COD SKU.
   - Block downstream import if SKU is unavailable.

3. `enrichSeo`
   - Analyze COD product images and available text.
   - Search web when needed.
   - Generate safe product title, description, slug, meta title, meta description, keywords, category suggestion.
   - Run a policy-clean rewrite pass to avoid exaggerated, medical, illegal, misleading, or unverifiable claims.

4. `importToYouCan`
   - Use COD SKU as the duplicate key.
   - Check local mapping and YouCan variants/product SKU before create.
   - Create or update product in YouCan.
   - Attach images, visibility, category, description, stock, price, discount quantity variants.

5. `pushToGmc`
   - Build Google product input using COD SKU as offer ID.
   - Submit to Merchant Center.
   - Save Google product ID/status as pending until processed.

6. `syncStockAndStatuses`
   - Poll COD stock for KSA.
   - Update YouCan inventory/visibility stock state.
   - Update GMC availability.
   - Refresh GMC status and issues.

## Dashboard

Build admin pages:

- `/dashboard/products`
  - Table columns: image, COD product ID, COD SKU, YouCan product ID, GMC status, title, category, price, stock status, visibility, SEO status, import status, error status.
  - Filters: country, category, stock, import status, GMC status.
  - Bulk actions: price formula/change, visibility, category, SEO regeneration, COD re-sync, YouCan re-push, GMC re-push.
  - Row actions: edit price/category/visibility, regenerate SEO, re-sync, push/re-push GMC, view logs/errors.

- `/dashboard/products/[id]`
  - Single product editing: price, category, visibility, SEO fields, images, discount rules, manual retry actions.

- `/dashboard/settings`
  - COD credentials references.
  - YouCan credentials references.
  - Google Merchant account/data source/credential references.
  - Country selection locked/defaulted to KSA initially.
  - Category list editor.
  - Pricing formula editor.
  - Discount variant rules editor.
  - Default visibility.
  - AI provider/base URL/model settings.
  - Web search settings.
  - Sync frequency.
  - GitHub/deployment notes/settings placeholders.

- `/dashboard/logs`
  - Filterable logs for import, sync, YouCan, GMC, AI, and errors.

## Environment and deployment

Add:

- `.env.example` with no secrets.
- `README.md` with local setup, API credential setup, and deployment steps.
- `docker-compose.yml` for app + postgres + redis.
- Production Dockerfile.
- Caddyfile template for `gmc.shopinzo.bond`.
- Deployment script that expects secrets on the VPS in `.env.production` and never commits them.

## Implementation sequence

1. Scaffold Next.js TypeScript app, Tailwind, Prisma, PostgreSQL, Redis/BullMQ, lint/build scripts.
2. Add Prisma schema, migrations, seed defaults for KSA, discount rules, and starter categories.
3. Add shared API client utilities: retries, rate limiting, structured logging, error normalization.
4. Add integration adapters and typed interfaces.
5. Add job queue and import/sync pipeline.
6. Add AI SEO/content generation prompts and compliance guardrails using only OpenAI-compatible API calls.
7. Add dashboard pages, product table, filters, bulk actions, settings, logs, and product edit page.
8. Add Google Merchant preparation/submission/status sync.
9. Add documentation, `.env.example`, Docker/Caddy deployment files.
10. After the missing COD endpoint and credentials are provided, configure live API calls, run the first KSA import, push to GitHub, and deploy to the VPS.

## Scope impact

This will create the full application in the empty repo. The only intentional non-final piece is the exact COD Network add/select API call because the user explicitly required not inventing COD Network endpoints, and the endpoint was not available in the public docs found during planning.