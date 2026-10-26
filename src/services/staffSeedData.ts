// Karachi Operations Teams — reference data for IKPM Portal
// 3 Operation Persons, each leading a team of 5 Technicians (PCOs).
// This data is used to pre-populate the Team & Access page and to
// reference technician names and IDs throughout the portal.

export interface OperationPerson {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  role: 'operations';
  city: string;
  area: string;
  teamId: string;
  teamName: string;
  designationTitle: string;
  isActive: true;
}

export interface Technician {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  role: 'technician';
  city: string;
  area: string;
  teamId: string;
  teamName: string;
  designationTitle: string;
  isActive: true;
}

export interface KarachiTeam {
  teamId: string;
  teamName: string;
  city: 'Karachi';
  coverageArea: string;
  operationPerson: OperationPerson;
  technicians: Technician[];
}

// ── Team A — Karachi North / Central ───────────────────────────────────────
const TEAM_A: KarachiTeam = {
  teamId: 'KHI-TEAM-A',
  teamName: 'Karachi North Team',
  city: 'Karachi',
  coverageArea: 'North Karachi, Nazimabad, Gulshan-e-Iqbal, Gulberg, F.B. Area',
  operationPerson: {
    uid: 'ops_imran_hussain',
    displayName: 'Imran Hussain',
    email: 'imran.hussain@ikpm.com.pk',
    phone: '+92 300 1230001',
    role: 'operations',
    city: 'Karachi',
    area: 'North Karachi',
    teamId: 'KHI-TEAM-A',
    teamName: 'Karachi North Team',
    designationTitle: 'Operation Person — Karachi North',
    isActive: true,
  },
  technicians: [
    {
      uid: 'tech_usman_malik',
      displayName: 'Usman Malik',
      email: 'usman.malik@ikpm.com.pk',
      phone: '+92 300 5551001',
      role: 'technician',
      city: 'Karachi',
      area: 'North Karachi',
      teamId: 'KHI-TEAM-A',
      teamName: 'Karachi North Team',
      designationTitle: 'PCO Technician — Karachi North',
      isActive: true,
    },
    {
      uid: 'tech_bilal_raza',
      displayName: 'Bilal Raza',
      email: 'bilal.raza@ikpm.com.pk',
      phone: '+92 300 5551002',
      role: 'technician',
      city: 'Karachi',
      area: 'Gulshan-e-Iqbal',
      teamId: 'KHI-TEAM-A',
      teamName: 'Karachi North Team',
      designationTitle: 'PCO Technician — Karachi North',
      isActive: true,
    },
    {
      uid: 'tech_aqib_mehmood',
      displayName: 'Aqib Mehmood',
      email: 'aqib.mehmood@ikpm.com.pk',
      phone: '+92 300 5551003',
      role: 'technician',
      city: 'Karachi',
      area: 'Gulberg',
      teamId: 'KHI-TEAM-A',
      teamName: 'Karachi North Team',
      designationTitle: 'PCO Technician — Karachi North',
      isActive: true,
    },
    {
      uid: 'tech_farhan_siddiqui',
      displayName: 'Farhan Siddiqui',
      email: 'farhan.siddiqui@ikpm.com.pk',
      phone: '+92 300 5551004',
      role: 'technician',
      city: 'Karachi',
      area: 'F.B. Area',
      teamId: 'KHI-TEAM-A',
      teamName: 'Karachi North Team',
      designationTitle: 'PCO Technician — Karachi North',
      isActive: true,
    },
    {
      uid: 'tech_saad_ahmed',
      displayName: 'Saad Ahmed',
      email: 'saad.ahmed@ikpm.com.pk',
      phone: '+92 300 5551005',
      role: 'technician',
      city: 'Karachi',
      area: 'Nazimabad',
      teamId: 'KHI-TEAM-A',
      teamName: 'Karachi North Team',
      designationTitle: 'PCO Technician — Karachi North',
      isActive: true,
    },
  ],
};

// ── Team B — Karachi South / Clifton / DHA ─────────────────────────────────
const TEAM_B: KarachiTeam = {
  teamId: 'KHI-TEAM-B',
  teamName: 'Karachi South Team',
  city: 'Karachi',
  coverageArea: 'Clifton, DHA Phase 1–8, Boat Basin, Saddar, Kemari',
  operationPerson: {
    uid: 'ops_arif_nawaz',
    displayName: 'Arif Nawaz',
    email: 'arif.nawaz@ikpm.com.pk',
    phone: '+92 300 1230002',
    role: 'operations',
    city: 'Karachi',
    area: 'Clifton / DHA',
    teamId: 'KHI-TEAM-B',
    teamName: 'Karachi South Team',
    designationTitle: 'Operation Person — Karachi South',
    isActive: true,
  },
  technicians: [
    {
      uid: 'tech_zubair_khan',
      displayName: 'Zubair Khan',
      email: 'zubair.khan@ikpm.com.pk',
      phone: '+92 300 5552001',
      role: 'technician',
      city: 'Karachi',
      area: 'Clifton',
      teamId: 'KHI-TEAM-B',
      teamName: 'Karachi South Team',
      designationTitle: 'PCO Technician — Karachi South',
      isActive: true,
    },
    {
      uid: 'tech_naeem_qureshi',
      displayName: 'Naeem Qureshi',
      email: 'naeem.qureshi@ikpm.com.pk',
      phone: '+92 300 5552002',
      role: 'technician',
      city: 'Karachi',
      area: 'DHA Phase 5–6',
      teamId: 'KHI-TEAM-B',
      teamName: 'Karachi South Team',
      designationTitle: 'PCO Technician — Karachi South',
      isActive: true,
    },
    {
      uid: 'tech_kashif_ali',
      displayName: 'Kashif Ali',
      email: 'kashif.ali@ikpm.com.pk',
      phone: '+92 300 5552003',
      role: 'technician',
      city: 'Karachi',
      area: 'DHA Phase 1–2',
      teamId: 'KHI-TEAM-B',
      teamName: 'Karachi South Team',
      designationTitle: 'PCO Technician — Karachi South',
      isActive: true,
    },
    {
      uid: 'tech_asim_butt',
      displayName: 'Asim Butt',
      email: 'asim.butt@ikpm.com.pk',
      phone: '+92 300 5552004',
      role: 'technician',
      city: 'Karachi',
      area: 'Boat Basin / Saddar',
      teamId: 'KHI-TEAM-B',
      teamName: 'Karachi South Team',
      designationTitle: 'PCO Technician — Karachi South',
      isActive: true,
    },
    {
      uid: 'tech_rizwan_tariq',
      displayName: 'Rizwan Tariq',
      email: 'rizwan.tariq@ikpm.com.pk',
      phone: '+92 300 5552005',
      role: 'technician',
      city: 'Karachi',
      area: 'Kemari / Lyari',
      teamId: 'KHI-TEAM-B',
      teamName: 'Karachi South Team',
      designationTitle: 'PCO Technician — Karachi South',
      isActive: true,
    },
  ],
};

// ── Team C — Karachi East / Korangi / SITE ─────────────────────────────────
const TEAM_C: KarachiTeam = {
  teamId: 'KHI-TEAM-C',
  teamName: 'Karachi East Team',
  city: 'Karachi',
  coverageArea: 'Korangi Industrial Area, Landhi, SITE, Malir, Bin Qasim',
  operationPerson: {
    uid: 'ops_kamran_abbasi',
    displayName: 'Kamran Abbasi',
    email: 'kamran.abbasi@ikpm.com.pk',
    phone: '+92 300 1230003',
    role: 'operations',
    city: 'Karachi',
    area: 'Korangi / Landhi',
    teamId: 'KHI-TEAM-C',
    teamName: 'Karachi East Team',
    designationTitle: 'Operation Person — Karachi East',
    isActive: true,
  },
  technicians: [
    {
      uid: 'tech_waqas_hassan',
      displayName: 'Waqas Hassan',
      email: 'waqas.hassan@ikpm.com.pk',
      phone: '+92 300 5553001',
      role: 'technician',
      city: 'Karachi',
      area: 'Korangi Industrial Area',
      teamId: 'KHI-TEAM-C',
      teamName: 'Karachi East Team',
      designationTitle: 'PCO Technician — Karachi East',
      isActive: true,
    },
    {
      uid: 'tech_nadeem_iqbal',
      displayName: 'Nadeem Iqbal',
      email: 'nadeem.iqbal@ikpm.com.pk',
      phone: '+92 300 5553002',
      role: 'technician',
      city: 'Karachi',
      area: 'Landhi',
      teamId: 'KHI-TEAM-C',
      teamName: 'Karachi East Team',
      designationTitle: 'PCO Technician — Karachi East',
      isActive: true,
    },
    {
      uid: 'tech_tahir_hameed',
      displayName: 'Tahir Hameed',
      email: 'tahir.hameed@ikpm.com.pk',
      phone: '+92 300 5553003',
      role: 'technician',
      city: 'Karachi',
      area: 'SITE Industrial Area',
      teamId: 'KHI-TEAM-C',
      teamName: 'Karachi East Team',
      designationTitle: 'PCO Technician — Karachi East',
      isActive: true,
    },
    {
      uid: 'tech_junaid_rehman',
      displayName: 'Junaid Rehman',
      email: 'junaid.rehman@ikpm.com.pk',
      phone: '+92 300 5553004',
      role: 'technician',
      city: 'Karachi',
      area: 'Malir',
      teamId: 'KHI-TEAM-C',
      teamName: 'Karachi East Team',
      designationTitle: 'PCO Technician — Karachi East',
      isActive: true,
    },
    {
      uid: 'tech_faisal_ghani',
      displayName: 'Faisal Ghani',
      email: 'faisal.ghani@ikpm.com.pk',
      phone: '+92 300 5553005',
      role: 'technician',
      city: 'Karachi',
      area: 'Bin Qasim / Port Qasim',
      teamId: 'KHI-TEAM-C',
      teamName: 'Karachi East Team',
      designationTitle: 'PCO Technician — Karachi East',
      isActive: true,
    },
  ],
};

export const KARACHI_TEAMS: KarachiTeam[] = [TEAM_A, TEAM_B, TEAM_C];

/** Flat list of all 3 Operation Persons. */
export const KARACHI_OPERATION_PERSONS: OperationPerson[] = KARACHI_TEAMS.map((t) => t.operationPerson);

/** Flat list of all 15 Karachi Technicians. */
export const KARACHI_TECHNICIANS: Technician[] = KARACHI_TEAMS.flatMap((t) => t.technicians);

/** Look up a technician by uid. */
export const getTechnicianById = (uid: string): Technician | undefined =>
  KARACHI_TECHNICIANS.find((t) => t.uid === uid);

/** Look up an operation person by uid. */
export const getOperationPersonById = (uid: string): OperationPerson | undefined =>
  KARACHI_OPERATION_PERSONS.find((p) => p.uid === uid);

/** All technicians belonging to a specific team. */
export const getTeamTechnicians = (teamId: string): Technician[] =>
  KARACHI_TECHNICIANS.filter((t) => t.teamId === teamId);
