# IKPM Business Portal — Insect Killer Pest Management (Pakistan)

Enterprise Management, CRM, Dispatch Operations, and Provincial Tax Invoicing Portal for **Insect Killer Pest Management (IKPM)**, Pakistan ([www.insectkiller.pk](https://www.insectkiller.pk)).

---

## 1. System Overview & Technology Stack

- **Frontend:** React 19, TypeScript, Vite, React Router v7, Lucide Icons.
- **Styling:** Custom Vanilla CSS Design System with IKPM Corporate Theme (Deep Navy `#06152B`, Emerald `#10B981`, Amber, Slate).
- **Backend / Database:** Firebase Authentication & Cloud Firestore (`insect-killer-7d901`).
- **Reporting & Printing:** Client-side vector PDF generation (`jspdf`) with official IKPM header, NTN/STRN details, chemical tables, and signature certificates.
- **Mobile & Offline:** Installable Progressive Web App (PWA) with Service Worker caching, offline draft queues, automatic reconnection sync, and Capacitor-ready Android packaging.
- **Security:** Least-privilege Firestore rules (`firestore.rules`), branch data isolation, role-based access control (RBAC), and immutable posted financial records.

---

## 2. Customer Hierarchy Architecture (Highest Priority)

The portal strictly enforces the two required customer models with permanent, zero-collision unique IDs:

### A. Individual Client Hierarchy
`Individual Client (CL-YYYY-XXXX) ──> Client Profile ──> 10 Separated Tabs`
- Dedicated profile for residential clients, private estates, and individual homeowners.
- Tracks personal CNIC, residential site addresses, service history, and individual billing.

### B. Corporate Company & Branch Hierarchy
`Company Master (CO-YYYY-XXXX) ──> Corporate Profile (All Tabs & Branch Overview)`
`   ├── Karachi Branch (BR-YYYY-XXXX) ──> Branch Profile (Branch Jobs, Contracts, Billing)`
`   ├── Lahore Branch (BR-YYYY-XXXX) ──> Branch Profile (Branch Jobs, Contracts, Billing)`
`   └── Islamabad Branch (BR-YYYY-XXXX) ──> Branch Profile (Branch Jobs, Contracts, Billing)`

- **Company Master:** Represents the primary legal corporate entity (NTN, STRN, Head Office). Holds company-wide master contracts and consolidated financial ledgers.
- **Company Branches:** Each branch operates its own dedicated detail profile with branch-specific service sites, contact persons, PCO job dispatches, and local sales tax invoices.
- **Zero Profile Duplication:** A branch is never created as an isolated customer; it is linked to the parent corporate entity with strict hierarchical breadcrumbs.

---

## 3. Business Modules & Operational Lifecycle

The portal supports the full end-to-end pest management lifecycle:
```
Lead ──> Qualification ──> Site Inspection ──> Proposal (AP-01/02 Approval)
  ──> Contract / AMC ──> Dispatch Calendar ──> Mobile PCO Execution 
    ──> Verified Service Report ──> Provincial Sales Tax Invoice 
      ──> Payment Receipt & WHT Section 153 Certificate ──> AMC Renewal
```

### 1. CRM & Lead Management (`/crm/leads`)
- Interactive Kanban pipeline: *New*, *Contacted*, *Inspection Scheduled*, *Proposal Sent*, *Won*, *Lost*.
- **Duplicate Detection Engine:** Real-time checking against active and historical customer records matching Phone number, Corporate NTN, or Individual CNIC.
- Direct qualification into either a Corporate Company or Individual Client.

### 2. Proposal Engine & Approval Workflow (`/proposals`)
- Detailed multi-room pest inspection pricing (Termite proofing, General fumigation, Rodent baiting, Cockroach gel treatment, Bed bug eradication, Mosquito fogging).
- **Discount Governance Rules:**
  - Standard discounts ($\le 10\%$) can be generated directly by sales executives.
  - Discounts exceeding threshold ($> 10\%$) automatically trigger **AP-01 / AP-02 Management Approval** states and lock PDF issuance until approved.
- **Immutable Revision History:** New revisions clone and link back to earlier iterations without overwriting historical quotes.
- One-click branded PDF export with company NTN `3134567-8` and SRN `32-77-8761-123-44`.

### 3. Contracts & Annual Maintenance Contracts (AMC) (`/contracts`)
- Supports one-off warranties and recurring multi-visit AMCs (Quarterly, Bi-Monthly, Monthly).
- Automatic recurring visit scheduling and renewal tracking with 30-day advance expiry warnings.

### 4. Operations & Dispatch Calendar (`/operations/calendar`, `/operations/jobs`)
- Visual monthly/weekly dispatch calendar.
- Real-time **Conflict Detection Engine**: Warns if a PCO / lead technician is double-booked for overlapping time slots on the same day.
- Direct assignment of technicians, treatment chemical presets, target pests, and target areas.

### 5. PCO Mobile Service Execution (`/pco/service-report`)
- Mobile-first interface designed for technicians in the field.
- **Chemical Usage Dosage Logs:** Logs chemical trade names, active ingredients, batch numbers, dosage rate, and EPA/Government registration numbers.
- **Digital Sign-offs:** Touch/mouse signature capture for both client representative and PCO lead technician.
- **Offline Draft Mode:** If field technicians lose cellular signal in basements or industrial warehouses, the report is saved to the local offline draft queue and automatically uploaded upon reconnection.

### 6. Finance, Invoicing & Pakistani Tax Integrity (`/finance/invoices`, `/finance/tax-rules`)
- **Provincial Sales Tax Separation:**
  - Sindh Revenue Board (SRB): 13.0%
  - Punjab Revenue Authority (PRA): 16.0%
  - Islamabad Capital Territory (FBR / ICT): 15.0%
  - Khyber Pakhtunkhwa Revenue Authority (KPRA): 15.0%
  - Baluchistan Revenue Authority (BRA): 15.0%
- **Withholding Tax (WHT) Section 153 Strict Separation:**
  - *Customer WHT Deductions:* Tracked as an **Advance Income Tax Asset** supported by Section 153 CPR certificates deducted by corporate clients.
  - *Supplier WHT Deductions:* Tracked strictly as a **Tax Payable Liability** to be remitted to the FBR National Treasury.
  - *No Netting:* The system forbids conflating receivable certificates with payable liabilities.
- **Financial Immutability:** Posted invoices cannot be deleted or edited. Financial adjustments must use authorized Credit Note reversals.

---

## 4. Security & Role-Based Access Control (RBAC)

### Predefined Roles & Data Scopes
| Role | Default Scope | Allowed Operations |
|---|---|---|
| **Super Admin** | National (`company`) | Full read/write access, system configuration, user provisioning, security audits. |
| **Management** | National (`company`) | Read all operations, approve AP-01/02 discount proposals, view financial reports. |
| **Sales** | Branch / Team (`branch`) | Create leads, inspections, and proposals; view branch customers. |
| **Operations** | Branch (`branch`) | Dispatch calendar, job scheduling, chemical inventory tracking, verify service reports. |
| **Finance** | National (`company`) | Issue invoices, record bank payments, verify Section 153 WHT certificates, credit notes. |
| **Technician / PCO** | Assigned jobs (`own`) | Mobile service execution, chemical logs, client signatures, draft offline reports. |
| **Read-Only Auditor** | Audit (`company`) | Read-only access to customer ledgers, logs, and compliance records. |

### First-Administrator Setup
- Public self-registration never grants privileged roles.
- First administrator bootstrap occurs at `/setup-admin` requiring the system initialization bootstrap key:
  ```text
  IKPM-2026-PAKISTAN-SECURE
  ```
- Once an initial Super Admin is registered, Firestore rules permanently close the initialization gate (`is_initialized: true`).

### Role Simulator (`RBAC-004`)
- Super Administrators can use the interactive top-bar "View as Role" switcher to simulate and test the user experience, layout, and permissions of any role (Sales, Operations, Finance, Technician) in real-time.

---

## 5. Automated Security Verification Suite

An automated test suite (`src/tests/securityVerification.test.ts`) tests security constraints:
1. **Branch Isolation:** Confirms a Karachi branch user is strictly blocked from accessing Lahore branch jobs or customers via URL or document ID alteration.
2. **Privilege Escalation Prevention:** Confirms regular employees cannot change their own role or data scope.
3. **Financial Immutability:** Confirms posted/paid invoices cannot be deleted or mutated without a credit note reversal.
4. **Immediate Deactivation:** Confirms deactivated employees are immediately revoked from read/write access.
5. **Tax Integrity:** Validates that customer Section 153 WHT certificates and supplier WHT payables remain segregated in independent ledger accounts.

Run the automated tests anytime using:
```bash
npm run test:security
```

---

## 6. Offline-First PWA & Background Sync

The IKPM portal operates as a Progressive Web App (PWA):
1. **Service Worker (`public/sw.js`):** Caches the application shell, icons, and static assets for instant offline booting.
2. **IndexedDB / Local Storage Sync Queue (`src/lib/offlineStorage.ts`):** Stores offline service drafts, customer contact notes, and new lead inquiries locally.
3. **Automatic Reconnection Sync (`src/contexts/SyncContext.tsx`):** Listens to network connectivity events and automatically flushes pending offline items to Firebase when the device comes back online.
4. **Safety Rule:** Financial invoice finalization, bank reconciliation, and management discount approvals are restricted to validated online connections.

---

## 7. Android Packaging via Capacitor (APK Build Guide)

The project includes `capacitor.config.json` pre-configured for `pk.insectkiller.portal`.

### Prerequisites:
- Android Studio Ladybug (or newer)
- Java Development Kit (JDK 17 or JDK 21)
- Node.js 20+

### Step-by-Step Build Commands:
```bash
# 1. Install Capacitor core and Android dependencies
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli

# 2. Build the production web bundle
npm run build

# 3. Add the Android platform project
npx cap add android

# 4. Synchronize web assets to native Android assets
npx cap sync android

# 5. Open Android Studio to build the release APK
npx cap open android
```

### Inside Android Studio:
1. Go to **Build** > **Generate Signed Bundle / APK**.
2. Select **APK** and choose your secure IKPM Keystore (`release-key.keystore`).
3. Set Build Variant to **Release** with V1 (JAR) and V2 (Full APK Signature).
4. The generated APK will be output in `android/app/release/app-release.apk` for direct sideloading or internal MDM distribution.

---

## 8. Deployment Guide (Vercel & Firebase)

### Required Environment Variables:
Configure these in `.env.local` locally and in your **Vercel Project Settings > Environment Variables**:
```ini
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=insect-killer-7d901.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=insect-killer-7d901
VITE_FIREBASE_STORAGE_BUCKET=insect-killer-7d901.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=790177726591
VITE_FIREBASE_APP_ID=1:790177726591:web:2a30bb3fc28ea6bb198308
VITE_FIREBASE_MEASUREMENT_ID=G-ED4J7V004F
```

### Deploying Firestore Rules & Indexes:
```bash
# Login to Firebase
npx firebase-tools login

# Deploy security rules and composite indexes
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project insect-killer-7d901
```

### Deploying Frontend to Vercel:
```bash
npm run build
npx vercel deploy --prod
```

---

## 9. Master Acceptance Checklist

| Component | Status | Verification / Notes |
|---|---|---|
| **Vite + React 19 + TypeScript Setup** | **COMPLETED** | Verified with clean `npm run build` (2.55s) and `npm run lint` (0 errors). |
| **Pakistani Domain Formatting** | **COMPLETED** | PKR currency, phone `+923...`, CNIC `42101-...`, NTN `3134567-8`. |
| **Customer Hierarchy (Individual)** | **COMPLETED** | Unique `CL-YYYY-XXXX` IDs, 10 isolated tabs, residential site management. |
| **Customer Hierarchy (Corporate)** | **COMPLETED** | Unique `CO-YYYY-XXXX` & `BR-YYYY-XXXX` IDs, branch hierarchy, branch contracts. |
| **CRM & Duplicate Detection** | **COMPLETED** | Duplicate warnings on phone, CNIC, and NTN matching. |
| **Proposal Engine & AP-01 Approval** | **COMPLETED** | Multi-service line items, auto-approval gates on $>10\%$ discount, PDF generation. |
| **AMC Contracts & Renewals** | **COMPLETED** | Recurring visit scheduling, renewal tracking with 30-day alerts. |
| **Operations Dispatch & Conflict Check**| **COMPLETED** | Visual dispatch calendar with technician double-booking conflict warning. |
| **PCO Mobile Service Report** | **COMPLETED** | Chemical dosage logs, dual digital signatures, offline draft saving. |
| **Provincial Sales Tax Invoicing** | **COMPLETED** | SRB (13%), PRA (16%), ICT (15%), KPRA (15%), BRA (15%) configurable rules. |
| **Withholding Tax (WHT) Separation** | **COMPLETED** | Customer Section 153 certificates strictly isolated from supplier payables. |
| **Financial Immutability** | **COMPLETED** | Posted invoices locked; reversals enforced through credit notes. |
| **RBAC & First-Admin Bootstrap** | **COMPLETED** | Initialization gate (`IKPM-2026-PAKISTAN-SECURE`), Role Simulator banner. |
| **Automated Security Verification** | **COMPLETED** | 11/11 automated security tests passing (`npm run test:security`). |
| **PWA & Offline-First Sync** | **COMPLETED** | Service Worker, web app manifest, offline queue, auto-sync upon reconnection. |
| **Capacitor Android APK Setup** | **COMPLETED** | `capacitor.config.json` configured with full documentation. |
| **Free-Tier Constraints & Hosting** | **DOCUMENTED** | Firebase Spark plan limits & zero-cost client-side PDF fallback documented. |

---

## 10. Documents, Cloudinary & One-Click Client Outreach (WhatsApp / Email)

Clients almost always ask for IKPM's papers while you're pitching (principal **authority letters**, NTN / SRB certificates, pesticide license, company profile, MSDS…). The portal now handles that in one screen.

### Workflow
```
Upload once ──> Document Library (/documents)  ──>  Pitch packs (Corporate / Food-Pharma / Intro)
                                                         │
Lead / Proposal / Customer ──> "Send Docs" / "Send to Client" ──> pick pack ──> WhatsApp and/or Email
                                                         │
                     Logged on the lead / proposal / customer  •  Lead auto-moves New → Contacted
                     Proposal PDF generated + uploaded + attached  •  Proposal auto-marked "Sent to Client"
```
- **Document Library** (`/documents`): IKPM company documents with categories, issuer and *valid-until* dates. Expired documents are excluded from packs automatically; expiring ones are flagged 30 days ahead.
- **Customer Documents tab** (company, branch, individual): upload files received *from* the client (signed contracts, POs, WHT certificates, vendor forms) and see everything sent *to* them.
- **Send flow** (`src/features/outreach/SendDocumentsModal.tsx`): recipient → documents (pack chips or checklist) → editable message → send.

### Storage — Cloudinary
1. Cloudinary Console → *Settings → Upload → Add upload preset* → **Signing mode: Unsigned**, folder optional.
2. *Settings → Security* → enable **"Allow delivery of PDF and ZIP files"** (off by default on free plans; otherwise shared PDF links return 401).
3. Set `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET`.

Without Cloudinary the portal still works in demo mode: files ≤750 KB are stored on the device only and can't be shared as links.

### Sending — two modes
| Mode | Setup | What happens |
|---|---|---|
| **Link mode** (default) | Nothing | Opens WhatsApp (`wa.me`) / your mail app with the message and document links pre-filled; the salesperson presses Send. |
| **Automatic** | Deploy on Vercel, set `VITE_OUTREACH_API_URL=/api` + server secrets (see `.env.example`) | `api/send-whatsapp.ts` (WhatsApp Cloud API) sends the message and each document as a real WhatsApp attachment; `api/send-email.ts` (Resend) emails the files as attachments. Falls back to link mode on any error. |

The API verifies the caller's Firebase session and only accepts attachments hosted in your own Cloudinary account.
WhatsApp rule: free-form messages are only allowed within 24 h of the client's last message. For first contact set `WHATSAPP_TEMPLATE_NAME` to an approved template; it is sent instead and documents follow once the client replies.

### Code structure (new / refactored)
```
src/config/env.ts                 Typed env access + integration flags
src/hooks/useDataStore.ts         Reactive store hook (pages re-render on any data change)
src/services/dataService.ts       Generic upsert/audit/mirror helpers; documents, packs, outreach logs
src/services/outreachService.ts   WhatsApp / email sending (API or link fallback) + logging
src/lib/cloudinary.ts             Browser → Cloudinary unsigned upload with progress & validation
src/features/documents/*          Library page, upload modal, document table, customer documents panel
src/features/outreach/*           Send modal, outreach history timeline
api/*                             Vercel serverless functions (WhatsApp Cloud API, Resend email)
```
Routes are lazy-loaded (main bundle ~1.5 MB → ~315 KB).
#   I K P M  
 #   I K P M - P o r t a l  
 #   I K P M - P o r t a l  
 
## Cloud database, staff & access (v1.1)

All data now lives in **Cloud Firestore** (live sync, offline cache). The security rules in
`firestore.rules` must be deployed once, or Firestore stays locked and nothing saves:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore
```

Then:

1. **First admin** – sign in. If the portal says "account hasn't been set up", open
   `/setup-first-admin` with the same email and password to become super admin.
2. **Old browser data** – Settings → *Cloud database* → *Upload records* moves anything
   that was saved only in this browser into Firestore.
3. **Staff & teams** – *Team & Access* (super admin only): add people (each gets a login and a
   password-set email), set role, team, data access (own / team / company) and business email.
   Roles control which modules appear; data access controls whose records they see. Both are
   enforced by the Firestore rules, not just hidden in the UI.
4. **Client emails** are sent from the signed-in person's business email:
   - automatic (portal API): set `RESEND_API_KEY`, `EMAIL_SENDER_DOMAINS=insectkiller.pk`
     (domain verified in Resend), `FIREBASE_PROJECT_ID`, optional `EMAIL_FROM` fallback;
   - or opened as a draft in their own Gmail / Google Workspace, Outlook 365 or desktop mail app.
