# IKPM Business Portal

Internal business portal for **Insect Killer Pest Management (IKPM)**, Pakistan ([insectkiller.pk](https://www.insectkiller.pk)): CRM, proposals, contracts/AMCs, dispatch, field service reports, provincial sales-tax invoicing, and a client document drive, all in one place.

```
Lead ─► Contact (Sales/CRO) ─► Meeting (Team Leader assigned) ─► Meeting Report
    ─► Profile / Proposal ─► Contract / AMC ─► Dispatch ─► Field visit
    ─► Supervisor-verified service report ─► Sales-tax invoice ─► Payment & WHT ─► Renewal
```

---

## Contents

1. [Tech stack](#tech-stack)
2. [Getting started](#getting-started)
3. [Scripts](#scripts)
4. [Project structure](#project-structure)
5. [Modules & routes](#modules--routes)
6. [Roles & access control](#roles--access-control)
7. [Key business rules](#key-business-rules)
8. [Files, documents & client outreach](#files-documents--client-outreach)
9. [Offline / PWA](#offline--pwa)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Maintenance scripts](#maintenance-scripts)
13. [Android build (Capacitor)](#android-build-capacitor)

---

## Tech stack

| Area | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router 7, Lucide icons |
| Styling | Plain CSS design system (`src/index.css`, `src/App.css`) |
| Data & auth | Firebase Authentication + Cloud Firestore (live sync, offline cache) |
| Files | Cloudinary (unsigned browser uploads) |
| PDFs | Client-side `jspdf` + `jspdf-autotable`, QR-verifiable via `/verify/:id` |
| Server functions | Vercel serverless (`api/`): WhatsApp Cloud API, Resend email, Cloudinary delete |
| Tooling | Vitest, oxlint, tsx |

---

## Getting started

### Prerequisites

- Node.js **20.19+ or 22.12+** (required by Vite 8)
- A Firebase project with Email/Password auth and Firestore enabled
- *(Optional)* A Cloudinary account for file uploads
- *(Optional)* Java 11+ to run the Firestore rules emulator tests

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in at least the `VITE_FIREBASE_*` values. Every variable is documented in [.env.example](.env.example):

| Group | Variables | Needed for |
|---|---|---|
| Firebase (required) | `VITE_FIREBASE_*` | Login and all data |
| Cloudinary | `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`, `VITE_CLOUDINARY_FOLDER` | Shareable file uploads |
| Branding | `VITE_COMPANY_*` | Sender identity in WhatsApp/email messages |
| Outreach API | `VITE_OUTREACH_API_URL` (`/api` on Vercel) | Automatic WhatsApp/email sending |
| First-admin setup | `VITE_SETUP_KEY` | Bootstrapping the first super admin |
| Server-only secrets | `FIREBASE_*`, `CLOUDINARY_API_*`, `WHATSAPP_*`, `RESEND_API_KEY`, `EMAIL_*` | `api/*` functions (Vercel only) |

> **Never** prefix server secrets with `VITE_`. Anything starting with `VITE_` is bundled into the browser.

### 3. Deploy Firestore rules and indexes (once per project)

Firestore stays locked until the rules are deployed, so nothing will save without this step.

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore --project <your-project-id>
```

### 4. Run

```bash
npm run dev          # http://localhost:5173
```

### 5. Create the first super admin

1. Set `VITE_SETUP_KEY` to a long random value in `.env.local` (and in Vercel for production).
2. Open `/setup-first-admin` and enter your email, password, name, and the setup key.
3. After that, Firestore marks the portal as initialized and the setup screen no longer works.
4. Add the rest of your staff from **Team & Access** (`/admin/team`).

> If `VITE_SETUP_KEY` is not set, the app falls back to a built-in default key (see `src/contexts/AuthContext.tsx`). Always set your own key before going live.

If you used the portal before cloud sync existed, use **Settings → Cloud database → Upload records** to move browser-only data into Firestore.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |
| `npm test` | Run the Vitest suite |
| `npm run test:security` | Run the standalone security verification script |
| `npm run test:rules` | Run Firestore rules tests against the emulator (needs Java) |
| `npm run backfill:folders` | File legacy records into the virtual folder tree (see [Maintenance scripts](#maintenance-scripts)) |
| `npm run typecheck:scripts` | Type-check the `scripts/` folder |

---

## Project structure

```
api/                      Vercel serverless functions (send-email, send-whatsapp, delete-file)
public/                   PWA manifest, service worker (sw.js), icons
scripts/                  Admin scripts run with tsx + firebase-admin (backfill, reset)
src/
  components/common/      Shared UI: Modal, ConfirmDialog, StatusBadge, Breadcrumbs, ...
  components/layout/      AppLayout, Sidebar, Header, ProtectedRoute
  config/env.ts           Typed access to VITE_* variables and integration flags
  contexts/               AuthContext, NotificationContext, SyncContext (offline queue)
  features/               Feature modules: documents, field, leads, onboarding,
                          outreach, proposals, schedule, settings, devices
  hooks/                  useDataStore (reactive store), usePdfAction
  lib/                    Business logic: permissions, leadWorkflow, workflow, folders,
                          visitSchedule, riskAssessment, pdfGenerator, taxRates, ...
  pages/                  One folder per routed screen
  services/               Firestore data access (dataService), outreach, staff, templates
  tests/                  Vitest suites
  types/                  Domain models (crm, customer, proposal, operations, finance, ...)
firestore.rules           Server-side enforcement of roles and data scopes
firestore.indexes.json    Composite indexes
```

Routes are lazy-loaded per page in [src/App.tsx](src/App.tsx), which keeps the first load small.

---

## Modules & routes

| Route | Module | Purpose |
|---|---|---|
| `/` | Dashboard | Role-specific work queues |
| `/customers` | Customers | Individuals (`CL-…`), companies (`CO-…`) and their branches (`BR-…`) |
| `/crm` | Leads | Pipeline, duplicate detection (phone / NTN / CNIC), Excel import |
| `/inspections` | Inspections | Site inspections, findings, photos, risk assessment |
| `/proposals` | Proposals | Proposal builder, service plans, revisions, discount approvals, PDF |
| `/contracts` | Contracts & AMCs | Recurring visit plans, renewals |
| `/operations/calendar` | Dispatch | Calendar with technician double-booking checks |
| `/operations/jobs` | Service jobs | Job list, supervisor QC verification |
| `/pco-field` | PCO field app | Mobile visit execution: chemical logs, device monitoring, signatures, photos |
| `/finance/invoices` | Invoices | Sales-tax invoices, receipts, credit notes |
| `/finance/tax-rules` | Tax | Provincial sales tax and WHT rules |
| `/files` | Client files | Drive-style explorer over the virtual folder tree |
| `/documents` | Company documents | IKPM papers (licences, NTN/SRB, MSDS, ...) and pitch packs |
| `/admin/team` | Team & Access | Staff, teams, roles |
| `/settings` | Settings | Company profile, templates, audit trail, cloud migration |
| `/verify/:id` | *(public)* | QR verification of issued documents |
| `/login`, `/setup-first-admin` | *(public)* | Authentication and bootstrap |

---

## Roles & access control

Roles are **data**, not code. Defaults live in [src/lib/permissions.ts](src/lib/permissions.ts). A super admin can edit them or create new ones in **Team & Access**, and they are stored in the Firestore `roles` collection. Each role gives every module a level of `none`, `view` or `edit`. Each staff member also has a **data scope**: `own`, `team` or `company`, which controls whose records they see.

The UI and `firestore.rules` read the same role documents, so access is enforced on the server as well as hidden in the UI.

| Default role | Default scope | Summary |
|---|---|---|
| Super Admin | company | Everything, including staff, teams and roles |
| Management | company | All operational modules, proposal approvals, templates |
| Sales / CRO | own | Customers, leads, inspections, proposals, contracts, client files. Assigns Team Leaders to meetings. |
| Team Leader | team | Conducts client meetings, assigns team members, records findings and submits meeting reports. Next step (proposal or company profile) is set from their report. |
| Operations | company | Dispatch, field visit jobs, inspections, client files |
| Finance | company | Invoices, tax rules; view customers, contracts, jobs |
| Auditor | company | Read-only across business modules |

Team members (field staff who accompany Team Leaders) are added under a team via **Team & Access** (`/admin/team`). They do not need their own portal login; the Team Leader manages the meeting and submits the report on behalf of the team.

Super admins can use **View as role** in the top bar to preview the portal as any role.

---

## Key business rules

### Customer hierarchy
- **Individual client** (`CL-YYYY-XXXX`): residential and private customers.
- **Company** (`CO-YYYY-XXXX`) → **Branches** (`BR-YYYY-XXXX`): the company holds the legal identity (NTN/STRN) and master contracts. Each branch has its own sites, jobs, contracts and invoices. A branch is always linked to its parent company and is never created as a standalone customer.

### Lead lifecycle ([src/lib/leadWorkflow.ts](src/lib/leadWorkflow.ts))
```
new ─► contacted ─► engaged ─► meeting_scheduled ─► meeting_done ─► profile_sent / proposal_sent ─► negotiation ─► won / lost
```
Step-by-step:
1. **New** — lead captured, not yet contacted.
2. **Contacted** — Sales / CRO made first contact; logged in activity log.
3. **Engaged** — client is interested. CRO aligns a **Team Leader** for the meeting.
4. **Meeting scheduled** — Team Leader (± team members) confirmed for client visit. Inspection can be conducted during the meeting.
5. **Meeting done** — Team Leader submits a meeting report: what the client asked for (company profile, proposal, more info, etc.).
6. **Profile sent / Proposal sent** — next step driven by the client request in the meeting report.
7. **Negotiation → Won / Lost** — standard closing flow.

- Contacted requires a logged contact (phone, WhatsApp or email).
- Meeting scheduling assigns a Team Leader (`assignedTeamLeaderId`) and a date.
- The meeting report captures `clientRequest` (company_profile / proposal / both / more_info) and `meetingReportNote`.
- A proposal can only be created after meeting findings are recorded. At that point the customer account is created or linked (`ensureLeadCustomer()`), and the lead's documents and outreach history move with it.
- Won converts the proposal to a contract and prompts sending the onboarding pack (SOP, MSDS, certificates, layout).

### Proposals
- Discounts above the approval threshold require management approval before the PDF can be issued.
- Revisions are new linked records. Earlier quotes are never overwritten.

### Scheduling ([src/lib/visitSchedule.ts](src/lib/visitSchedule.ts))
- Generates service and follow-up visits from the contract's service plan and frequency.
- Respects branch closing times and visit windows; after-hours visits go to the night shift.
- Skips Sundays and configured public holidays.
- Blocks technician double-booking.
- Exports the visit schedule as a PDF into the client's `Documents` folder.

### Finance
- An invoice cannot be generated until its service report has supervisor QC sign-off.
- Sales tax is charged by province from the editable `tax_rules` collection (defaults: SRB, PRA, ICT, KPRA, BRA).
- Customer WHT (Section 153 certificates) is an **asset**. Supplier WHT is a **liability**. The two are never netted.
- Posted invoices are immutable. Corrections go through credit notes.
- Contracts within 60 days of expiry show a renewal alert. **Renew** clones the contract and creates a linked renewal proposal.

---

## Files, documents & client outreach

### Virtual folder tree ([src/lib/folders.ts](src/lib/folders.ts))
Firestore stays flat. Each record carries a `folderPath`, and the **Client files** explorer presents the records as folders:

```
/Clients/{Name}__{clientId}/
   Profile/  Leads & Inspections/  Proposals/  Contracts/  Documents/
   Service Reports/{YYYY}/{MM}/  Monitoring Sheets/  Invoices/{YYYY}/  Payments/
   Branches/{Branch}__{branchId}/{Subfolder}/

/Company (IKPM)/
   Profile & Registrations/  SOP Templates/  MSDS Library/  Technician Certificates/
   Proposal & Report Templates/  Tax Rules/  Internal/
```

Generated PDFs are filed automatically: verified service reports, posted invoices, payment receipts and visit schedules.

### Cloudinary setup
1. Cloudinary Console → *Settings → Upload → Add upload preset* → **Signing mode: Unsigned**.
2. *Settings → Security* → enable **Allow delivery of PDF and ZIP files** (off by default on free plans; without it, shared PDF links return 401).
3. Set `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET`.

Without Cloudinary, the portal still runs: files up to 750 KB are kept on the device only and cannot be shared as links.

### Sending documents (WhatsApp / email)
From a lead, proposal or customer, **Send Docs** lets the user pick a pitch pack or individual documents, edit the message, and send it. Every send is logged on the record. Sending moves a `new` lead to `contacted` and marks a proposal as sent.

| Mode | Setup | Behaviour |
|---|---|---|
| Link (default) | None | Opens `wa.me` or the user's mail app with the message and links filled in; the user presses Send |
| Automatic | Deploy on Vercel, set `VITE_OUTREACH_API_URL=/api` and the server secrets | `api/send-whatsapp.ts` sends real WhatsApp attachments; `api/send-email.ts` sends email through Resend from the staff member's business address. Falls back to link mode on error |

The API checks the caller's Firebase session and only accepts attachments hosted in your Cloudinary account. WhatsApp only allows free-form messages within 24 h of the client's last message. For first contact, set `WHATSAPP_TEMPLATE_NAME` to an approved template.

---

## Offline / PWA

- **Service worker** (`public/sw.js`) caches the app shell so the portal opens offline.
- **Offline queue** (`src/lib/offlineStorage.ts` + `src/contexts/SyncContext.tsx`) stores field drafts and notes locally and syncs them when the device reconnects.
- Invoice posting, payment reconciliation and discount approvals require an online connection.

---

## Testing

```bash
npm test                 # all Vitest suites in src/tests
npm run test:security    # security verification script
npm run test:rules       # firestore.rules against the local emulator (needs Java)
```

Coverage includes the lead workflow, folder filing and backfill, onboarding, proposal plans, risk assessment, visit scheduling, devices, and Firestore rules: branch isolation, privilege escalation, invoice immutability, and deactivated users.

---

## Deployment

### Vercel (frontend + API)
1. Import the repo into Vercel. The framework preset is Vite and the output folder is `dist`.
2. Add the `VITE_*` variables **and** any server-only secrets under *Project Settings → Environment Variables*.
3. Deploy:
   ```bash
   npx vercel deploy --prod
   ```
`vercel.json` rewrites every non-`/api` path to `index.html` so client-side routes work.

### Firestore
Redeploy whenever `firestore.rules` or `firestore.indexes.json` changes:
```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <your-project-id>
```

---

## Maintenance scripts

Both scripts need a Firebase service-account key. Keep it out of git.

**Backfill folders.** Files records created before folder support:
```bash
npx tsx scripts/backfillFolders.ts --seed                                  # try on sample data
npx tsx scripts/backfillFolders.ts --key=./service-account.json            # dry run, report in scripts/reports/
npx tsx scripts/backfillFolders.ts --key=./service-account.json --apply --by=admin@insectkiller.pk
```
The script is idempotent: records that are already filed are skipped.

**Reset data.** Wipes Firestore data but keeps staff logins:
```bash
npx tsx scripts/resetData.ts --key=./service-account.json            # dry run
npx tsx scripts/resetData.ts --key=./service-account.json --apply    # backs up to ./backups, then deletes
```
The reset keeps `users` and the initialization flag. Use `--keep=a,b` to keep other collections. Cloudinary files are not deleted.

---

## Android build (Capacitor)

`capacitor.config.json` is set up for app ID `pk.insectkiller.portal`. You need Android Studio, JDK 17 or 21, and Node 20+.

```bash
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio, go to **Build → Generate Signed Bundle / APK**, pick **APK** and your release keystore, then build the **Release** variant.
