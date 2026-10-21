import React, { useRef, useState } from 'react';
import { Archive, Check, FileDown, ImagePlus, MapPin, Pencil, Plus, X } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { bulkDevices, DEVICE_TYPES, deviceCode, deviceTypeLabel, sortDevices } from '../../lib/devices';
import { opsPdf } from '../../lib/opsPdf';
import { quarterOf } from '../../lib/devices';
import { fileGenerated } from '../documents/fileGenerated';
import type { Device, DeviceType } from '../../types/devices';
import type { DocumentOwner, StoredFile } from '../../types/document';

interface Props {
  clientId: string;
  clientType: 'company' | 'individual';
  clientName: string;
  branchId?: string;
  branchName?: string;
  address?: string;
  floorPlan?: StoredFile;
  /** Parent saves the floor plan on the company / branch record. */
  onFloorPlanSaved: (file: StoredFile) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const addYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;

/** Device register (Step 12): numbered traps / stations per client or branch, floor-plan pins and the layout PDF. */
export const DeviceRegisterPanel: React.FC<Props> = ({ clientId, clientType, clientName, branchId, branchName, address, floorPlan, onFloorPlanSaved }) => {
  const store = useDataStore();
  const { userProfile, effectiveRole } = useAuth();
  const { success, error, warning } = useNotification();
  const canEdit = canEditModule(effectiveRole, 'customers') || canEditModule(effectiveRole, 'jobs');
  const [showRetired, setShowRetired] = useState(false);
  const [bulk, setBulk] = useState({ type: 'mechanical_trap' as DeviceType, spec: '', installedAt: today() });
  const [editing, setEditing] = useState<Device | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; pinX?: number; pinY?: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [layout, setLayout] = useState({ documentNo: '', effectiveDate: today(), reviewDate: addYear(today()), preparedBy: userProfile?.displayName || '', checkedBy: '' });
  const [exporting, setExporting] = useState(false);
  const [trendDate, setTrendDate] = useState(today());
  const planRef = useRef<HTMLDivElement>(null);

  // Branch view: that branch's devices; company view: devices not tied to a branch
  const all = store.getDevices(clientId, branchId ?? '', true);
  const devices = sortDevices(all.filter((d) => showRetired || d.status === 'active'));
  const active = all.filter((d) => d.status === 'active');
  const owner: DocumentOwner = branchId ? { kind: 'branch', id: branchId } : { kind: clientType === 'company' ? 'company' : 'client', id: clientId };
  const email = userProfile?.email || 'admin';

  const addBulk = () => {
    const { devices: created, skipped } = bulkDevices(bulk.spec, { clientId, clientType, branchId, type: bulk.type, installedAt: bulk.installedAt }, all);
    if (!created.length && !skipped.length) {
      error('Could not read the range', 'Use a number range and location, e.g. "1-30 Outside" or "31-40 Kitchen".');
      return;
    }
    // Re-adding a retired number brings it back
    store.saveDevices(created.map((d) => ({ ...(all.find((x) => x.id === d.id) ?? {}), ...d, retiredAt: undefined })), email, `Added ${created.length} ${deviceTypeLabel(bulk.type)}(s) ${bulk.spec}`);
    if (skipped.length) warning('Some numbers already exist', `Skipped ${skipped.join(', ')}.`);
    else success('Devices added', `${created.length} ${deviceTypeLabel(bulk.type).toLowerCase()}(s) added.`);
    setBulk({ ...bulk, spec: '' });
  };

  const saveEdit = () => {
    if (!editing) return;
    store.saveDevices([editing], email, `Edited ${deviceCode(editing)}`);
    setEditing(null);
  };

  const uploadPlan = async (file: File) => {
    if (!integrations.cloudinary) {
      error('File storage is not configured', 'Floor plans need Cloudinary.');
      return;
    }
    setUploading(true);
    try {
      const stored = await uploadFile(file, { scope: store.uploadScopeFor(owner, 'layout'), subPath: 'floor-plan', fileName: file.name });
      onFloorPlanSaved(stored);
      success('Floor plan saved', 'Drag the numbered pins onto it.');
    } catch (e) {
      error('Upload failed', e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const pointFrom = (e: React.PointerEvent | React.MouseEvent) => {
    const r = planRef.current!.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { pinX: clamp((e.clientX - r.left) / r.width), pinY: clamp((e.clientY - r.top) / r.height) };
  };

  const movePin = (id: string, pos: { pinX: number; pinY: number }) => {
    const d = all.find((x) => x.id === id);
    if (d) store.saveDevices([{ ...d, ...pos }], email, `Placed ${deviceCode(d)} on the floor plan`);
  };

  const exportLayout = async () => {
    if (!layout.documentNo.trim()) {
      error('Document number needed', 'Enter the layout document number.');
      return;
    }
    setExporting(true);
    try {
      const input = { ...layout, clientName, siteName: branchName, address, devices: active, floorPlanUrl: floorPlan?.url };
      const doc = await fileGenerated(await opsPdf.layoutBlob(input), {
        owner,
        category: 'layout',
        title: `Pest Management Layout ${layout.documentNo}`,
        fileName: opsPdf.layoutFileName(input),
        subPath: 'layout',
        user: { email: userProfile?.email, displayName: userProfile?.displayName },
      });
      if (doc) success('Layout saved', `${layout.documentNo} is in ${clientName} / Documents.`);
      else warning('Downloaded only', 'File storage is off or you are offline; the layout was downloaded.');
    } catch (e) {
      error('Could not create the layout', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  // One-click quarterly trend report into Service Reports
  const trendReport = async () => {
    const records = store.getMonitoringRecords({ clientId, branchId: branchId ?? '' });
    const input = { clientName, location: branchName, date: trendDate, preparedBy: userProfile?.displayName || email, records };
    setExporting(true);
    try {
      const doc = await fileGenerated(await opsPdf.trendBlob(input), {
        owner,
        category: 'service_report',
        title: `Quarterly Trend Report ${quarterOf(trendDate).key}${branchName ? ` (${branchName})` : ''}`,
        fileName: opsPdf.trendFileName(input),
        subPath: 'trend',
        user: { email: userProfile?.email, displayName: userProfile?.displayName },
      });
      if (doc) success('Trend report saved', `${quarterOf(trendDate).key} is in ${clientName} / Service Reports.`);
      else warning('Downloaded only', 'File storage is off or you are offline; the report was downloaded.');
    } catch (e) {
      error('Could not create the trend report', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const unplaced = active.filter((d) => d.pinX === undefined);

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Device register{branchName ? ` · ${branchName}` : ''}</h3>
          <div className="cell-sub">
            {DEVICE_TYPES.map((t) => ({ t, n: active.filter((d) => d.type === t.value).length })).filter((x) => x.n).map((x) => `${x.t.label}: ${x.n}`).join(' · ') || 'No devices yet'}
          </div>
        </div>

        {canEdit && (
          <div className="form-grid" style={{ gridTemplateColumns: 'minmax(140px,1fr) minmax(180px,2fr) minmax(130px,1fr) auto', alignItems: 'end', margin: '0.75rem 0' }}>
            <div>
              <label className="form-label">Device type</label>
              <select className="form-select" value={bulk.type} onChange={(e) => setBulk({ ...bulk, type: e.target.value as DeviceType })}>
                {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Numbers and location</label>
              <input className="form-input" placeholder="e.g. 1-30 Outside" value={bulk.spec} onChange={(e) => setBulk({ ...bulk, spec: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addBulk()} />
            </div>
            <div>
              <label className="form-label">Installed</label>
              <input className="form-input" type="date" value={bulk.installedAt} onChange={(e) => setBulk({ ...bulk, installedAt: e.target.value })} />
            </div>
            <button className="btn btn-primary" onClick={addBulk} disabled={!bulk.spec.trim()}><Plus size={14} /> Add</button>
          </div>
        )}

        <label className="cell-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired devices
        </label>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>Code</th><th>Type</th><th>Location</th><th>In / Out</th><th>Installed</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {devices.length === 0 && <tr><td colSpan={7} className="cell-sub">No devices registered.</td></tr>}
              {devices.map((d) =>
                editing?.id === d.id ? (
                  <tr key={d.id}>
                    <td>{deviceCode(d)}</td>
                    <td>{deviceTypeLabel(d.type)}</td>
                    <td><input className="form-input" value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></td>
                    <td>
                      <select className="form-select" value={editing.indoorOutdoor} onChange={(e) => setEditing({ ...editing, indoorOutdoor: e.target.value as Device['indoorOutdoor'] })}>
                        <option value="indoor">Indoor</option><option value="outdoor">Outdoor</option>
                      </select>
                    </td>
                    <td><input className="form-input" type="date" value={editing.installedAt.slice(0, 10)} onChange={(e) => setEditing({ ...editing, installedAt: e.target.value })} /></td>
                    <td><input className="form-input" value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-primary" onClick={saveEdit}><Check size={13} /></button>{' '}
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}><X size={13} /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id} style={d.status === 'retired' ? { opacity: 0.5 } : undefined}>
                    <td style={{ fontWeight: 700 }}>{deviceCode(d)}</td>
                    <td>{deviceTypeLabel(d.type)}</td>
                    <td>{d.location}</td>
                    <td>{d.indoorOutdoor === 'outdoor' ? 'Outdoor' : 'Indoor'}</td>
                    <td>{formatDate(d.installedAt)}</td>
                    <td className="cell-sub">{d.status === 'retired' ? `Retired ${d.retiredAt ? formatDate(d.retiredAt) : ''}` : d.notes || ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canEdit && d.status === 'active' && (
                        <>
                          <button className="btn btn-sm btn-ghost" title="Edit" onClick={() => setEditing({ ...d })}><Pencil size={13} /></button>
                          <button className="btn btn-sm btn-ghost" title="Retire" onClick={() => window.confirm(`Retire ${deviceCode(d)}? It stays in the history.`) && store.retireDevice(d.id, email)}><Archive size={13} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Floor plan (optional)</h3>
          {canEdit && (
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              <ImagePlus size={14} /> {uploading ? 'Uploading…' : floorPlan ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => e.target.files?.[0] && uploadPlan(e.target.files[0])} />
            </label>
          )}
        </div>
        {floorPlan ? (
          <>
            {canEdit && unplaced.length > 0 && (
              <div className="info-hint" style={{ margin: '0.75rem 0' }}>
                Pick a device, then click the plan to place it:{' '}
                {unplaced.map((d) => (
                  <button key={d.id} className={`btn btn-sm ${placing === d.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPlacing(placing === d.id ? null : d.id)}>
                    <MapPin size={12} /> {deviceCode(d)}
                  </button>
                ))}
              </div>
            )}
            <div
              ref={planRef}
              style={{ position: 'relative', marginTop: '0.75rem', touchAction: 'none', cursor: placing ? 'crosshair' : 'default', userSelect: 'none' }}
              onClick={(e) => {
                if (!placing) return;
                movePin(placing, pointFrom(e));
                setPlacing(null);
              }}
              onPointerMove={(e) => dragging && setDragging({ id: dragging.id, ...pointFrom(e) })}
              onPointerUp={(e) => {
                if (!dragging) return;
                movePin(dragging.id, pointFrom(e)); // saved once, on release
                setDragging(null);
              }}
            >
              <img src={floorPlan.url} alt="Floor plan" style={{ width: '100%', display: 'block', borderRadius: 6, border: '1px solid var(--border-subtle)' }} draggable={false} />
              {active.filter((d) => d.pinX !== undefined).map((d) => dragging?.id === d.id && dragging.pinX !== undefined ? { ...d, pinX: dragging.pinX, pinY: dragging.pinY } : d).map((d) => (
                <span
                  key={d.id}
                  title={`${deviceCode(d)} · ${d.location}`}
                  onPointerDown={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                    setDragging({ id: d.id });
                  }}
                  style={{
                    position: 'absolute', left: `${d.pinX! * 100}%`, top: `${d.pinY! * 100}%`, transform: 'translate(-50%, -50%)',
                    minWidth: 22, height: 22, padding: '0 4px', borderRadius: 11, background: 'var(--brand, #1A73E8)', color: '#fff',
                    fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canEdit ? 'grab' : 'default',
                    boxShadow: '0 1px 3px rgba(0,0,0,.35)',
                  }}
                >
                  {d.number}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="cell-sub" style={{ marginTop: '0.5rem' }}>No floor plan. The layout PDF then lists the devices only.</div>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Pest Management Layout PDF</h3>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', margin: '0.75rem 0' }}>
          <div><label className="form-label">Document No.</label><input className="form-input" value={layout.documentNo} onChange={(e) => setLayout({ ...layout, documentNo: e.target.value })} /></div>
          <div><label className="form-label">Effective date</label><input className="form-input" type="date" value={layout.effectiveDate} onChange={(e) => setLayout({ ...layout, effectiveDate: e.target.value })} /></div>
          <div><label className="form-label">Review date</label><input className="form-input" type="date" value={layout.reviewDate} onChange={(e) => setLayout({ ...layout, reviewDate: e.target.value })} /></div>
          <div><label className="form-label">Prepared by</label><input className="form-input" value={layout.preparedBy} onChange={(e) => setLayout({ ...layout, preparedBy: e.target.value })} /></div>
          <div><label className="form-label">Checked by</label><input className="form-input" value={layout.checkedBy} onChange={(e) => setLayout({ ...layout, checkedBy: e.target.value })} /></div>
        </div>
        <button className="btn btn-primary" onClick={exportLayout} disabled={exporting || active.length === 0}><FileDown size={14} /> {exporting ? 'Creating…' : 'Export to client Documents'}</button>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Quarterly trend report</h3>
        <p className="cell-sub">Rodent / lizard activity per device and area, hotspots, and the change from the previous quarter.</p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <div><label className="form-label">Quarter containing</label><input className="form-input" type="date" value={trendDate} onChange={(e) => setTrendDate(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={trendReport} disabled={exporting}><FileDown size={14} /> Create {quarterOf(trendDate).key} report</button>
        </div>
      </div>
    </div>
  );
};

export default DeviceRegisterPanel;
