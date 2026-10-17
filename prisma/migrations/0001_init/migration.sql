-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'sme',
    "legalName" TEXT NOT NULL,
    "tradeLicence" TEXT NOT NULL,
    "licenceExpiry" TIMESTAMP(3) NOT NULL,
    "emirate" TEXT NOT NULL,
    "sectorCode" TEXT NOT NULL,
    "kybState" TEXT NOT NULL DEFAULT 'review',
    "tenureMonths" INTEGER NOT NULL DEFAULT 0,
    "billingBand" TEXT NOT NULL DEFAULT 'medium',
    "duPaySuffix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerTaxId" TEXT NOT NULL,
    "buyerEmirate" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'unrated',
    "relationshipAgeDays" INTEGER NOT NULL DEFAULT 0,
    "confirmedInvoiceCount" INTEGER NOT NULL DEFAULT 0,
    "avgDaysToPay" INTEGER NOT NULL DEFAULT 45,
    "disputeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "buyerLinkId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "grossFils" INTEGER NOT NULL,
    "taxFils" INTEGER NOT NULL DEFAULT 0,
    "invoiceHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "verificationState" TEXT NOT NULL DEFAULT 'received',
    "verifiedVia" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "fundingState" TEXT NOT NULL DEFAULT 'none',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL DEFAULT 'invoice',
    "decisionType" TEXT NOT NULL DEFAULT 'advance_offer',
    "inputHash" TEXT NOT NULL,
    "rulepackVersion" TEXT NOT NULL,
    "featureSnapshot" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "limitFils" INTEGER,
    "advanceRatePermyriad" INTEGER,
    "priceMilliBpsPerDay" INTEGER,
    "bindingRule" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "shadow" BOOLEAN NOT NULL DEFAULT false,
    "canary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "grossFils" INTEGER NOT NULL,
    "advanceRatePermyriad" INTEGER NOT NULL,
    "principalFils" INTEGER NOT NULL,
    "rateMilliBps" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'offered',
    "settlementDate" TIMESTAMP(3),
    "daysEarly" INTEGER,
    "feeFils" INTEGER,
    "netProceedsFils" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "acceptedIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rail" TEXT NOT NULL DEFAULT 'dupay',
    "destinationRef" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'accepted',
    "providerRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "etaSeconds" INTEGER NOT NULL DEFAULT 18,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierEntityId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEntityName" TEXT NOT NULL,
    "custodianRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'funded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EscrowContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "conditionType" TEXT NOT NULL,
    "reviewWindowDays" INTEGER NOT NULL DEFAULT 3,
    "evidenceRef" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "metAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryPolicy" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tenantId" TEXT NOT NULL,
    "floorFils" INTEGER NOT NULL DEFAULT 5000000,
    "horizonDays" INTEGER NOT NULL DEFAULT 14,
    "safetyMarginPermyriad" INTEGER NOT NULL DEFAULT 1500,
    "autoPilotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'once',
    "confidencePermyriad" INTEGER NOT NULL DEFAULT 9000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sweep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "instrumentRef" TEXT NOT NULL,
    "floorAtDecisionFils" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'swept',
    "yieldFils" INTEGER NOT NULL DEFAULT 0,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recalledAt" TIMESTAMP(3),

    CONSTRAINT "Sweep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceEventId" TEXT NOT NULL,
    "memo" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'du_business',
    "providerConsentRef" TEXT,

    CONSTRAINT "ConsentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "subjectRef" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "mode" TEXT NOT NULL DEFAULT 'M0',
    "killSwitchesJson" TEXT NOT NULL DEFAULT '{"global":false,"dynamicDiscounting":false,"escrow":false,"treasury":false,"tenant":false,"buyer":false,"sector":false,"rail":false}',
    "breakersJson" TEXT NOT NULL DEFAULT '{"dupay":"closed","aani":"closed","openfinance":"closed","einvoice":"closed","custodian":"closed","notification":"closed"}',
    "message" TEXT,
    "guardrailEpisodeJson" TEXT,
    "canaryJson" TEXT,
    "writeLockNonce" TEXT NOT NULL DEFAULT '0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorAction" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetRef" TEXT,
    "reason" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_invoiceHash_idx" ON "Invoice"("invoiceHash");

-- CreateIndex
CREATE INDEX "Invoice_entityId_verificationState_idx" ON "Invoice"("entityId", "verificationState");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_invoiceHash_key" ON "Invoice"("tenantId", "invoiceHash");

-- CreateIndex
CREATE INDEX "Decision_tenantId_subjectRef_idx" ON "Decision"("tenantId", "subjectRef");

-- CreateIndex
CREATE INDEX "Decision_inputHash_idx" ON "Decision"("inputHash");

-- CreateIndex
CREATE INDEX "Decision_canary_idx" ON "Decision"("canary");

-- CreateIndex
CREATE INDEX "Offer_tenantId_state_idx" ON "Offer"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_offerId_key" ON "Payout"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Milestone_contractId_sequence_idx" ON "Milestone"("contractId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryPolicy_tenantId_key" ON "TreasuryPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "Sweep_tenantId_state_idx" ON "Sweep"("tenantId", "state");

-- CreateIndex
CREATE INDEX "LedgerEntry_txnId_idx" ON "LedgerEntry"("txnId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountCode_idx" ON "LedgerEntry"("accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_tenantId_sourceEventId_key" ON "LedgerEntry"("tenantId", "sourceEventId");

-- CreateIndex
CREATE INDEX "AppEvent_tenantId_type_idx" ON "AppEvent"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "BuyerLink" ADD CONSTRAINT "BuyerLink_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_buyerLinkId_fkey" FOREIGN KEY ("buyerLinkId") REFERENCES "BuyerLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EscrowContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Enable tenant-scoped row-level security (PRD Part 2.3).
-- CREATE ROLE has no IF NOT EXISTS in Postgres, so guard with pg_roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'CREATE ROLE app_user LOGIN PASSWORD ''app_dev''';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER TABLE "Entity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Entity";
CREATE POLICY tenant_isolation ON "Entity"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "BuyerLink" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BuyerLink";
CREATE POLICY tenant_isolation ON "BuyerLink"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invoice";
CREATE POLICY tenant_isolation ON "Invoice"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "Decision" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Decision";
CREATE POLICY tenant_isolation ON "Decision"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "Offer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Offer";
CREATE POLICY tenant_isolation ON "Offer"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "Payout" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payout";
CREATE POLICY tenant_isolation ON "Payout"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "EscrowContract" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EscrowContract";
CREATE POLICY tenant_isolation ON "EscrowContract"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "TreasuryPolicy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TreasuryPolicy";
CREATE POLICY tenant_isolation ON "TreasuryPolicy"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "Obligation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Obligation";
CREATE POLICY tenant_isolation ON "Obligation"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "Sweep" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Sweep";
CREATE POLICY tenant_isolation ON "Sweep"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LedgerEntry";
CREATE POLICY tenant_isolation ON "LedgerEntry"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "ConsentGrant" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConsentGrant";
CREATE POLICY tenant_isolation ON "ConsentGrant"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
ALTER TABLE "AppEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppEvent";
CREATE POLICY tenant_isolation ON "AppEvent"
  FOR ALL TO app_user
  USING (current_setting('app.tenant_id', true) = "tenantId")
  WITH CHECK (current_setting('app.tenant_id', true) = "tenantId");
