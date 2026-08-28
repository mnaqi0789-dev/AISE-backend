-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "publishedAt" TIMESTAMP(3),
    "cleanText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "simhash" TEXT,
    "nearDuplicateOfId" TEXT,
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lensTags" TEXT[],

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_fetches" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "statusCode" INTEGER,
    "headers" JSONB,
    "rawHtml" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extracted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "raw_fetches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lenses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domains" TEXT[],
    "mode" TEXT NOT NULL,
    "owner" TEXT,

    CONSTRAINT "lenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "lensId" TEXT,
    "filters" JSONB,
    "resultCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_canonicalUrl_key" ON "documents"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "documents_contentHash_key" ON "documents"("contentHash");

-- CreateIndex
CREATE INDEX "documents_domain_idx" ON "documents"("domain");

-- CreateIndex
CREATE INDEX "documents_crawledAt_idx" ON "documents"("crawledAt");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_nearDuplicateOfId_fkey" FOREIGN KEY ("nearDuplicateOfId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lenses" ADD CONSTRAINT "lenses_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_lensId_fkey" FOREIGN KEY ("lensId") REFERENCES "lenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
