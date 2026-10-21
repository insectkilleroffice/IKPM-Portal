// Default client SOP / Pest Management Plan wording (editable under Settings → Templates).
// Placeholders: {{clientName}}, {{companyName}}, {{siteName}}.
// Wording is generic IPM practice for the sales team to review; product names come from the
// client's pack and no registration numbers are printed.

import { fillTemplate } from './templateFill';

export interface SopSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export const SOP_SECTIONS: SopSection[] = [
  {
    title: 'Purpose and scope',
    paragraphs: [
      'This plan sets out how {{companyName}} manages pests at {{clientName}} {{siteName}} under an Integrated Pest Management (IPM) programme: prevention, monitoring, treatment and reporting.',
      'It applies to all areas covered by the agreement, including storage, production / kitchen, service and outside areas.',
    ],
  },
  {
    title: 'Responsibilities',
    paragraphs: [],
    bullets: [
      '{{companyName}}: carries out scheduled service and follow-up visits, maintains devices, applies approved products, records monitoring results and reports findings with recommendations.',
      '{{clientName}}: gives access at the agreed times, keeps areas clean, acts on proofing and hygiene recommendations, and informs {{companyName}} of pest sightings.',
      'The authorised persons listed in this plan sign off service reports and are the contacts for pest issues.',
    ],
  },
  {
    title: 'Rodent control',
    paragraphs: ['Rodents are controlled with mechanical traps and glue / bait stations placed as shown on the pest management layout.'],
    bullets: [
      'Every device is numbered and checked on each service visit; activity, catches and replacements are recorded on the monitoring sheet.',
      'Bait is used only in tamper-resistant stations and never in open food areas.',
      'Entry points found during visits are reported with proofing recommendations.',
    ],
  },
  {
    title: 'Flying insect control',
    paragraphs: ['Flies and other flying insects are controlled through hygiene, proofing, electric fly killers (EFK) and space treatment.'],
    bullets: [
      'EFK units are cleaned and their catch recorded on each service visit.',
      'Cold fogging (ULV) or spraying is done according to the service plan, outside working hours where required.',
      'Breeding sources (drains, waste areas) are inspected and recommendations reported.',
    ],
  },
  {
    title: 'Crawling insect control',
    paragraphs: ['Cockroaches, ants and other crawling insects are controlled with targeted gel baiting, residual spraying of cracks and crevices, and monitoring.'],
    bullets: [
      'Gel is applied in cracks, hinges and harbourage points away from food contact surfaces.',
      'Monitoring points show activity trends between visits.',
      'Gaps between fixtures, tiles and walls are reported for sealing.',
    ],
  },
  {
    title: 'Emergency handling',
    paragraphs: ['If pests are sighted between visits, the authorised person calls the {{companyName}} contact listed below; a follow-up visit is arranged as soon as possible.'],
    bullets: [
      'Product spill or exposure: follow the product MSDS, move people away from the area and inform {{companyName}} immediately.',
      'Do not move or open devices; report damaged or missing devices to {{companyName}}.',
      'Keep this plan, the MSDS and the layout available on site.',
    ],
  },
  {
    title: 'Monitoring, records and review',
    paragraphs: [
      'Service reports and monitoring sheets are shared after every visit. A risk assessment and trend analysis are reviewed with {{clientName}} periodically, and this plan is reviewed at least once a year or after any significant change.',
    ],
  },
];

export const fillSop = (text: string, values: { client: string; company: string; site?: string }) =>
  fillTemplate(text, { clientName: values.client, companyName: values.company, siteName: values.site ? `(${values.site})` : '' }).replace(/\s*\{\{siteName\}\}/g, '');
