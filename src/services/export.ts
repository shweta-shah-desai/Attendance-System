import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { colors } from '../constants/colors';
import type { MonthlyWageReport } from '../types/report';
import type { AttendanceWithEmployee } from '../types/attendance';
import { inr, statusMeta, wageLabel } from '../utils/formatters';
import { prettyMonth, toUi } from '../utils/date';

const css = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: ${colors.textPrimary};
         margin: 0; padding: 28px; font-size: 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-end;
            border-bottom: 3px solid ${colors.primary}; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 22px; font-weight: 700; color: ${colors.primary}; letter-spacing: -0.3px; }
  .sub { color: ${colors.textSecondary}; font-size: 12px; margin-top: 2px; }
  h2 { font-size: 15px; margin: 22px 0 8px; color: ${colors.textPrimary}; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: ${colors.primaryTint}; color: ${colors.primaryDark}; text-align: left;
       padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 8px 10px; border-bottom: 1px solid ${colors.border}; vertical-align: top; }
  tr:nth-child(even) td { background: #FBFCFE; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .total-row td { font-weight: 700; background: ${colors.primaryTint} !important;
                  border-bottom: none; font-size: 13px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .muted { color: ${colors.textSecondary}; }
  .formula { color: ${colors.textSecondary}; font-size: 10px; }
  .footer { margin-top: 26px; border-top: 1px solid ${colors.border}; padding-top: 10px;
            color: ${colors.textDisabled}; font-size: 10px; display: flex; justify-content: space-between; }
`;

const shell = (title: string, subtitle: string, body: string): string => `
<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title><style>${css}</style></head>
<body>
  <div class="header">
    <div><div class="brand">GharSaathi+</div><div class="sub">${subtitle}</div></div>
    <div class="sub">Generated ${toUi(new Date().toISOString().slice(0, 10))}</div>
  </div>
  ${body}
  <div class="footer"><span>GharSaathi+ &middot; offline attendance register</span><span>${title}</span></div>
</body></html>`;

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Monthly wage sheet - one row per Saathi with the full calculation shown. */
export function wageReportHtml(report: MonthlyWageReport, ownerName: string): string {
  const rows = report.rows
    .map(
      (r) => `
      <tr>
        <td><strong>${esc(r.empName)}</strong><div class="formula">${esc(r.formula)}</div></td>
        <td>${esc(wageLabel(r.wageAmt, r.wageType))}</td>
        <td class="num">${r.tally.Present + r.tally.WFH}</td>
        <td class="num">${r.tally['Half-day']}</td>
        <td class="num">${r.tally.Absent}</td>
        <td class="num">${r.tally.Leave}</td>
        <td class="num">${inr(r.grossWage)}</td>
        <td class="num">- ${inr(r.absentDeduction)}</td>
        <td class="num"><strong>${inr(r.netWage)}</strong></td>
      </tr>`,
    )
    .join('');

  const body = `
    <h2>Wage sheet &mdash; ${prettyMonth(report.month)}</h2>
    <div class="muted">Prepared for ${esc(ownerName)}</div>
    <table>
      <thead><tr>
        <th>Saathi</th><th>Wage</th><th class="num">Present</th><th class="num">Half</th>
        <th class="num">Absent</th><th class="num">Leave</th>
        <th class="num">Gross</th><th class="num">Cut</th><th class="num">Net payable</th>
      </tr></thead>
      <tbody>
        ${rows || '<tr><td colspan="9" class="muted">No Saathi records for this month.</td></tr>'}
        <tr class="total-row">
          <td colspan="8">Total to pay</td>
          <td class="num">${inr(report.totalNet)}</td>
        </tr>
      </tbody>
    </table>`;

  return shell(`Wage sheet ${report.month}`, `Monthly wage calculation`, body);
}

/** Day-by-day attendance register for a period. */
export function attendanceReportHtml(
  rows: AttendanceWithEmployee[],
  heading: string,
  ownerName: string,
): string {
  const body = `
    <h2>${esc(heading)}</h2>
    <div class="muted">Prepared for ${esc(ownerName)} &middot; ${rows.length} entries</div>
    <table>
      <thead><tr>
        <th>Date</th><th>Saathi</th><th>Status</th><th>In</th><th>Out</th><th>Remarks</th>
      </tr></thead>
      <tbody>
      ${
        rows
          .map((r) => {
            const meta = statusMeta[r.status];
            return `<tr>
              <td>${toUi(r.date)}</td>
              <td>${esc(r.emp_name)}</td>
              <td><span class="pill" style="background:${meta.tint};color:${meta.color}">${esc(
                meta.label,
              )}</span></td>
              <td>${esc(r.time_in ?? '-')}</td>
              <td>${esc(r.time_out ?? '-')}</td>
              <td class="muted">${esc(r.remarks ?? '')}</td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="6" class="muted">Nothing marked in this period.</td></tr>'
      }
      </tbody>
    </table>`;

  return shell(heading, 'Attendance register', body);
}

export interface ExportResult {
  uri: string;
  shared: boolean;
}

/** Renders HTML to a PDF and opens the system share sheet. */
export async function exportPdf(html: string, fileName: string): Promise<ExportResult> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return { uri: '', shared: false };
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: fileName,
      UTI: 'com.adobe.pdf',
    });
    return { uri, shared: true };
  }
  return { uri, shared: false };
}
