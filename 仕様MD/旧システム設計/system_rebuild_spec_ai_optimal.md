# System Rebuild Specification: LinksSys (AI-Optimized Specification)

> **Prompt Instruction for Target AI Agent:**
> Act as a Principal Full-Stack Engineer. Rebuild the entire "LinksSys" management and accounting system based on this high-density technical specification. Strictly adhere to all Prisma schemas, calculation business rules, deep-copy specifications, and approval lock invariants defined below.

---

## 1. Architecture & Tech Stack

- **Framework**: Next.js (App Router, React 19, TypeScript)
- **ORM / DB**: Prisma ORM + PostgreSQL / SQLite
- **Styling**: Vanilla CSS / Tailwind CSS
- **Core Domain**: B2B dispatch/transport contract management, daily report entry, dynamic pricing calculation, automated billing (invoices) and payment processing.

---

## 2. Invariable Business Rules & Core Invariants

1. **Deep Copy on Project Creation**: When instantiating a `Project` from a `ProjectTemplate`, all associated `PriceSet` and `PriceRow` records MUST be duplicated (deep-copied) under `projectId`. Future updates to templates must NOT mutate existing active `Project` prices.
2. **Approval Lock**: `MonthlyReport` with `approvalStatus = "承認"` (Approved) MUST block all `POST`, `PUT`, `DELETE` operations on itself and child `DailyReportEntry` records (Return `403 Forbidden`).
3. **Spot Price Override**: If `DailyReportEntry.useSpotPrice === true`, bypass `PriceSet` lookup and use direct `spotBilling*` / `spotPayment*` amounts.
4. **Day Type Fallback Sequence**: When evaluating price for a day, if exact `dayType` row is missing, fallback in order: `平日 (Weekday)` -> `半日 (HalfDay)` -> `土曜 (Saturday)` -> `日曜 (Sunday)` -> `祝日 (Holiday)` -> `その他 (Other)`.
5. **Holiday Conversion**: Any date registered in the `Holiday` table MUST be processed as `祝日` (Holiday) regardless of calendar day of week.
6. **Non-Working Days (`isUnnecessary`)**: Entries with `isUnnecessary = true` must be strictly omitted from all sum totals and calculations (amount = 0).
7. **Payment Transaction Integrity**: `Payment` creation runs inside a single database transaction (`$transaction`):
   - Deducts advance payments (`AdvancePayment.paymentStatus = "精算済"`).
   - Decrements installment balances (`InstallmentPayment.balance`) sequentially in FIFO order (`applicationDate` ASC) and marks `repaymentStatus = "返済完了"` when `balance <= 0`.
8. **Anser/Zengin FB Export**: Export fixed-length 120-byte CRLF records (`1` Header, `2` Data, `8` Trailer, `9` End). Auto-update `Payment.paymentStatus` to `"支払済"`.

---

## 3. Database Schema (Prisma SDD)

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Client {
  id               Int                    @id @default(autoincrement())
  clientNo         String
  branchNo         String                 @default("01")
  name             String
  nameKana         String?
  salesRepId       Int?
  workType         String?
  postalCode       String?
  billingAddress   String?
  phone            String?
  fax              String?
  closingDay       String?
  paymentDay       String?
  contractDate     String?
  businessContent  String?
  bankName         String?
  branchBankName   String?
  accountNumber    String?
  depositType      String?
  accountHolder    String?
  contractManager  String?
  siteManager      String?
  notes            String?
  createdAt        DateTime               @default(now())
  updatedAt        DateTime               @updatedAt
  salesRep         SalesRep?              @relation(fields: [salesRepId], references: [id])
  billingAddresses ClientBillingAddress[]
  depositRecords   DepositRecord[]
  invoices         Invoice[]
  monthlyReports   MonthlyReport[]
  projects         Project[]
  projectTemplates ProjectTemplate[]
  vehicles         Vehicle[]

  @@unique([clientNo, branchNo])
}

model ClientBillingAddress {
  id                   Int     @id @default(autoincrement())
  clientId             Int
  billingNo            String
  branchNo             String?
  invoiceNo            String?
  issueType            String?
  multiInvoiceCategory String?
  email                String?
  fax                  String?
  bankName             String?
  branchBankName       String?
  accountNumber        String?
  depositType          String?
  accountHolder        String?
  notes                String?
  client               Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model Partner {
  id                  Int                  @id @default(autoincrement())
  partnerNo           String               @unique
  name                String
  nameKana            String?
  postalCode          String?
  address             String?
  phone               String?
  birthDate           String?
  bloodType           String?
  bankName            String?
  branchName          String?
  accountType         String?
  accountNumber       String?
  accountHolder       String?
  adminFee            Float?
  safetyFee           Float?
  injuryInsurance     Boolean              @default(false)
  liabilityInsurance  Boolean              @default(false)
  cargoInsurance      Boolean              @default(false)
  gAssociation        Boolean              @default(false)
  taxReturn           Boolean              @default(false)
  pastSafetyConf      Boolean              @default(false)
  workStartDate       String?
  contractDate        String?
  workHistory         String?
  continuousYears     Float?
  licenseExpiry       String?
  loopFlag            Boolean              @default(false)
  notes               String?
  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @updatedAt
  advancePayments     AdvancePayment[]
  installmentPayments InstallmentPayment[]
  monthlyReports      MonthlyReport[]
  payments            Payment[]
  projects            Project[]
  projectTemplates    ProjectTemplate[]
  vehicles            Vehicle[]
}

model ProjectTemplate {
  id                  Int               @id @default(autoincrement())
  templateNo          String            @unique
  name                String?
  clientId            Int
  branchNo            String?
  partnerId           Int?
  salesRepId          Int?
  closingDay          String?
  workType            String?
  reportCountType     String?
  plannedStartDate    String?
  plannedEndDate      String?
  paymentType         String            @default("通常")
  advancePrice        Float?
  installmentPrice    Float?
  defaultStartTime    String?
  defaultEndTime      String?
  defaultBreakMinutes Int?
  isBillingTarget     Boolean           @default(true)
  isPaymentTarget     Boolean           @default(true)
  overtimeCategoryId  Int?
  notes               String?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  priceSets           PriceSet[]        // onDelete: Cascade handled in app logic
  projects            Project[]
  salesRep            SalesRep?         @relation(fields: [salesRepId], references: [id])
  client              Client            @relation(fields: [clientId], references: [id])
  partner             Partner?          @relation(fields: [partnerId], references: [id])
  overtimeCategory    OvertimeCategory? @relation(fields: [overtimeCategoryId], references: [id])
}

model Project {
  id                  Int               @id @default(autoincrement())
  projectNo           String            @unique
  name                String?
  templateId          Int?
  clientId            Int
  branchNo            String?
  partnerId           Int?
  salesRepId          Int?
  closingDay          String?
  workType            String?
  reportCountType     String?
  startDate           String?
  endDate             String?
  paymentType         String            @default("通常")
  advancePrice        Float?
  installmentPrice    Float?
  defaultStartTime    String?
  defaultEndTime      String?
  defaultBreakMinutes Int?
  isBillingTarget     Boolean           @default(true)
  isPaymentTarget     Boolean           @default(true)
  overtimeCategoryId  Int?
  notes               String?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  advances            AdvancePayment[]
  invoiceItems        InvoiceItem[]
  monthlyReports      MonthlyReport[]
  paymentItems        PaymentItem[]
  priceSets           PriceSet[]
  salesRep            SalesRep?         @relation(fields: [salesRepId], references: [id])
  partner             Partner?          @relation(fields: [partnerId], references: [id])
  template            ProjectTemplate?  @relation(fields: [templateId], references: [id])
  client              Client            @relation(fields: [clientId], references: [id])
  overtimeCategory    OvertimeCategory? @relation(fields: [overtimeCategoryId], references: [id])
}

model PriceCategory {
  id          Int        @id @default(autoincrement())
  code        String     @unique
  name        String
  description String?
  notes       String?
  priceRows   PriceRow[]
}

model PriceSet {
  id         Int              @id @default(autoincrement())
  priceSetNo String           @unique
  name       String?
  validFrom  String
  validTo    String?
  projectId  Int?
  templateId Int?
  notes      String?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  rows       PriceRow[]
  project    Project?         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  template   ProjectTemplate? @relation(fields: [templateId], references: [id], onDelete: Cascade)
}

model PriceRow {
  id                       Int           @id @default(autoincrement())
  priceSetId               Int
  priceCategoryId          Int
  dayType                  String        // 平日|土曜|日曜|祝日|半日|その他
  priceName                String
  displayName              String?
  calcType                 String        // 日極|時間|距離
  billingPrice1            Float?        @default(0) // Base
  billingPrice2            Float?        // Overtime
  billingPrice3            Float?        // Night
  billingPrice4            Float?        // Night Overtime
  paymentPrice1            Float?        // Base
  paymentPrice2            Float?        // Overtime
  paymentPrice3            Float?        // Night
  paymentPrice4            Float?        // Night Overtime
  tableConfig              String?       // JSON string for tiered distance pricing
  billingDescriptionFormat String?
  paymentDescriptionFormat String?
  priceSet                 PriceSet      @relation(fields: [priceSetId], references: [id], onDelete: Cascade)
  priceCategory            PriceCategory @relation(fields: [priceCategoryId], references: [id])
}

model MonthlyReport {
  id                  Int                 @id @default(autoincrement())
  projectId           Int
  partnerId           Int
  clientId            Int
  periodStart         String
  periodEnd           String
  billingMonth        String?
  closingDay          String?
  approvalStatus      String              @default("入力中") // 入力中|承認依頼中|承認|差戻し|訂正中
  approvalComment     String?
  approvalRequestedAt DateTime?
  approvedAt          DateTime?
  inputUser           String?
  headerComment       String?
  notes               String?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  entries             DailyReportEntry[]
  statuses            DailyReportStatus[]
  project             Project             @relation(fields: [projectId], references: [id])
  partner             Partner             @relation(fields: [partnerId], references: [id])
  client              Client              @relation(fields: [clientId], references: [id])
  changeLogs          ReportChangeLog[]
}

model DailyReportEntry {
  id                   Int               @id @default(autoincrement())
  monthlyReportId      Int
  date                 String            // YYYY-MM-DD
  lineNo               Int               @default(1)
  dayOfWeek            String?
  startTime            String?           // HH:mm
  endTime              String?           // HH:mm
  distance             Float?
  excessDistance       Float?
  excessHours          Float?
  breakMinutes         Int?
  restraintHours       Float?
  workHours            Float?
  shortageHours        Float?
  nightHours           Float?
  nightExcessHours     Float?
  tollFee              Float?
  parkingFee           Float?
  transportFee         Float?
  useSpotPrice         Boolean           @default(false)
  spotBasePrice        Float?            @default(0)
  spotHourlyPrice      Float?            @default(0)
  spotOvertimePrice    Float?            @default(0)
  spotNightPrice       Float?            @default(0)
  spotNightOtPrice     Float?            @default(0)
  spotBillingBasePrice Float?            @default(0)
  spotBillingOvertime  Float?            @default(0)
  spotBillingNight     Float?            @default(0)
  spotBillingNightOt   Float?            @default(0)
  spotPaymentBasePrice Float?            @default(0)
  spotPaymentOvertime  Float?            @default(0)
  spotPaymentNight     Float?            @default(0)
  spotPaymentNightOt   Float?            @default(0)
  otherAdditionAmount  Float?            @default(0)
  calcBillingAmount    Float?
  calcPaymentAmount    Float?
  lineComment          String?
  notes                String?
  isTraining           Boolean           @default(false)
  isUnnecessary        Boolean           @default(false)
  appliedPriceSetId    Int?
  monthlyReport        MonthlyReport     @relation(fields: [monthlyReportId], references: [id], onDelete: Cascade)
  tasks                DailyReportTask[]
}

model DailyReportTask {
  id          Int              @id @default(autoincrement())
  entryId     Int
  taskNo      Int
  description String?
  amount      Float?
  entry       DailyReportEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
}

model ReportChangeLog {
  id              Int           @id @default(autoincrement())
  monthlyReportId Int
  entryId         Int?
  fieldName       String
  oldValue        String?
  newValue        String?
  changedBy       String?
  changedAt       DateTime      @default(now())
  monthlyReport   MonthlyReport @relation(fields: [monthlyReportId], references: [id], onDelete: Cascade)
}

model DailyReportStatus {
  id              Int           @id @default(autoincrement())
  monthlyReportId Int
  date            String
  isCompleted     Boolean       @default(false)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  monthlyReport   MonthlyReport @relation(fields: [monthlyReportId], references: [id], onDelete: Cascade)

  @@unique([monthlyReportId, date])
}

model Invoice {
  id             Int              @id @default(autoincrement())
  clientId       Int
  invoiceNumber  String           @unique
  revisionNumber Int              @default(0)
  periodStart    String
  periodEnd      String
  issueDate      String
  subtotal       Float            @default(0)
  taxAmount      Float            @default(0)
  totalAmount    Float            @default(0)
  dueDate        String?
  depositStatus  String           @default("未入金") // 未入金|一部入金|入金済
  depositDate    String?
  depositAmount  Float?
  pdfPath        String?
  status         String           @default("下書き") // 下書き|発行済|確定
  notes          String?
  createdBy      String?
  updatedBy      String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  client         Client           @relation(fields: [clientId], references: [id])
  history        InvoiceHistory[]
  items          InvoiceItem[]
}

model InvoiceItem {
  id                  Int      @id @default(autoincrement())
  invoiceId           Int
  projectId           Int?
  lineNo              Int
  description         String
  unitPrice           Float
  quantity            Float
  amount              Float
  notes               String?
  isManual            Boolean  @default(false)
  sourceReportEntryId Int?
  sourceType          String?
  snapshotPriceId     Int?
  project             Project? @relation(fields: [projectId], references: [id])
  invoice             Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
}

model InvoiceHistory {
  id             Int      @id @default(autoincrement())
  invoiceId      Int
  revisionNumber Int
  data           String   // JSON stringified historical data
  createdAt      DateTime @default(now())
  invoice        Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
}

model DepositRecord {
  id          Int      @id @default(autoincrement())
  clientId    Int?
  depositDate String
  amount      Float
  bankInfo    String?
  matchStatus String   @default("未消込") // 未消込|消込済
  invoiceRef  String?
  notes       String?
  createdAt   DateTime @default(now())
  client      Client?  @relation(fields: [clientId], references: [id])
}

model Payment {
  id                  Int           @id @default(autoincrement())
  partnerId           Int
  paymentNumber       String        @unique
  periodStart         String
  periodEnd           String
  paymentDate         String?
  grossAmount         Float         @default(0)
  deductionAmount     Float         @default(0)
  advanceDeduction    Float         @default(0)
  transferFee         Float         @default(0)
  penaltyAmount       Float         @default(0)
  netAmount           Float         @default(0)
  paymentType         String        @default("通常")
  paymentStatus       String        @default("未支払") // 未支払|確定|支払済
  actualPaymentDate   String?
  actualPaymentAmount Float?
  pdfPath             String?
  notes               String?
  createdBy           String?
  updatedBy           String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  partner             Partner       @relation(fields: [partnerId], references: [id])
  items               PaymentItem[]
}

model PaymentItem {
  id                  Int      @id @default(autoincrement())
  paymentId           Int
  projectId           Int?
  lineNo              Int
  description         String
  unitPrice           Float
  quantity            Float
  amount              Float
  notes               String?
  isManual            Boolean  @default(false)
  sourceReportEntryId Int?
  sourceType          String?
  snapshotPriceId     Int?
  project             Project? @relation(fields: [projectId], references: [id])
  payment             Payment  @relation(fields: [paymentId], references: [id], onDelete: Cascade)
}

model InstallmentPayment {
  id              Int      @id @default(autoincrement())
  partnerId       Int
  applicationDate String
  requestedAmount Float
  approvedAmount  Float?
  approvalDate    String?
  scheduledDate   String?
  actualDate      String?
  paymentStatus   String   @default("未支払")
  balance         Float    @default(0)
  repaymentStatus String   @default("返済中") // 返済中|返済完了
  transferFee     Float    @default(0)
  notes           String?
  createdBy       String?
  updatedBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  partner         Partner  @relation(fields: [partnerId], references: [id])
}

model AdvancePayment {
  id              Int      @id @default(autoincrement())
  projectId       Int?
  partnerId       Int
  paymentType     String   @default("先払い")
  targetMonth     String?
  closingPattern  String?
  periodIndex     Int?
  workDays        Int?
  unitPrice       Float?
  fee             Float    @default(0)
  isTarget        Boolean  @default(false)
  applicationDate String?
  advanceAmount   Float
  scheduledDate   String?
  actualDate      String?
  paymentStatus   String   @default("未支払") // 未支払|支払完了|精算済
  balance         Float    @default(0)
  notes           String?
  createdBy       String?
  updatedBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  project         Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  partner         Partner  @relation(fields: [partnerId], references: [id])

  @@unique([projectId, targetMonth, periodIndex])
}

model SalesRep {
  id               Int               @id @default(autoincrement())
  name             String
  phone            String?
  email            String?
  notes            String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  clients          Client[]
  projects         Project[]
  projectTemplates ProjectTemplate[]
}

model Holiday {
  id   Int    @id @default(autoincrement())
  date String @unique // YYYY-MM-DD
  name String
}

model Vehicle {
  id                Int      @id @default(autoincrement())
  clientId          Int?
  partnerId         Int?
  vehicleNumber     String
  vehicleInspExpiry String?
  insuranceExpiry   String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  client            Client?  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  partner           Partner? @relation(fields: [partnerId], references: [id], onDelete: Cascade)
}

model OvertimeCategory {
  id               Int               @id @default(autoincrement())
  name             String
  baseTime         Float
  thresholdMinutes Int
  lessThanAction   String
  moreThanAction   String
  notes            String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  projects         Project[]
  projectTemplates ProjectTemplate[]
}

model ClosingDay {
  id   Int    @id @default(autoincrement())
  code String @unique
  name String
}

model PaymentDay {
  id   Int    @id @default(autoincrement())
  code String @unique
  name String
}

model CalcType {
  id   Int    @id @default(autoincrement())
  code String @unique
  name String
}

model WorkType {
  id    Int     @id @default(autoincrement())
  name  String
  notes String?
}

model ReportCountType {
  id    Int     @id @default(autoincrement())
  name  String
  notes String?
}

model DayTypeCategory {
  id    Int     @id @default(autoincrement())
  code  String  @unique
  name  String
  notes String?
}

model DescriptionPlaceholder {
  id    Int     @id @default(autoincrement())
  code  String  @unique
  name  String
  notes String?
}

model CompanyBankAccount {
  id            Int      @id @default(autoincrement())
  bankName      String
  branchName    String
  branchCode    String?
  accountType   String   @default("普通")
  accountNumber String
  accountHolder String
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  passwordHash String
  name         String
  role         String   @default("user")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model ExcelImportSession {
  id           String   @id @default(uuid())
  status       String   @default("MAPPING_REQUIRED")
  parsedData   String
  mappedConfig String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model CashManagementDay {
  id    Int     @id @default(autoincrement())
  day   Int     @unique
  name  String?
  notes String?
}

model CashEvent {
  id          Int      @id @default(autoincrement())
  date        String
  amount      Float
  type        String   // 収入|支出
  category    String   // 業務委託|環境|給与|通常|分割|経費
  bankName    String?
  description String?
  isSpot      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model CashTransferDate {
  id           Int      @id @default(autoincrement())
  year         Int
  month        Int
  day          Int
  transferDate String?
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([year, month, day])
}

model UILayout {
  id        Int              @id @default(autoincrement())
  screenKey String           @unique
  config    String
  isActive  Boolean          @default(true)
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  backups   UILayoutBackup[]
}

model UILayoutBackup {
  id         Int      @id @default(autoincrement())
  uiLayoutId Int
  config     String
  notes      String?
  createdAt  DateTime @default(now())
  uiLayout   UILayout @relation(fields: [uiLayoutId], references: [id], onDelete: Cascade)
}
```

---

## 4. Calculation Engine (Algorithm Specifications)

```typescript
// DAY TYPE SEARCH FALLBACK PRIORITY
const DAY_TYPE_PRIORITY = ['平日', '半日', '土曜', '日曜', '祝日', 'その他'];

interface CalculationParams {
  entries: DailyReportEntry[];
  priceRows: PriceRow[];
  stdRestraintHours: number; // Default: 8
  stdBreakMinutes: number;   // Default: 60
  mode: 'billing' | 'payment';
}

function calculateAmount(params: CalculationParams): CalculationResult {
  const stdWorkHours = Math.max(0, params.stdRestraintHours - params.stdBreakMinutes / 60);
  let gross = 0, expenses = 0;

  for (const entry of params.entries) {
    if (entry.isUnnecessary) continue; // Skip non-working day

    const targetDayType = entry.dayOfWeek || '平日';
    const p1 = params.mode === 'billing' ? 'billingPrice1' : 'paymentPrice1';
    const p2 = params.mode === 'billing' ? 'billingPrice2' : 'paymentPrice2';
    const p3 = params.mode === 'billing' ? 'billingPrice3' : 'paymentPrice3';
    const p4 = params.mode === 'billing' ? 'billingPrice4' : 'paymentPrice4';

    // 1. Get Master Prices using Fallback Sequence
    const basePriceRaw = getPriceValue(params.priceRows, targetDayType, p1);
    const overtimePriceRaw = getPriceValue(params.priceRows, targetDayType, p2);
    const nightPriceRaw = getPriceValue(params.priceRows, targetDayType, p3);
    const nightOtPriceRaw = getPriceValue(params.priceRows, targetDayType, p4);

    const isHourly = (getCalcType(params.priceRows, targetDayType) === 'hourly');
    const hourlyBase = isHourly ? basePriceRaw : (basePriceRaw / (stdWorkHours || 8));
    const hourlyNight = isHourly ? nightPriceRaw : (nightPriceRaw / (stdWorkHours || 8));
    const hourlyNightOt = isHourly ? nightOtPriceRaw : (nightOtPriceRaw / (stdWorkHours || 8));

    // 2. Base Amount Calculation
    let mBase = 0;
    const workHours = entry.workHours || 0;
    if (workHours > 0) {
      if (workHours < stdWorkHours) {
        mBase = workHours * hourlyBase; // Shortage deduction: switch to hourly
      } else {
        mBase = isHourly ? (workHours * hourlyBase) : basePriceRaw;
      }
    }

    // 3. Overtime & Night Calculation with Rounding Rules
    const excessHours = applyRounding(entry.excessHours || 0, otRoundingRule);
    const mOvertime = excessHours * overtimePriceRaw;
    const mNight = (entry.nightHours || 0) * hourlyNight;
    const mNightOt = applyRounding(entry.nightExcessHours || 0, otRoundingRule) * hourlyNightOt;

    // 4. Spot Price Override Priority
    const sBase = getSpotPrice(entry, params.mode, 'base');
    const sOt = getSpotPrice(entry, params.mode, 'ot');
    const sNight = getSpotPrice(entry, params.mode, 'night');
    const sNightOt = getSpotPrice(entry, params.mode, 'nightOt');

    const appBase = sBase > 0 ? sBase : mBase;
    const appOt = sOt > 0 ? sOt : mOvertime;
    const appNight = sNight > 0 ? sNight : mNight;
    const appNightOt = sNightOt > 0 ? sNightOt : mNightOt;

    const dailyRowAmount = appBase + appOt + appNight + appNightOt + (entry.otherAdditionAmount || 0);
    
    // Add Tasks & Expenses
    const taskTotal = (entry.tasks || []).reduce((acc, t) => acc + (t.amount || 0), 0);
    gross += dailyRowAmount + taskTotal;
    expenses += (entry.tollFee || 0) + (entry.parkingFee || 0) + (entry.transportFee || 0);
  }

  return {
    grossAmount: Math.round(gross),
    expenses: Math.round(expenses),
    totalAmount: Math.round(gross + expenses)
  };
}
```

---

## 5. API Endpoints & Transactional Matrix

| Route | Method | Payload / Queries | Transaction & Business Operation |
| :--- | :--- | :--- | :--- |
| `/api/clients` | GET, POST | `search`, `limit` | Auto-sort `clientNo` ASC. `POST` creates nested `vehicles[]`. |
| `/api/clients/[id]` | GET, PUT, DELETE | `id` | `PUT` replaces vehicles (`deleteMany` -> `create`). |
| `/api/partners` | GET, POST, PUT, DELETE | `id`, `search` | Unique `partnerNo`. Nested vehicle cascade. |
| `/api/project-templates` | GET, POST, PUT, DELETE | `search`, `clientId` | Manages base template configs. |
| `/api/projects` | GET, POST, PUT, DELETE | `search`, `clientId` | Auto-generates `projectNo` (`PRJ-0001`). Instantiation triggers front-end deep copy of template `PriceSet`/`PriceRow`. |
| `/api/price-sets` | GET, POST, PUT, DELETE | `projectId`, `templateId` | Auto-generates `priceSetNo` (`PS-YYYYMMDD-001`). Sorts rows by `DayTypeCategory` master order. Resolves text placeholders. |
| `/api/monthly-reports` | GET, POST | `projectId`, `periodStart` | `POST` uses upsert semantics (prevents duplicate `projectId`+period). Default status: `"入力中"`. |
| `/api/monthly-reports/[id]` | GET, PUT, DELETE | `entries[]`, `completedDates[]` | `PUT` executes delta update (delete missing entries, update/create present entries). Sets timestamp `approvalRequestedAt`/`approvedAt` on status change. Returns `403` if approved. |
| `/api/invoices` | GET, POST, PUT, DELETE | `clientId`, `status` | Auto-generates `invoiceNumber` (`INV-YYYYMMDD-001`). Sums up `calcBillingAmount` from entries. |
| `/api/payments` | GET, POST, PUT, DELETE | `paymentData`, `advanceIds`, `installmentIds` | **Transaction (`$transaction`)**: Creates `Payment`, updates `AdvancePayment` to `"精算済"`, deducts `InstallmentPayment` balance in FIFO order (`applicationDate` ASC) and updates status when balance <= 0. |
| `/api/advances` | GET, POST, PUT, DELETE | `partnerId`, `targetMonth` | Unique `[projectId, targetMonth, periodIndex]`. Amount = `workDays * unitPrice`. |
| `/api/installments` | GET, POST, PUT, DELETE | `partnerId` | Tracks balance for multi-month installment deductions. |
| `/api/transfers` | POST | `paymentIds[]` | Generates 120-byte fixed length Anser/ZENGIN file. Updates `Payment.paymentStatus = "支払済"`. |
| `/api/deposits` | GET, POST | `clientId`, `depositDate` | Matches deposit against `Invoice` (`matchStatus = "消込済"`). |
| `/api/master-import` | POST, PUT | `sessionId`, `file` | 4-step Excel parse & mapping session. |

---

## 6. Route Navigation Architecture

```
/ (Dashboard)
├── /clients
│   ├── /new
│   └── /[id]
├── /partners
│   ├── /new
│   └── /[id]
├── /project-templates
│   ├── /new
│   └── /[id]
├── /projects
│   ├── /new
│   └── /[id]
├── /price-sets
│   ├── /new
│   └── /[id]
├── /reports
│   ├── /[id]
│   └── /input?reportId=X
├── /invoices
│   ├── /new
│   └── /[id]
├── /payments
│   ├── /new
│   └── /[id]
├── /advances
│   ├── /new
│   └── /[id]
├── /installments
│   └── /[id]
├── /cash-management
├── /transfers
├── /deposits
│   └── /history
├── /analytics
├── /masters
│   ├── /system
│   ├── /overtime-categories
│   ├── /price-categories
│   ├── /sales-reps
│   └── /ui-builder
└── /master-import
    └── /[sessionId]
```

---

*LinksSys AI-Optimized System Specification - 2026-08-01*
