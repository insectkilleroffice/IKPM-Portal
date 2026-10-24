# IKPM Portal v2: Simple Rebuild From Scratch (Claude Code Prompt)

Paste everything below into Claude Code in a **new empty folder**. The old project is for reference only.

---

## 0. Your job

Build a **new, simple** business portal for **Insect Killer Pest Management (IKPM)**, a pest control company in Pakistan.

The old portal is at `C:\Users\Rashid\Desktop\New folder (3)\IKPM-Portal`. It works but it is far too complicated. **Do not copy its architecture, its tax engine or its many modules.** Read it only for these things:

- the PDF look (`src/lib/pdfGenerator.ts`: letterhead, title band, tables, totals, stamp, footer, QR)
- the company profile fields (`src/services/companyProfile.ts`)
- the wording of terms and invoice notes

**Everything else is simplified.** If a feature is not in this document, do not build it. Ask me first.

### Golden rules

1. **Few screens, few clicks.** A staff member should learn each portal in 5 minutes.
2. **Everything is manual and typed in:** services, prices, discount, tax. There is no tax engine, no tax-rule tables, no province logic, no price catalogue.
3. **One linear flow** (section 3). Each record has one status and one clear next button.
4. **Plain business language.** No jargon such as "QC verification" or "WHT sections". Use "Verified", "Paid", "Pending".
5. **Every PDF is created in one click** and **saved automatically on the client's record**. Staff never upload or file anything by hand.
6. **Mobile friendly.** Operations managers and CRO use phones.

---

## 1. Tech stack (same as the old project, so the PDFs carry over)

- React + TypeScript + Vite + React Router
- Firebase Authentication + Firestore
- `jspdf` + `jspdf-autotable` for PDFs, and `qrcode` for the verify QR
- Plain CSS. Navy `#0B1F3A` and green `#0E8A5F` by default, editable in Settings.
- Firestore security rules per role (deployable from day one)
- Currency is PKR. Dates are `DD MMM YYYY`. Keep `amountInWords()` for Pakistani rupees.

---

## 2. Five portals (roles)

One login page. After login each user sees only their own portal and sidebar. Roles are fixed; there is **no role editor**.

| Portal | Who | What they do |
|---|---|---|
| **Admin** | Owner / super admin | Everything. Creates users. Edits the company profile (letterhead, bank details, stamp, logo, terms). Sees all reports. |
| **Manager** | Approvals | Approves proposals that carry a discount and approves contracts before they go to the client. Sees dashboards and reports (read-only). Can reassign work. |
| **CRO** | Sales | Leads, clients, meeting requests, proposals, contracts, complaints from clients. |
| **Operations Manager** | There are several. Each has **their own team**. | Receives meeting and job assignments, picks which team member goes, schedules visits, submits and verifies service reports. |
| **Finance** | Accounts | Invoices, payments, receipts, outstanding balances, finance reports. |

### Operations teams (details only, no logins)

- Each Operations Manager has a team list. Each team member has: name, phone, role (e.g. technician or supervisor), active yes/no.
- Team members **do not log in**. The Operations Manager records everything on their behalf.
- Admin creates the Operations Managers and their teams. An OM can also add or edit their own team members.

---

## 3. The one workflow

```
LEAD ─► CONTACTED ─► MEETING REQUESTED ─► MEETING ASSIGNED ─► MEETING DONE
   ─► PROPOSAL ─► (Manager approval, only if discount) ─► SENT ─► ACCEPTED
   ─► CONTRACT ─► SIGNED ─► OPERATIONS MANAGER ASSIGNED
   ─► MONTHLY VISITS SCHEDULED ─► SERVICE REPORT SUBMITTED ─► VERIFIED
   ─► INVOICE (when the billing date comes) ─► PAYMENT RECORDED ─► RECEIPT
```

### Step by step, with who does what

1. **Lead (CRO).** Name, phone, type (Individual or Company), city, source, notes. The CRO logs each contact (call / WhatsApp / email) with a note. Duplicate phone numbers are warned, not blocked.

2. **Meeting request (CRO).** The CRO picks a date and time, a place and the purpose. The request goes to the **Operations Manager** (the CRO chooses which OM, or leaves it to the Manager).

3. **Meeting assignment (Operations Manager).** The OM sees "Meetings to assign" on their home screen. They open it, **pick which team member is going** (one or more, from their own team list) and tap **Confirm**. The CRO and Manager are notified, and the CRO sees "Meeting: Ali (Team A), 3 pm, Tuesday".

4. **Meeting report (the assigned OM or team member, entered by the OM).** Short form: what was found, pests, site area, what the client wants (profile / proposal / more info), photos optional, and next step. Marking it done tells the CRO "Ready for proposal".

5. **Proposal (CRO).** Create from the meeting. Fields are all manual:
   - Client (new or existing).
   - **Service lines.** Add as many as needed: description, quantity, rate. The line amount is calculated.
   - **Discount:** either an amount or a percent, typed in.
   - **Tax:** a checkbox "Add tax", then type the tax **percent** or **amount**. Default is off (0).
   - Payment terms (days), validity, and terms and conditions. These default from the company profile and are editable.
   - Total is calculated automatically: `Subtotal − Discount + Tax`.
   - **If there is a discount above the Manager's limit (a single Settings value, default 10%), status becomes "Waiting for Manager"** and the PDF cannot be issued until approved. Otherwise it goes straight to ready.
   - Output: Proposal PDF, plus "Send via WhatsApp / email" using a prefilled `wa.me` link or `mailto` link (no paid API needed).
   - Revisions create a new version (v2, v3). Old ones are kept.

6. **Contract (CRO).** One click "Create contract" from an accepted proposal, which copies the lines. Contract fields:
   - Type: **Monthly contract** (recurring) or **One-time job**.
   - Start date, end date (or number of months).
   - **Monthly amount** (manual, copied from the proposal and editable).
   - **Billing day of the month** (for example the 1st or the 5th) and payment terms in days.
   - Visits per month (a number, e.g. 2 service + 1 follow-up).
   - Service scope, sites and addresses (one or many), terms.
   - Tax: same manual tax setting as the proposal (checkbox + percent or amount). **Contracts for clients without tax simply have tax off.**
   - Manager approves if needed, then Contract PDF is generated with a signature and stamp block.
   - CRO uploads the signed copy (or marks "Signed on <date>"). The status becomes **Active**.
   - Renewal: 30 days before the end date a "Renew" badge appears. Renew copies the contract into a new one.

7. **Assign to Operations Manager (CRO or Manager).** After signing, pick the OM who will run this contract. The OM sees it under "My contracts".

8. **Visit scheduling (Operations Manager).**
   - The system proposes **monthly visit dates** from the start date and visits-per-month. It skips Sundays. The OM can change any date.
   - For each visit the OM picks the **team member(s)** and a time slot.
   - Simple calendar and list views, with a warning if the same person is booked twice at the same time.
   - Client complaints (logged by the CRO) become an extra visit assigned to the OM.

9. **Service report (Operations Manager).** For each visit: date, who attended, work done, chemicals used (free text, name and quantity), before and after photos (optional), client name and signature (optional), notes. Submit it. The **OM or Manager then taps "Verify"**. A verified report produces the **Service Report PDF**, auto-saved to the client.
   - Invoices can only be created from verified work.

10. **Invoice (Finance).**
    - **Monthly contracts:** on the contract's billing day each month, the system shows "Invoices due to generate" on the Finance home screen. Finance clicks **Generate invoice**. It prefills the month, the contract lines, the monthly amount, discount and tax from the contract, and the due date. Finance can still edit every number before saving.
    - **One-time jobs:** "Create invoice" after the job is verified.
    - **Manual invoice:** also allowed (any client, any lines) for odd cases.
    - Invoice numbers are `INV-YYYY-0001` in sequence.
    - Status: `Unpaid → Partly paid → Paid`, plus `Cancelled`. Posted invoices cannot be edited. To fix a mistake, cancel it and create a new one (optionally a "Cancelled" watermark).
    - Output: Invoice PDF, plus send via WhatsApp / email links.

11. **Payment (Finance).** On an invoice click **Record payment**:
    - Amount, date, **mode: Cash or Bank transfer** (also Cheque, if you add it as a third option), reference number or bank name (optional for cash), and notes.
    - Part payments are allowed, and the balance is updated automatically.
    - Optional field **"Tax deducted by client"** (manual amount) for clients who deduct tax at payment time. If left empty, it is ignored.
    - It creates a **Payment Receipt** (`RCT-YYYY-0001`) with a PDF.
    - When the balance reaches 0, the status is Paid and the PDF shows a PAID watermark.

---

## 4. Special client cases (must work)

| Case | Behaviour |
|---|---|
| **Client does not take tax** | Tax is off on the proposal, contract and invoice. The PDF title is "Invoice", with no tax columns or tax line. |
| **Client pays by cash** | Payment mode is Cash. A cash receipt PDF is created. No bank details are required. |
| **Client takes tax** | Tax is on, with a manual percent or amount. The PDF title becomes "Sales Tax Invoice" and shows "Value excl. tax / Tax / Total incl. tax" columns, plus the client's NTN and STRN if entered. |
| **Individual client** | Name, CNIC (optional), phone, address and a single site. No branches. Invoices are simple. |
| **Company client** | Company name, NTN and STRN (optional), contact persons, **optional branches/sites** (each with name, address, contact). Contracts and invoices can be per company or per branch. |
| **Discount** | Always typed in manually (amount or percent). It shows as its own line on PDFs. |
| **Mixed** | The same client may have tax on one contract and off on another. The setting lives on the contract and invoice, **not on the client**. A client record only stores a note such as "Cash client, no tax". |

Do **not** build: province tax rules, a tax rate table, WHT certificate tracking, supplier bills or a ledger, credit notes, chart of accounts, or bank reconciliation.

---

## 5. PDFs: same style as the old project

Reuse the layout from the old `src/lib/pdfGenerator.ts`. Build **one small PDF helper** (header, title band, parties, table, totals, note box, stamp, footer). Every document uses it, so all PDFs look identical.

**Page design (A4):**
- **Letterhead:** logo on the left. On the right: legal name, tagline in capitals, and address, phone, email and website. Company NTN and STRN are shown only if filled in the profile.
- **Title band:** document title in capitals (PROPOSAL, CONTRACT, INVOICE or SALES TAX INVOICE, PAYMENT RECEIPT, SERVICE REPORT) on the left. On the right, a small box with number, date, due date and status.
- **Two party boxes:** "Bill to" / "Client" (name, address, phone, NTN/STRN if any) and "Service reference" (site, contract no., period).
- **Details table:** `# | Description | Qty | Rate | Amount`. When tax is on, add `Tax % | Tax | Amount incl. tax`.
- **Totals box (right side):** Subtotal, Discount, Tax (only if >0), Total, Received, Balance due. The grand total is highlighted in the brand colour.
- **Amount in words** (PKR) under the totals.
- **Payment details box:** account title, bank, account number, IBAN, and the invoice note. Taken from the company profile.
- **Stamp block** at the end (the company stamp image if uploaded) and, for contracts, a client signature line.
- **Footer on every page:** company name and contacts, "computer-generated document", "Page x of y", generated date, and the **verify QR** (public `/verify/:id` page shows the document number, client, amount and status).
- **Watermarks:** DRAFT, PAID, CANCELLED.
- **File name:** `YYYY-MM-DD_Invoice_INV-2026-0012_ClientName.pdf`.

**Documents to produce:** Proposal, Contract, Invoice, Payment Receipt, Service Report, Visit Schedule (month list), Client Statement (all invoices and payments of one client, with the balance), and Finance reports (below).

**Saving:** the moment a PDF is generated it is stored in the client's file list under: `Proposals / Contracts / Invoices / Receipts / Service Reports`. The client page shows these in one tab called **Files**. There is no folder tree or drive explorer.

---

## 6. Screens per portal (keep it this small)

**Everyone:** Login, Home (work queues), profile and logout.

**CRO:** Home (my follow-ups today, meetings, proposals waiting) · Leads · Clients · Meetings · Proposals · Contracts · Complaints.

**Operations Manager:** Home (Meetings to assign, Visits today, Reports to submit) · My team · Meetings · My contracts · Visit calendar and list · Service reports · Complaints.

**Manager:** Home (approvals waiting, overdue visits, overdue invoices) · Approvals (proposals and contracts) · Everything read-only plus Reports.

**Finance:** Home (Invoices due to generate, Unpaid, Overdue, Collected this month) · Invoices · Payments and receipts · Client statements · Reports.

**Admin:** All of the above plus Users and teams · Company profile and Settings (letterhead, bank details, stamp, logo, default terms, discount-approval limit, numbering prefix).

### Reports (Finance, Manager and Admin; each exports to PDF and Excel)

1. **Outstanding:** unpaid invoices by client, with age (0–30, 31–60, 60+ days).
2. **Collections:** payments received per month, split by cash and bank.
3. **Sales:** invoiced per month, with discount given and tax charged.
4. **Client statement:** one client, all invoices and payments.
5. **Contracts:** active, expiring in 30 days, expired.
6. **Operations:** visits done, pending and overdue per Operations Manager and per team member.
7. **Sales pipeline (CRO):** leads by stage, proposals sent and accepted.

---

## 7. Data model (keep it flat and simple)

`users` (role, name, phone, active) · `teamMembers` (omId, name, phone, role, active) · `clients` (type, name, phone, email, address, city, ntn?, strn?, cnic?, note) · `sites` (clientId, name, address, contact) · `leads` (+ `contactLogs`) · `meetings` (leadId, requestedBy, omId, assignedMemberIds, date, status, report) · `proposals` (lines[], discount, tax, total, status, version) · `contracts` (type, start, end, monthlyAmount, billingDay, visitsPerMonth, tax, status, omId) · `visits` (contractId, date, memberIds, status) · `serviceReports` (visitId, details, photos, status, verifiedBy) · `invoices` (number, clientId, contractId?, month, lines[], discount, tax, total, paid, balance, status) · `payments` (invoiceId, amount, mode, ref, taxDeducted?, receiptNo) · `files` (clientId, kind, url, name) · `settings` (company profile, limits, counters) · `auditLog` (who, what, when).

All money values are stored as numbers in PKR, and totals are always recomputed from the lines on the server side of the form (never trusted from the UI).

---

## 8. Build order: work in phases and STOP after each

After each phase: run `npm run build`, list what now works, and **wait for my "go"**.

1. **Foundation:** project setup, Firebase, login, the 5 roles, a sidebar per role, Settings and company profile, user and team management, Firestore rules.
2. **Clients and leads:** clients (individual or company, sites), leads, contact log, CRO home.
3. **Meetings:** CRO request, OM assignment of a team member, meeting report.
4. **Proposals:** manual lines, discount, optional tax, Manager approval, the PDF helper and the Proposal PDF, send links.
5. **Contracts and operations:** contract creation and PDF, signing, OM assignment, monthly visit schedule, service reports and verification, Service Report PDF.
6. **Finance:** monthly "invoices due" queue, manual and one-time invoices, Invoice PDF, payments (cash or bank), receipts, PAID watermark, client statements.
7. **Reports and polish:** all reports with Excel and PDF export, dashboards, the verify QR page, mobile pass, tests for the money maths and the Firestore rules.

---

## 9. Acceptance checks (I will test these)

- [ ] A CRO creates a lead, requests a meeting, and the OM assigns **a named team member** in 2 taps.
- [ ] A proposal with a 15% discount waits for the Manager, and a 5% one does not.
- [ ] A client with **no tax**: proposal, contract and invoice show no tax anywhere, and the title says "Invoice".
- [ ] A client **with tax** typed as 16% shows the tax columns and "Sales Tax Invoice".
- [ ] A monthly contract with billing day 5 shows up in Finance's "Invoices due" on the 5th, and one click creates the invoice with the right month and amount.
- [ ] Cash payment of part of an invoice leaves the correct balance and creates a receipt. A second bank-transfer payment makes it Paid.
- [ ] An **individual client** goes through the whole flow without ever seeing company or branch fields.
- [ ] Every PDF looks like one family (same letterhead, colours, footer and QR), and appears in the client's **Files** tab automatically.
- [ ] No screen has more than one primary action button.

---

## 10. Before you start

Read the old project's PDF generator and company profile, then **reply with**:
(a) a one-page summary of how you will structure the new project,
(b) any questions or gaps you see in this document,
and wait for my "go" before writing code.
