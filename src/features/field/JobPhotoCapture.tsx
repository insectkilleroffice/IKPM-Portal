import React from 'react';
import type { PhotoEvidence } from '../../types/operations';
import { PhotoCapture, type PhotoCategory } from './PhotoCapture';

export const PHOTO_TYPES: { value: PhotoEvidence['type']; label: string }[] = [
  { value: 'before', label: 'Before treatment' },
  { value: 'infestation_focus', label: 'Infestation / damage' },
  { value: 'bait_station', label: 'Bait station / device' },
  { value: 'after', label: 'After treatment' },
];

interface Props {
  jobId: string;
  photos: PhotoEvidence[];
  onChange: (photos: PhotoEvidence[]) => void;
  onNotify?: (kind: 'success' | 'warning' | 'error', title: string, message: string) => void;
  required?: PhotoEvidence['type'][];
}

/** Camera / gallery photo evidence for a field visit, uploaded to Cloudinary. */
export const JobPhotoCapture: React.FC<Props> = ({ jobId, photos, onChange, onNotify, required }) => (
  <PhotoCapture<PhotoEvidence>
    folder={`job/${jobId}/photos`}
    idPrefix={jobId}
    categories={PHOTO_TYPES as PhotoCategory[]}
    photos={photos}
    onChange={onChange}
    onNotify={onNotify}
    required={required}
    emptyText="No photos yet. Take before and after photos for the service report."
  />
);
