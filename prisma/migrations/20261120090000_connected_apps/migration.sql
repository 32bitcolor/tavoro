-- CreateTable
CREATE TABLE "ConnectedApp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'courseforge',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "ConnectedApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAppCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedAppCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedApp_clientId_key" ON "ConnectedApp"("clientId");

-- CreateIndex
CREATE INDEX "ConnectedApp_workspaceId_idx" ON "ConnectedApp"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAppCode_codeHash_key" ON "ConnectedAppCode"("codeHash");

-- AddForeignKey
ALTER TABLE "ConnectedApp" ADD CONSTRAINT "ConnectedApp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAppCode" ADD CONSTRAINT "ConnectedAppCode_appId_fkey" FOREIGN KEY ("appId") REFERENCES "ConnectedApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

