-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CountryCode" AS ENUM ('SA');

-- CreateEnum
CREATE TYPE "ProductSourceStatus" AS ENUM ('DISCOVERED', 'ADDED_TO_ACCOUNT', 'SKU_CONFIRMED', 'OUT_OF_STOCK', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('NOT_IMPORTED', 'QUEUED', 'IMPORTING', 'IMPORTED', 'UPDATED', 'SKIPPED_DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "SeoStatus" AS ENUM ('MISSING', 'QUEUED', 'GENERATING', 'READY', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "GmcStatus" AS ENUM ('NOT_SUBMITTED', 'QUEUED', 'PENDING', 'APPROVED', 'DISAPPROVED', 'ERROR', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('UNKNOWN', 'IN_STOCK', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "VisibilityStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DISCOVER_COD_PRODUCTS', 'ENSURE_COD_SKU', 'ENRICH_SEO', 'IMPORT_YOUCAN', 'PUSH_GMC', 'SYNC_STOCK', 'REFRESH_GMC_STATUS', 'BULK_EDIT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogSource" AS ENUM ('COD', 'YOUCAN', 'GMC', 'AI', 'SEARCH', 'SYNC', 'DASHBOARD', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "SettingKind" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'SECRET_REF');

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "kind" "SettingKind" NOT NULL DEFAULT 'STRING',
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "youCanCategoryId" TEXT,
    "googleProductCategory" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discountPercent" DECIMAL(6,2) NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodProduct" (
    "id" TEXT NOT NULL,
    "codProductId" TEXT NOT NULL,
    "codDropProductId" TEXT,
    "codSku" TEXT,
    "country" "CountryCode" NOT NULL DEFAULT 'SA',
    "sourceStatus" "ProductSourceStatus" NOT NULL DEFAULT 'DISCOVERED',
    "importStatus" "ImportStatus" NOT NULL DEFAULT 'NOT_IMPORTED',
    "seoStatus" "SeoStatus" NOT NULL DEFAULT 'MISSING',
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'UNKNOWN',
    "visibilityStatus" "VisibilityStatus" NOT NULL DEFAULT 'VISIBLE',
    "gmcStatus" "GmcStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "name" TEXT NOT NULL,
    "rawName" TEXT,
    "description" TEXT,
    "rawDescription" TEXT,
    "productCost" DECIMAL(12,2),
    "price" DECIMAL(12,2),
    "compareAtPrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "stockQuantity" INTEGER,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawPayload" JSONB,
    "lastCodSyncAt" TIMESTAMP(3),
    "lastYouCanSyncAt" TIMESTAMP(3),
    "lastGmcSyncAt" TIMESTAMP(3),
    "lastSeoGeneratedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "codProductId" TEXT NOT NULL,
    "codSku" TEXT NOT NULL,
    "youCanProductId" TEXT,
    "youCanVariantId" TEXT,
    "youCanSlug" TEXT,
    "youCanPublicUrl" TEXT,
    "googleProductId" TEXT,
    "googleOfferId" TEXT,
    "googleFeedLabel" TEXT NOT NULL DEFAULT 'SA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoMetadata" (
    "id" TEXT NOT NULL,
    "codProductId" TEXT NOT NULL,
    "productType" TEXT,
    "useCase" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "metaTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "safeSellingPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categorySuggestion" TEXT,
    "complianceNotes" TEXT,
    "sourceSummary" TEXT,
    "aiProvider" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL,
    "rawAiResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmcSubmission" (
    "id" TEXT NOT NULL,
    "codProductId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "productId" TEXT,
    "accountId" TEXT,
    "dataSourceId" TEXT,
    "feedLabel" TEXT NOT NULL DEFAULT 'SA',
    "contentLanguage" TEXT NOT NULL DEFAULT 'ar',
    "status" "GmcStatus" NOT NULL DEFAULT 'PENDING',
    "payloadHash" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "destinationStatuses" JSONB,
    "issues" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmcSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "codProductId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "country" "CountryCode" NOT NULL DEFAULT 'SA',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogEvent" (
    "id" TEXT NOT NULL,
    "source" "LogSource" NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "codProductId" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_quantity_discountPercent_key" ON "DiscountRule"("quantity", "discountPercent");

-- CreateIndex
CREATE UNIQUE INDEX "CodProduct_codSku_key" ON "CodProduct"("codSku");

-- CreateIndex
CREATE INDEX "CodProduct_country_importStatus_idx" ON "CodProduct"("country", "importStatus");

-- CreateIndex
CREATE INDEX "CodProduct_stockStatus_idx" ON "CodProduct"("stockStatus");

-- CreateIndex
CREATE INDEX "CodProduct_gmcStatus_idx" ON "CodProduct"("gmcStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CodProduct_codProductId_country_key" ON "CodProduct"("codProductId", "country");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_codProductId_key" ON "ProductMapping"("codProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_codSku_key" ON "ProductMapping"("codSku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_youCanProductId_key" ON "ProductMapping"("youCanProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_googleProductId_key" ON "ProductMapping"("googleProductId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoMetadata_codProductId_key" ON "SeoMetadata"("codProductId");

-- CreateIndex
CREATE INDEX "GmcSubmission_offerId_idx" ON "GmcSubmission"("offerId");

-- CreateIndex
CREATE INDEX "GmcSubmission_status_idx" ON "GmcSubmission"("status");

-- CreateIndex
CREATE INDEX "ImportJob_type_status_idx" ON "ImportJob"("type", "status");

-- CreateIndex
CREATE INDEX "ImportJob_codProductId_idx" ON "ImportJob"("codProductId");

-- CreateIndex
CREATE INDEX "LogEvent_source_level_idx" ON "LogEvent"("source", "level");

-- CreateIndex
CREATE INDEX "LogEvent_codProductId_idx" ON "LogEvent"("codProductId");

-- CreateIndex
CREATE INDEX "LogEvent_createdAt_idx" ON "LogEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "CodProduct" ADD CONSTRAINT "CodProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_codProductId_fkey" FOREIGN KEY ("codProductId") REFERENCES "CodProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoMetadata" ADD CONSTRAINT "SeoMetadata_codProductId_fkey" FOREIGN KEY ("codProductId") REFERENCES "CodProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmcSubmission" ADD CONSTRAINT "GmcSubmission_codProductId_fkey" FOREIGN KEY ("codProductId") REFERENCES "CodProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_codProductId_fkey" FOREIGN KEY ("codProductId") REFERENCES "CodProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEvent" ADD CONSTRAINT "LogEvent_codProductId_fkey" FOREIGN KEY ("codProductId") REFERENCES "CodProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
