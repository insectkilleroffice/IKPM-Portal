// Device register (Step 12) and monitoring sheets (Step 13).

export type DeviceType = 'mechanical_trap' | 'glue_station' | 'bait_station' | 'efk' | 'roach_monitor' | 'gel_point';
export type DeviceStatus = 'active' | 'retired';

/** One numbered device at a client (and branch). Collection: devices. */
export interface Device {
  id: string;
  clientId: string;
  clientType?: 'company' | 'individual';
  branchId?: string;
  type: DeviceType;
  number: number;
  location: string;
  indoorOutdoor: 'indoor' | 'outdoor';
  status: DeviceStatus;
  installedAt: string;
  notes?: string;
  /** Pin on the floor plan, 0–1 of the image width / height. */
  pinX?: number;
  pinY?: number;
  retiredAt?: string;
  ownerUid?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type VisitKind = 'service' | 'follow_up';

/** One device checked on one visit. Collection: monitoring_records, id `${jobId}_${deviceId}`. */
export interface MonitoringRecord {
  id: string;
  jobId: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceNumber: number;
  location: string;
  clientId: string;
  clientType?: 'company' | 'individual';
  branchId?: string;
  contractId?: string;
  visitKind: VisitKind;
  serviceDate: string;
  rodentFound: number;
  lizardFound: number;
  damaged: boolean;
  replaced: boolean;
  attractantChanged: boolean;
  notes?: string;
  recordedByUid: string;
  recordedByName: string;
  recordedAt: string;
  ownerUid?: string;
}
