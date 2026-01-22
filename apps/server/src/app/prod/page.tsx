import { getProdState } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProdPage() {
  const state = await getProdState();

  if (!state) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Production State</h1>
        <div
          style={{
            padding: '2rem',
            backgroundColor: '#f5f5f5',
            borderRadius: '8px',
            marginTop: '1rem',
          }}
        >
          <p style={{ color: '#666', fontStyle: 'italic' }}>
            No deployment yet. Use the HAP Demo UI to create an attestation and deploy.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Production State</h1>

      <div
        style={{
          padding: '2rem',
          backgroundColor: '#e8f5e9',
          borderRadius: '8px',
          marginTop: '1rem',
          border: '2px solid #4caf50',
        }}
      >
        <h2 style={{ margin: '0 0 1rem 0', color: '#2e7d32' }}>
          Deployed Successfully
        </h2>

        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <Row label="Repository" value={state.repo} />
            <Row label="SHA" value={state.sha} mono />
            <Row label="Environment" value={state.env} />
            <Row label="Profile" value={state.profile_id} />
            <Row label="Execution Path" value={state.execution_path} />
            <Row label="Frame Hash" value={state.frame_hash} mono />
            <Row label="Disclosure Hash" value={state.disclosure_hash} mono />
            <Row label="Attestation ID" value={state.attestation_id} mono />
            <Row
              label="Updated At"
              value={new Date(state.updated_at * 1000).toISOString()}
            />
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <a href="/prod.json" style={{ color: '#1976d2' }}>
          View as JSON
        </a>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr>
      <td
        style={{
          padding: '0.5rem',
          borderBottom: '1px solid #ddd',
          fontWeight: 'bold',
          width: '150px',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '0.5rem',
          borderBottom: '1px solid #ddd',
          fontFamily: mono ? 'monospace' : 'inherit',
          fontSize: mono ? '0.85rem' : 'inherit',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </td>
    </tr>
  );
}
