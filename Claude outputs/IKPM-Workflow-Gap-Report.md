# IKPM Portal: Final Workflow Gap & Alignment Report

**Date:** 31 October 2026
**Scope:** Branch `10/30/2026` including uncommitted changes (8 files), checked against *IKPM CRM Requirements & Developer Build Guide v1.1*, plus your field model (below).
**Build health:** TypeScript type-check passes; 263/263 unit tests pass. Firestore rules emulator tests were not run (they need the emulator).

---

## 0. Your field model (what the system must follow)

| Person | Has portal login? | What they do in the CRM |
|---|---|---|
| Operations Manager (`operations`) | Yes | Creates contracts, schedules visits, assigns a **Team Leader** to each visit |
| Team Leader / Coordinator (`team_leader`) | Yes | Coordinates their PCOs in person / WhatsApp, **submits the job report**, ticks which PCOs did the work |
| PCO / Technician | **No** | Exists only as an HR **Employee** record (`EMP-xxxx`) with a Team Leader set |

**Rule this creates:** two kinds of IDs, never mixed:

- **Login IDs** (Team Leader) → who can *see and submit* the job → `assignedTeamLeaderId`, `assignedTechnicianIds`
- **Employee IDs** (PCOs) → who *did the work* (payroll, history, complaints) → `assignedPcoEmployeeIds` (planned), `performedByPcoIds` (actual)

Almost every break below happens because the code mixes these two today.

---

## 1. Critical: the issue you reported (Team Leader can't pick their own PCOs, or more than one)

| # | Where | Problem | Effect |
|---|---|---|---|
| 1.1 | Report form, `JobsListPage.tsx` L1267-1277 | "PCO who performed" lists **login users with role technician**. PCOs have no login, so the list is **empty** (or shows wrong people) | Team Leader cannot record who did the job |
| 1.2 | Same | Single-select dropdown | Cannot record 2-3 PCOs on one job |
| 1.3 | Same | No filter by Team Leader | Team A leader would see Team B/C people |
| 1.4 | Submit handler, L475-504 | Saves a login ID into `performedByPcoIds`; payroll counts by **Employee ID** (`payroll.ts` L47-48) | **PCOs get 0 verified jobs → wrong pay / incentive / score** |
| 1.5 | Submit handler, L501 | Overwrites `assignedTechnicianIds` with `[leadPcoId, pco]` | Can drop the Team Leader / other assignees' access |
| 1.6 | Schedule generator (uncommitted), L47-100 | Puts **Employee IDs** into `assignedTechnicianIds` (a login field) and also lists *all* PCOs | Meaningless login entries; "same team" conflict filter doesn't filter |
| 1.7 | Schedule generator | Detects Team Leaders by checking label text contains "(Team Leader)" | Breaks if the label changes |
| 1.8 | `dataService.ts` L1913-1919 (uncommitted) | Double-booking used to block; now only `console.warn` | A Team Leader can be double-booked silently |
| 1.9 | New-job form L896-915 | Field says "Assign Team Member", placeholder says "Select a team leader…", list mixes Ops Managers + TLs + technicians | Confusing; wrong person can be picked |
| 1.10 | `dataService.ts` L450-456 | A Team Leader with "own"/"team" data scope only loads jobs they own or are in `assignedTechnicianIds` for. Jobs with only `assignedTeamLeaderId` set don't load | TL may not see jobs assigned to them |

### Fix

1. **One helper `getTeamPcos(tlUid)`**: active HR employees with `role = 'pco'` and `reportingCoordinatorId = tlUid`. Every PCO picker uses only this.
2. **Scheduling:** Team Leader is required (only `team_leader` users listed). PCOs are optional tick-boxes from that TL's team → saved to `assignedPcoEmployeeIds`. `assignedTechnicianIds = [tlUid]` only.
3. **Report form, "Who performed this visit":** tick-boxes of the TL's PCOs, planned ones pre-ticked, minimum 1 (or "I did it myself"), plus "+ Add PCO from another team (reason)". Save Employee IDs to `performedByPcoIds`; **do not touch** `assignedTechnicianIds`.
4. **Double-booking:** block on the Team Leader's slot again; PCO overlap shows a warning only.
5. **Job loading:** add a query on `assignedTeamLeaderId == uid` so TLs always see their jobs.
6. **Job card:** "Team A · Imran Hussain (TL) · Usman, Bilal".
7. **Payroll test:** one job with 3 PCOs → each gets +1 verified job.

---

## 2. High: other workflow breaks

| # | Problem | Where | Fix |
|---|---|---|---|
| 2.1 | QC "Rejected" / "Needs revisit" still sets **verified = true** → invoice unlocked | `JobsListPage.tsx` L378-390 | Two buttons: **Verify** / **Send back (reason)**. Send back returns job to TL |
| 2.2 | QC form pre-filled ("Muhammad Asif", "…confirmed compliant…") | L180-187 | Supervisor = logged-in user; notes empty |
| 2.3 | Challan photo mandatory for **every** outcome, but "Client blocked access" has no signed challan | L451-459 | Challan + sign-off required only for *Completed / Partial* |
| 2.4 | "Postponed" leaves job *In Progress* forever | L493 | Postponed → opens Reschedule; Client blocked → cancel with reason code |
| 2.5 | Every manual job gets a **fake chemical** (Premise 200 SC, 1 L) | L344-356 | Start with empty chemical list |
| 2.6 | Late flag uses `> 1` day; SRS says same day | L491 | `> 0` |
| 2.7 | Manual job ID = `jobs.length + 1` (can repeat); site always `SITE-01` | L317, L325 | Use the ID counter; pick real site/branch |
| 2.8 | No start gate: pre-check (uniform, safety gear, chemical issue) and **before photos** not required (SRS §5.5, §18) | `workflow.ts` L290-301 | TL confirms pre-check + uploads before photos on Start |
| 2.9 | No **chemical-match** step at QC (SRS §5.5) | QC modal | QC re-enters chemical from signed report; mismatch flags & asks reason |

---

## 3. High: security regressions (uncommitted `firestore.rules`): fix before deploy

| # | Rule | Problem | SRS |
|---|---|---|---|
| 3.1 | `service_jobs` L341, `contracts` L323 | `allow read: if active()`: HR, Finance, anyone reads all jobs & contract values | §3.1 |
| 3.2 | `service_jobs` | Anyone with `pco: edit` (incl. CRO `sales`) can create/update any job and change assignees; the old protective clause is now bypassed by a broader OR | §3.1 |
| 3.3 | `contracts` | `sales`, `team_leader` can update **any** contract field | §3.1 |
| 3.4 | `employee_private` L530 | Uses `canEdit('hr')`; your changes gave Ops Manager & Admin `hr: edit` → they can read **CNIC / bank** | §3.1: HR & CEO only |
| 3.5 | `employees` L524 | Anyone with `canEdit('jobs')` can edit employee records | §3.1 |
| 3.6 | `payroll` L551 | Extra `active()` clause: every user reads payroll (already committed) | §3.1 |

**Fix:** revert to scoped reads; jobs readable by job roles + `assignedTeamLeaderId == uid`; private HR data gated on role `hr`/`super_admin` explicitly (not module edit); remove `active()` from payroll.

---

## 4. Alignment check (do modules agree with each other?)

| Area | Misalignment | Fix |
|---|---|---|
| **Role names** | Code: `operations` = Ops Manager, `team_leader` = Coordinator/TL. HR page labels `team_leader` "Team Leader" and `operations_coordinator` "Operations Coordinator" as different things. `staffSeedData.ts` gives the 3 Karachi TLs role `operations` (= Ops Manager) | One label set everywhere: **Operations Manager / Team Leader / PCO**. Fix seed roles |
| **Team definition** | Teams exist twice: login users have `teamId` (Team & Access page); PCOs have `reportingCoordinatorId` (HR page) | Team = a Team Leader. PCO's team comes from `reportingCoordinatorId`. Store the TL's **login ID** there (HR page currently allows an Employee ID too) |
| **Attendance** | TL sees **all** PCOs company-wide; everyone defaults to *Present 08:30*, so one Save marks the whole company present | TL sees only their team; default = *not marked*; "Mark all present" as an explicit button |
| **Payroll ↔ Jobs** | Payroll reads Employee IDs; report saves login IDs | Fixed by §1 |
| **Complaints ↔ Jobs** | Complaint should show which PCO/TL worked at the client (SRS §5.6); PCO names aren't reliably on jobs today | Fixed by §1 (`performedByPcoIds`); show on client page |
| **Complaint escalation** | Status "escalated" exists, but no automatic 24/48 h timer found | Scheduled check using Settings value |
| **Lead → Proposal gate** | Could not find the "proposal only after Inspection Complete" barrier (SRS §5.2) | Add gate in proposal builder |
| **Not built yet (SRS)** | Expenses with receipt + senior/Accounts verification; random visits & overdue PCO flag; risk assessment on service jobs | Phase per SRS §9 |

---

## 5. User-friendly workflow (recommended)

### Operations Manager
1. Contract → **Generate schedule** → pick **Team Leader** per branch (one choice) → optional PCOs from that team → Confirm.
2. Dashboard: unassigned visits, team load per day, overdue reports.

### Team Leader (main daily user, mobile-first)
**"My Team Today"** screen: today's jobs + my PCOs + attendance in one place.

Each job is **one screen with 3 steps**, each unlocking the next:

1. **Start**: tick uniform / safety gear / chemicals issued, take before photos.
2. **Service**: chemicals used (pick from list), after photos.
3. **Close-out**: choose outcome:
   - *Completed / Partial* → tick PCOs who worked, challan # + photo, client name & rating → Submit
   - *Client blocked* → reason + photo → job cancelled with code
   - *Postponed* → new date → rescheduled

No separate modals, no fields that don't apply to the chosen outcome.

### QC / Ops Manager
Verification queue → open job → re-enter chemical from signed report → **Verify** or **Send back (reason)**. Only verified jobs go to Accounts.

### General UX
- Same names for roles everywhere.
- Required fields marked and explained *before* submit (not only an error after).
- Every picker shows only relevant people (my team first).
- Default to empty, not to fake/pre-approved values.

---

## 6. Recommended order

1. Security rules (§3)
2. Team Leader / multi-PCO fix + payroll (§1)
3. QC Verify / Send back, remove fake chemical, late flag (§2.1-2.6)
4. Outcome-aware close-out + start gate (§2.3, 2.4, 2.8)
5. Alignment: role labels, attendance per team, job loading for TL (§4)
6. Chemical match, complaint escalation timer, proposal gate
7. Remaining SRS modules (expenses, random visits)

**Note:** steps 1-2 edit files that currently have uncommitted changes. Commit or back up first.
