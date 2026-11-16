import { pageDiagnostic } from '../shared/page-diagnostic.js';

export function PageCheckResult({ page }) {
  const result = page.diagnostic || pageDiagnostic(page);
  const details = result.details || {};
  const codes = [details.httpStatus != null && `HTTP ${details.httpStatus}`, details.code != null && `Meta ${details.code}`, details.subcode != null && `Chi tiết ${details.subcode}`].filter(Boolean);
  return <div className={`page-check-result ${result.level}`} role="status">
    <strong>{result.title}</strong>
    <p>{result.message}</p>
    {result.action && <p><b>Cách xử lý:</b> {result.action}</p>}
    {codes.length > 0 && <small>{codes.join(' · ')}</small>}
  </div>;
}
