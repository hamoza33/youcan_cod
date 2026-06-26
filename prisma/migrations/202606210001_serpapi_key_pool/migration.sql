-- CreateTable
CREATE TABLE "ImageSearchApiKey" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SERPAPI',
    "label" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 250,
    "monthlyUsage" INTEGER NOT NULL DEFAULT 0,
    "totalUsage" INTEGER NOT NULL DEFAULT 0,
    "resetMonth" TEXT NOT NULL,
    "remoteMonthlyLimit" INTEGER,
    "remoteMonthlyUsage" INTEGER,
    "remoteSearchesLeft" INTEGER,
    "remoteTotalSearchesLeft" INTEGER,
    "remotePlanName" TEXT,
    "remoteSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageSearchApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageSearchApiKey_apiKey_key" ON "ImageSearchApiKey"("apiKey");

-- CreateIndex
CREATE INDEX "ImageSearchApiKey_provider_isActive_idx" ON "ImageSearchApiKey"("provider", "isActive");

-- CreateIndex
CREATE INDEX "ImageSearchApiKey_resetMonth_idx" ON "ImageSearchApiKey"("resetMonth");
