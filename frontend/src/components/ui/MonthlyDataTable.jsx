export default function MonthlyDataTable({ rows = [], field, caption, stale = false, ready = true, error = false, formatValue = value => `₹${value.toLocaleString('en-IN')}` }) {
  if (!ready) {
    return <p role="status">{error ? 'Chart data is unavailable. Please try again when the connection is restored.' : 'Loading chart data...'}</p>;
  }
  if (!rows.length) return <p>No monthly data available.</p>;
  const isRevenue = field === 'revenue';
  return (
    <details style={{ marginTop: 16 }}>
      <summary style={{ cursor: 'pointer', padding: '8px 0', fontWeight: 600 }}>View {isRevenue ? 'paid booking value' : 'appointment'} data table</summary>
      <table style={{ marginTop: 8, fontSize: 13 }}>
        <caption style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--theme-text-secondary)' }}>
          {caption}{stale ? ' - last loaded snapshot; updates unavailable' : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', padding: '8px 0' }}>Month</th>
            <th scope="col" style={{ textAlign: 'right', padding: '8px 0' }}>{isRevenue ? 'Paid booking value' : 'Active appointments'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.month} style={{ borderTop: '1px solid var(--theme-border)' }}>
              <th scope="row" style={{ textAlign: 'left', padding: '8px 0', fontWeight: 400 }}>{row.month}</th>
              <td style={{ textAlign: 'right', padding: '8px 0', fontVariantNumeric: 'tabular-nums' }}>{isRevenue ? formatValue(row[field]) : row[field]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
