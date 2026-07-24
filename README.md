# COD Network → YouCan → Google Merchant Center Automation

A complete KSA-first automation dashboard for discovering COD Network products, ensuring account-specific COD SKUs, generating compliant SEO content through an OpenAI-compatible AI provider, importing products into YouCan, pushing products to Google Merchant Center, and keeping stock/statuses synchronized.

## What this system does

- Fetches available COD Network KSA products.
- Checks whether each product already exists in the COD seller account/list.
- Adds/selects missing COD products **before** importing to YouCan, then retrieves the account-specific COD SKU.
- Uses the COD SKU as the duplicate-safe identifier for local database records, YouCan products/variants, and Google Merchant Center offer IDs.
- Analyzes product images and product text through a configurable OpenAI-compatible API provider.
- Generates safe SEO titles, descriptions, slugs, meta titles, meta descriptions, keywords, category suggestions, and Google Merchant Center-compliant content.
- Imports/updates products in YouCan with images, category, visibility, price, inventory, and quantity discount variants.
- Pushes products to Google Merchant Center for KSA and stores approval/pending/disapproval/error status.
- Syncs stock from COD Network and updates YouCan + GMC availability.
- Provides a dashboard for product management, filtering, single-product edits, bulk actions, manual sync, manual SEO regeneration, and manual GMC push.

## Current external API status

The public documentation/search results found during planning confirm these documented APIs:

- COD Network seller/drop product read endpoints: [Products](https://developer.cod.network/guides/cod-call/Products.html), [Drop Products](https://developer.cod.network/guides/cod-call/DropProducts.html), [Getting Started](https://developer.cod.network/guides/getting-started.html), and [Postman collection](https://www.postman.com/cod-network-official/codnetwork-api/documentation/2ojd8s5/codnetwork-api).
- YouCan product APIs: [Create Product](https://developer.youcan.shop/store-admin/products/create), [List Products](https://developer.youcan.shop/store-admin/products/listing), [Update Product](https://developer.youcan.shop/store-admin/products/update), and [Product Entity](https://developer.youcan.shop/store-admin/entities/product).
- Google Merchant Center product APIs: [Merchant API add/manage products](https://developers.google.com/merchant/api/guides/products/add-manage), [productInputs.insert](https://developers.google.com/merchant/api/reference/rest/products_v1beta/accounts.productInputs/insert), and [product status reference](https://developers.google.com/shopping-content/reference/rest/v2.1/productstatuses/get).

Important blocker: the exact COD Network endpoint for adding/selecting a drop product into the seller account/product list was not available in the public docs I found. The project therefore includes a dedicated adapter method, `ensureSellerProduct`, that checks existing seller products and then calls `COD_NETWORK_ADD_PRODUCT_ENDPOINT` when you provide the official endpoint. It intentionally fails with a clear error if that endpoint is not configured, because the requirement says not to invent COD Network endpoints.

## Tech stack

- Next.js 15 + React 19 + TypeScript
- Prisma + PostgreSQL
- BullMQ + Redis workers
- Tailwind CSS
- OpenAI-compatible AI client, defaulting to DuckCoding:
  - Base URL: `https://www.duckcoding.ai/`
  - Model: `claude-opus-4-8`
- Google Merchant API
- Docker Compose
- Caddy reverse proxy template for `app.example.com`

## Required secrets and credentials

Do not commit secrets. Copy `.env.example` to `.env` locally or `.env.production` on the server and fill values there.

Required before live operation:

- `COD_NETWORK_API_TOKEN`
- `COD_NETWORK_ADD_PRODUCT_ENDPOINT` — official COD endpoint for adding/selecting a product into your seller account/list
- `YOUCAN_API_TOKEN`
- `YOUCAN_STORE_URL`
- `GOOGLE_MERCHANT_ACCOUNT_ID`
- `GOOGLE_MERCHANT_DATA_SOURCE_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`
- `AI_API_KEY` for DuckCoding/OpenAI-compatible provider
- `APP_BASE_URL=https://app.example.com`

## Google Merchant Center credentials and first-time registration

Merchant API setup has three separate parts: enabling the API in Google Cloud, granting the service account access in Merchant Center, and registering the Google Cloud project once with the Merchant account. Completing only one or two of these steps causes `403 SERVICE_DISABLED`, `PERMISSION_DENIED_ACCOUNTS`, or `GCP_NOT_REGISTERED` errors.

### 1. Prepare Merchant Center

1. In Merchant Center, verify and claim the customer-facing store domain.
2. Open **Settings → Data sources** and create a **primary product data source** with input type **API**.
3. Configure its country, language, and feed label to match the app. For KSA, the defaults are country `SA`, content language `ar`, and feed label `SA`.
4. Record the Merchant Center account ID and API data source ID. Do not use a Business Manager ID or an unrelated parent account as `GOOGLE_MERCHANT_ACCOUNT_ID`.

### 2. Create a dedicated Google Cloud project and service account

1. Create or select a dedicated Google Cloud project.
2. Enable **Merchant API** (`merchantapi.googleapis.com`) in that project.
3. Create a service account and JSON key.
4. In Merchant Center **People and access**, add the service-account email, for example `merchant-sync@PROJECT_ID.iam.gserviceaccount.com`, with sufficient access to manage products.
5. Store the JSON securely using one of these options:

```env
# Preferred when the secret is stored directly by the deployment platform/dashboard:
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Alternative when the JSON key is mounted as a file:
GOOGLE_APPLICATION_CREDENTIALS="/run/secrets/google-service-account.json"
```

Never commit the JSON key. The application requests the `https://www.googleapis.com/auth/content` OAuth scope.

### 3. Register the Google Cloud project once as a human admin

Google does not permit a service account to perform the initial `registerGcp` call. Use an individual Google user who is a direct Admin of the Merchant account being registered. The email in the JSON request body does not change the authenticated identity; the OAuth access token itself must belong to that human Admin.

1. In the same Google Cloud project as the service account, configure the Google Auth consent screen.
2. Create a **Web application** OAuth client.
3. Add this authorized redirect URI exactly:

```text
https://developers.google.com/oauthplayground
```

4. If the OAuth app is in Testing, add the human Merchant Admin as a test user.
5. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), open its settings, enable **Use your own OAuth credentials**, and enter that OAuth client's ID and secret.
6. Authorize this scope while signed in as the direct human Merchant Admin:

```text
https://www.googleapis.com/auth/content
```

7. Exchange the authorization code for a temporary access token.
8. In OAuth Playground Step 3, send this request. Select `POST` separately; the request URI field must contain only the URL, without a `POST ` prefix.

```http
POST https://merchantapi.googleapis.com/accounts/v1/accounts/{MERCHANT_ACCOUNT_ID}/developerRegistration:registerGcp
Content-Type: application/json
Authorization: Bearer {TEMPORARY_HUMAN_ACCESS_TOKEN}

{
  "developerEmail": "human-admin@example.com"
}
```

The Google Cloud project is inferred from the OAuth client that issued the token; do not put the project ID or number in the request body. A successful response contains the registered project number. `409 ALREADY_EXISTS` with `DUPLICATE_PROJECT_REGISTRATION` also confirms that the project is already registered.

If Merchant Center is managed by Business Manager or an advanced/parent account, inherited access might not make the human user a direct member of the store account. `PERMISSION_DENIED_USER_NOT_IN_THE_MERCHANT_ACCOUNT` identifies the account where Google sees that user. The safest setup is to add a separate human Admin directly to the verified store account, authorize OAuth as that user, and register the store account. Do not unregister an existing project merely because registration returns `ALREADY_EXISTS`.

After registration, revoke the temporary human OAuth token. Runtime product synchronization continues with the service account; the human token, OAuth client secret, and refresh token are not application settings.

### 4. Configure and verify the app

```env
GOOGLE_MERCHANT_ACCOUNT_ID="1234567890"
GOOGLE_MERCHANT_DATA_SOURCE_ID="12345678901"
GOOGLE_MERCHANT_ENABLED="true"
GMC_FEED_LABEL="SA"
GMC_CONTENT_LANGUAGE="ar"
GMC_CURRENCY="SAR"
```

Before a production push, verify all of the following:

- The service account can read `accounts/{ACCOUNT_ID}`.
- It can read `accounts/{ACCOUNT_ID}/dataSources/{DATA_SOURCE_ID}`.
- The data source is an API source for the intended country.
- Product price currency matches the landing page currency (for example, `SAR`, not `USD`, for a Saudi price shown in riyals).
- The product landing page and image URLs are publicly reachable.

Product insertion is asynchronous. A successful `productInputs:insert` response means Google accepted the input; the processed `products/{PRODUCT_ID}` resource may return `404 ITEM_NOT_FOUND` briefly before appearing. Poll later or use the dashboard's GMC status refresh rather than treating the immediate 404 as an insertion failure.

### GMC setup error reference

| Error | Meaning | Fix |
| --- | --- | --- |
| `SERVICE_DISABLED` | Merchant API is disabled in the credential's Cloud project. | Enable `merchantapi.googleapis.com` in the project number named by Google. |
| `PERMISSION_DENIED_ACCOUNTS` | The service account or OAuth user lacks Merchant account access. | Add that exact email in Merchant Center/Business Manager with suitable access. |
| `GCP_NOT_REGISTERED` | The OAuth/service-account Cloud project is not linked to Merchant Center. | Complete the one-time human `registerGcp` flow above. |
| `PERMISSION_DENIED_TO_REGISTER_GCP_WITH_SERVICE_ACCOUNT` | Initial registration was attempted with a service account. | Authenticate as a human Merchant Admin using OAuth. |
| `PERMISSION_DENIED_USER_NOT_IN_THE_MERCHANT_ACCOUNT` | The OAuth token belongs to a user inherited from or directly attached to another account. | Authenticate as a direct Admin of the intended verified Merchant account. |
| `HOMEPAGE_NOT_VERIFIED` | The account being registered has no verified homepage. | Verify the store homepage on that account or register the correct verified store account. |
| `DUPLICATE_PROJECT_REGISTRATION` / HTTP 409 | The project is already registered. | No action required; test service-account access and continue. |

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d postgres redis
npx prisma migrate dev
npm run db:seed
npm run dev
```

Run the worker in a separate terminal:

```bash
npm run worker
```

Open:

```text
http://localhost:3000/dashboard/products
```

## Main dashboard pages

- `/dashboard/products` — product list, image preview, COD ID, COD SKU, YouCan ID, GMC status, title, category, price, stock, visibility, SEO status, import status, errors, filters, and manual actions.
- `/dashboard/products/[id]` — single product price/category/visibility/SEO editing.
- `/dashboard/settings` — country, pricing formula, discount rules summary, AI provider/model, GMC defaults, and secret checklist.
- `/dashboard/logs` — import, sync, YouCan, GMC, AI, search, dashboard, and system logs.

## Dashboard click/action documentation

Detailed GitHub documentation for every dashboard click, button, filter, pagination control, bulk action, row action, settings action, and recovery flow is in:

```text
docs/dashboard-actions.md
```

This includes what each click triggers locally, which background jobs run, and what is sent to COD Network, YouCan, SerpApi, AI providers, and Google Merchant Center.

## AI provider fallback and tests

The app supports both an OpenAI-compatible provider and an Anthropic-compatible provider.

- Configure OpenAI-compatible settings with `AI_PROVIDER_NAME`, `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`.
- Configure Anthropic-compatible settings with `ANTHROPIC_PROVIDER_NAME`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`.
- Control automatic fallback order with `AI_PROVIDER_ORDER`, for example:
  - `openai,anthropic`
  - `anthropic,openai`
- The Settings page has test buttons for OpenAI-compatible, Anthropic-compatible, and the full fallback chain.
- SEO generation and AI-assisted image selection use the fallback chain, so if the first provider fails, the next configured provider is tried automatically.

## Automation flow

1. `discover-cod-products`
   - Fetches KSA COD drop/catalog products.
   - Upserts local product records.
   - Queues SKU confirmation.
2. `ensure-cod-sku`
   - Checks seller products.
   - Adds/selects the COD product if missing using `COD_NETWORK_ADD_PRODUCT_ENDPOINT`.
   - Stores generated COD SKU.
3. `enrich-seo`
   - Uses product text, images, category list, and optional web search results.
   - Generates safe SEO/GMC-compliant metadata.
4. `import-youcan`
   - Creates or updates YouCan product using COD SKU duplicate protection.
   - Adds images, category, visibility, inventory, price, and discount quantity variants.
5. `push-gmc`
   - Builds Google Merchant ProductInput for KSA.
   - Uses COD SKU as `offerId`.
   - Saves submission/status details.
6. `sync-stock`
   - Runs for one enabled country or all enabled stock-sync countries.
   - Discovers newly available seller products before reconciling existing records.
   - Updates local stock and visibility, hides out-of-stock YouCan products, and restores visibility when stock returns.
   - Queues YouCan product updates and GMC availability updates when integrations are connected.
   - Can queue automatic YouCan imports for newly discovered in-stock products.
7. YouCan category and variant maintenance
   - Synchronizes YouCan categories into local settings for category mapping and related-product selection.
   - Supports dashboard bulk updates for quantity discount variants.
   - Uses local same-category products for YouCan related-product links, with safe fallbacks when the category has too few products.

## Quantity discount variants

Seeded default rules:

- Buy 2: 20% off
- Buy 3: 30% off
- Buy 5: 30% off

The YouCan payload creates a `Quantity Offer` variant option with SKUs:

- `{COD_SKU}` for Buy 1
- `{COD_SKU}-Q2`
- `{COD_SKU}-Q3`
- `{COD_SKU}-Q5`

## One-off manual product import

If the COD discovery/add endpoint is not ready yet, you can still create one product in YouCan and record its public URL by supplying a known SKU and product details manually.

```bash
npm run import:single -- --json '{"codSku":"TEST-SKU-001","name":"Test Product","description":"Safe product description","price":99,"stockQuantity":10,"imageUrls":["https://example.com/image.jpg"],"categorySlug":"general-gadgets"}'
```

Or set `PRODUCT_*` variables in `.env.production` and run:

```bash
npm run import:single
```

The script upserts a local product, creates fallback SEO metadata, imports/updates YouCan using SKU duplicate protection, and prints `youCanPublicUrl`. Set `PRODUCT_PUSH_GMC=true` only when Google Merchant credentials are configured.

## Recover failed products and import them to YouCan

To list every product with an error or failed status without changing anything:

```bash
npm run recover:failed-products -- --dry-run
```

To apply automatic fixes and retry imports:

```bash
npm run recover:failed-products
```

The recovery command classifies each product, explains the cause, applies safe fixes where possible, and prints a JSON report. The main automatic fix for the YouCan validation error is ensuring the product SKU and every variant SKU are exactly the clean COD seller SKU only. Errors that require business input, such as missing category mapping, missing credentials, or not enough exact product images, are reported with the manual action required.

The authenticated API equivalent is:

```http
POST /api/jobs/manual-product
```

with the same JSON body. The response includes the stage, YouCan product ID, slug, and public URL.

## Deployment to VPS

Target host:

```text
deploy-user@YOUR_VPS_IP
```

The password/key must not be stored in code or GitHub.

High-level steps after GitHub repo is ready and server access is available:

```bash
ssh deploy-user@YOUR_VPS_IP
sudo mkdir -p /opt/cod-youcan-gmc-automation
sudo chown $USER:$USER /opt/cod-youcan-gmc-automation
cd /opt/cod-youcan-gmc-automation
# clone or pull the GitHub repo
cp .env.example .env.production
# edit .env.production with real secrets on the VPS only
docker compose build
docker compose up -d
```

Caddy:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Ensure DNS for `app.example.com` points to the VPS.

## Production readiness checklist

- Keep `.env.production`, Google service-account JSON, OAuth tokens, API tokens, and passwords out of Git.
- Confirm the official COD Network add/select product endpoint and API token.
- Confirm YouCan access, category mappings, quantity variant labels, and public store URL.
- Complete the Merchant API setup and verification procedure above.
- Confirm AI and SerpApi credentials through the dashboard test actions.
- Review enabled countries, pricing/currency, discount rules, stock-sync behavior, and worker concurrency.
- Build and run database migrations before deployment.
- Confirm DNS, TLS, Caddy routing, `/api/health`, the worker, Redis, and PostgreSQL.
- Push one test product and verify its processed Merchant status before enabling automatic GMC pushes broadly.

## Products dashboard action map

The products page now has a sticky section navigator: **Actions → Filters → Selected / bulk → Product list**. Use it to jump between controls instead of scrolling through one long page.

Exact toolbar button behavior:

- **Discover SA catalog** → queues catalog discovery for Saudi Arabia; discovered products continue through SKU confirmation and the normal pipeline.
- **Process visible 50** → queues the next required processing step for each product on the current 50-row page only.
- **Sync Stock** → queues COD seller-stock synchronization for the selected/enabled countries.
- **Sync YouCan categories** → reads YouCan categories and updates local category mappings.
- **Bulk SEO** → jumps to selected/bulk actions; it does not run until products are selected and the bulk SEO action is clicked.
- **Push GMC** → jumps to selected/bulk actions, where selected products can be queued for a full GMC submission.
- **Import YouCan** → jumps to selected/bulk actions, where selected products can be queued for a full YouCan import/update.

- **Keep only these three rules** → removes every legacy discount variant rule and restores only `أريد واحدة فقط`, `أريد اثنان + واحدة مجانا`, and `أريد ثلاثة + اثنين مجانا`. The startup seed enforces the same fixed set, so removed legacy rules do not return after a restart.
- **Bulk update YouCan variants** → applies those three canonical quantity choices and their calculated prices to existing mapped YouCan products.
- **Update existing GMC product currency** → saves the selected GMC currency and queues a Merchant API currency-only correction for every product already pushed to GMC. Each worker reads Google's current amount and resends that unchanged amount because Google stores currency inside the price object, but does not update YouCan, local currency, descriptions, images, stock, categories, or unrelated GMC attributes.
- **GMC preview** → opens the mapped product directly in the configured Google Merchant Center account from either the product row or product editor, next to the YouCan and COD preview buttons.

Each product displays a detailed GMC indicator derived from the latest Merchant API `destinationStatuses` and issues. It distinguishes **pending, approved, limited, disapproved, error, excluded, queued, and not submitted**, shows the last check time and an issue summary, and includes a **GMC status** row button to queue a fresh status read. `LIMITED` is derived for display without a risky database-enum migration.

The expanded bulk panel includes a signed percentage price-only action with two scopes:

- **Selected** → only checked products on the visible page.
- **All filtered** → every product matching the current search and filters across all pages.

Positive percentages increase prices and negative percentages decrease them. The resulting one-unit selling price is normalized to the nearest whole-SAR value ending in `9`; quantity variants are then calculated from that finalized one-unit price using the active Discount variant rules and independently normalized to end in `9`. For example, `199 SAR` reduced by `40%` becomes `119 SAR`, then the canonical three-unit and five-unit rules produce `239 SAR` and `359 SAR`. The server updates local prices and queues one `sync-product-price` worker job per product. The worker fetches the current YouCan product/variants, changes only product and variant price values, and sends the minimal update shape required by YouCan. GMC is updated with `productInputs.patch` and `updateMask=productAttributes.price`. Descriptions, images, SEO, category, visibility, inventory, and other fields are not rewritten. Products missing YouCan/GMC mappings are reported in `lastError` and logs; price sync never falls back to a full import.
