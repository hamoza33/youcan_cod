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
   - Reads COD seller stock.
   - Updates local stock, queues YouCan update, and queues GMC update.

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

Ensure DNS for `app.example.com` points to `YOUR_VPS_IP`.

## Missing items I still need from you for live completion

1. Official COD Network add/select product endpoint docs or Postman request.
2. COD Network API token.
3. YouCan API token and category IDs.
4. Google Merchant account ID, API data source ID, and credentials.
5. DuckCoding API key.
6. GitHub repository target or permission to create/push one.
7. VPS SSH authentication method and confirmation that Docker/Caddy/sudo are available.
8. DNS confirmation for `app.example.com`.
