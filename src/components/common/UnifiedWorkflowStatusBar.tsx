import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Lock,
  ArrowRight,
  AlertCircle,
  FileCheck2,
  Receipt,
  Truck,
  DollarSign,
  ShieldAlert,
} from 'lucide-react';
import type { ServiceJob, Contract } from '../../types/operations';
import type { Invoice } from '../../types/finance';
import { getJobWorkflowChain, StageInfo, UnifiedStage, NextAction } from '../../lib/workflow';

interface UnifiedWorkflowStatusBarProps {
  job?: ServiceJob;
  contract?: Contract;
  invoice?: Invoice;
  nextAction?: NextAction;
  onExecuteNextAction?: () => void;
  compact?: boolean;
}

export const UnifiedWorkflowStatusBar: React.FC<UnifiedWorkflowStatusBarProps> = ({
  job,
  invoice,
  nextAction,
  onExecuteNextAction,
  compact = false,
}) => {
  const [selectedStage, setSelectedStage] = useState<StageInfo | null>(null);

  if (!job) {
    return null;
  }

  const { stages, currentStageId } = getJobWorkflowChain(job, invoice);

  const getStageIcon = (stageId: UnifiedStage, status: StageInfo['status']) => {
    if (status === 'completed') {
      return <CheckCircle2 size={16} />;
    }
    if (status === 'blocked') {
      return <Lock size={15} />;
    }
    switch (stageId) {
      case 'scheduled':
        return <Clock size={15} />;
      case 'in_progress':
        return <Truck size={15} />;
      case 'completed':
        return <FileCheck2 size={15} />;
      case 'verified':
        return <CheckCircle2 size={15} />;
      case 'invoiced':
        return <Receipt size={15} />;
      case 'paid':
        return <DollarSign size={15} />;
      default:
        return <Clock size={15} />;
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: compact ? '0.75rem 1rem' : '1.15rem 1.25rem',
        marginBottom: '1.25rem',
        borderLeft: '4px solid var(--ikpm-emerald-600)',
        backgroundColor: 'var(--bg-surface)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.85rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--ikpm-navy-700)',
              backgroundColor: 'var(--bg-surface-alt)',
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            Workflow Status
          </span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Stage: {stages.find((s) => s.id === currentStageId)?.label}
          </span>
        </div>

        {nextAction && onExecuteNextAction && (
          <button
            onClick={onExecuteNextAction}
            className={`btn ${nextAction.isBlocked ? 'btn-secondary' : 'btn-primary'}`}
            style={{
              padding: '0.35rem 0.85rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              boxShadow: nextAction.isBlocked ? 'none' : '0 2px 6px rgba(16, 185, 129, 0.3)',
            }}
            title={nextAction.isBlocked ? nextAction.blockerReason : nextAction.description}
          >
            <span>{nextAction.label}</span>
            <ArrowRight size={14} />
          </button>
        )}
      </div>

      {/* Progress chain steps */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          padding: '0.25rem 0',
        }}
      >
        {/* Background connecting bar */}
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '20px',
            right: '20px',
            height: '3px',
            backgroundColor: 'var(--border-subtle)',
            zIndex: 1,
          }}
        />

        {stages.map((st, idx) => {
          const isDone = st.status === 'completed';
          const isCurrent = st.id === currentStageId;
          const isSelected = selectedStage?.id === st.id;

          let nodeBg = 'var(--bg-surface)';
          let nodeBorder = 'var(--border-subtle)';
          let nodeColor = 'var(--text-muted)';

          if (isDone) {
            nodeBg = 'var(--ikpm-emerald-600)';
            nodeBorder = 'var(--ikpm-emerald-600)';
            nodeColor = '#FFFFFF';
          } else if (isCurrent) {
            nodeBg = 'var(--ikpm-navy-700)';
            nodeBorder = 'var(--ikpm-navy-700)';
            nodeColor = '#FFFFFF';
          }

          return (
            <div
              key={st.id}
              onClick={() => setSelectedStage(isSelected ? null : st)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                zIndex: 2,
                cursor: 'pointer',
                flex: 1,
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: nodeBg,
                  border: `2px solid ${nodeBorder}`,
                  color: nodeColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: isCurrent ? '0 0 0 4px var(--ikpm-emerald-100)' : 'none',
                  transform: isSelected ? 'scale(1.15)' : 'none',
                }}
                title={`Click for stage details: ${st.label}`}
              >
                {getStageIcon(st.id, st.status)}
              </div>

              <span
                style={{
                  fontSize: compact ? '0.7rem' : '0.75rem',
                  fontWeight: isCurrent ? 800 : isDone ? 600 : 500,
                  color: isCurrent ? 'var(--ikpm-navy-900)' : isDone ? 'var(--ikpm-emerald-700)' : 'var(--text-muted)',
                  marginTop: '0.4rem',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {st.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Interactive Detail Box (Clicking any stage reveals what's happening or what's blocking it) */}
      {selectedStage && (
        <div
          className="animate-fade-in"
          style={{
            marginTop: '0.85rem',
            padding: '0.75rem 1rem',
            backgroundColor: selectedStage.blockerReason ? 'var(--ikpm-amber-50, #FFFBEB)' : 'var(--bg-surface-alt)',
            border: `1px solid ${selectedStage.blockerReason ? '#FCD34D' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            fontSize: '0.825rem',
          }}
        >
          {selectedStage.blockerReason ? (
            <ShieldAlert size={18} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />
          ) : (
            <AlertCircle size={18} color="var(--ikpm-emerald-600)" style={{ flexShrink: 0, marginTop: '2px' }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>
                Stage {selectedStage.stepNumber}: {selectedStage.label}
              </strong>
              <span
                className={`badge-status ${
                  selectedStage.status === 'completed'
                    ? 'badge-emerald'
                    : selectedStage.status === 'current'
                    ? 'badge-navy'
                    : 'badge-slate'
                }`}
                style={{ textTransform: 'capitalize' }}
              >
                {selectedStage.status}
              </span>
            </div>
            <div style={{ color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              {selectedStage.message}
            </div>
            {selectedStage.blockerReason && (
              <div
                style={{
                  color: '#B45309',
                  fontWeight: 600,
                  marginTop: '0.35rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>⚠️ Blocker:</span> {selectedStage.blockerReason}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelectedStage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
