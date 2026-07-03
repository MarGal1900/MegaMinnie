export const GESPREKSVERSLAG_FONT: string;
export const GESPREKSVERSLAG_TEMPLATE_URL: string;

export function buildGespreksverslagDocxFromTemplate(
  templateBuffer: ArrayBuffer,
  input: {
    meetingSubject: string;
    dateTimeLabel?: string | null;
    reportBody: string;
  },
): Promise<Blob>;

export function buildGespreksverslagDocxBlob(
  input: {
    meetingSubject: string;
    dateTimeLabel?: string | null;
    reportBody: string;
  },
  options?: { templateUrl?: string; templateBuffer?: ArrayBuffer },
): Promise<Blob>;
