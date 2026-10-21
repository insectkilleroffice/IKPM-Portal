import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { deviceCode, sortDevices } from '../../lib/devices';
import type { Device, MonitoringRecord, VisitKind } from '../../types/devices';
import type { ServiceJob } from '../../types/operations';

interface Props {
  job: ServiceJob;
  user: { uid: string; name: string };
}

type Flag = 'damaged' | 'replaced' | 'attractantChanged';
const FLAGS: { key: Flag; label: string }[] = [
  { key: 'damaged', label: 'Damage' },
  { key: 'replaced', label: 'Replaced' },
  { key: 'attractantChanged', label: 'Attractant' },
];

/**
 * Monitoring step of the PCO visit: one row per device at the branch with tap inputs.
 * Every tap is saved straight away; Firestore's offline cache syncs it when the phone is back online.
 */
export const MonitoringStep: React.FC<Props> = ({ job, user }) => {
  const store = useDataStore();
  const [visitKind, setVisitKind] = useState<VisitKind>(job.visitKind ?? 'service');
  const [filter, setFilter] = useState('');
  const devices = sortDevices(store.getDevices(job.customerId, job.branchId ?? ''));
  const records = new Map(store.getMonitoringRecords({ jobId: job.id }).map((r) => [r.deviceId, r]));

  const recordFor = (d: Device): MonitoringRecord =>
    records.get(d.id) ?? {
      id: `${job.id}_${d.id}`,
      jobId: job.id,
      deviceId: d.id,
      deviceType: d.type,
      deviceNumber: d.number,
      location: d.location,
      clientId: job.customerId,
      clientType: job.customerType,
      branchId: job.branchId,
      contractId: job.contractId,
      visitKind,
      serviceDate: job.scheduledDate,
      rodentFound: 0,
      lizardFound: 0,
      damaged: false,
      replaced: false,
      attractantChanged: false,
      recordedByUid: user.uid,
      recordedByName: user.name,
      recordedAt: new Date().toISOString(),
    };

  const change = (d: Device, patch: Partial<MonitoringRecord>) =>
    store.saveMonitoringRecords([{ ...recordFor(d), ...patch, visitKind, recordedByUid: user.uid, recordedByName: user.name, recordedAt: new Date().toISOString() }]);

  const markAllChecked = () => store.saveMonitoringRecords(devices.filter((d) => !records.has(d.id)).map((d) => ({ ...recordFor(d), visitKind })));

  if (!devices.length) {
    return <div className="info-hint">No devices are registered for this {job.branchId ? 'branch' : 'client'}. Add them on the customer's Devices tab.</div>;
  }

  const shown = devices.filter((d) => !filter || `${deviceCode(d)} ${d.location}`.toLowerCase().includes(filter.toLowerCase()));
  const counter = (d: Device, key: 'rodentFound' | 'lizardFound', label: string) => {
    const v = records.get(d.id)?.[key] ?? 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: 42 }}>{label}</span>
        <button className="btn btn-sm btn-ghost" aria-label={`Less ${label}`} onClick={() => change(d, { [key]: Math.max(0, v - 1) })} disabled={v === 0}><Minus size={13} /></button>
        <strong style={{ minWidth: 18, textAlign: 'center', color: v ? 'var(--ikpm-rose-600, #E11D48)' : undefined }}>{v}</strong>
        <button className="btn btn-sm btn-ghost" aria-label={`More ${label}`} onClick={() => change(d, { [key]: v + 1 })}><Plus size={13} /></button>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
        {(['service', 'follow_up'] as VisitKind[]).map((k) => (
          <button key={k} className={`btn btn-sm ${visitKind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setVisitKind(k)}>
            {k === 'service' ? 'Service' : 'Follow-up'}
          </button>
        ))}
        <input className="form-input" style={{ flex: 1, minWidth: 120 }} placeholder="Find device / area" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="cell-sub">{records.size}/{devices.length} checked</span>
      </div>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {shown.map((d) => {
          const r = records.get(d.id);
          return (
            <div key={d.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0.5rem 0.6rem', background: r ? 'var(--surface-muted, rgba(16,185,129,.06))' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <strong>{deviceCode(d)}</strong>
                <span className="cell-sub">{d.location}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', alignItems: 'center' }}>
                {counter(d, 'rodentFound', 'Rodent')}
                {counter(d, 'lizardFound', 'Lizard')}
                {FLAGS.map((f) => (
                  <button key={f.key} className={`btn btn-sm ${r?.[f.key] ? 'btn-primary' : 'btn-ghost'}`} onClick={() => change(d, { [f.key]: !r?.[f.key] })}>
                    {f.label}
                  </button>
                ))}
                {!r && <button className="btn btn-sm btn-secondary" onClick={() => change(d, {})}>Checked, nothing found</button>}
              </div>
            </div>
          );
        })}
      </div>
      {records.size < devices.length && (
        <button className="btn btn-secondary" style={{ marginTop: '0.75rem', width: '100%' }} onClick={markAllChecked}>
          Mark the other {devices.length - records.size} as checked, nothing found
        </button>
      )}
    </div>
  );
};

export default MonitoringStep;
