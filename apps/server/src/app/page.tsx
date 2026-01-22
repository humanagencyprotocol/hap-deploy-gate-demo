export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>HAP Demo Server</h1>
      <p>Human Agency Protocol - Deploy Gate Demo</p>

      <h2>Endpoints</h2>
      <ul>
        <li>
          <code>GET /api/sp/pubkey</code> - Get SP public key
        </li>
        <li>
          <code>POST /api/sp/attest</code> - Request attestation
        </li>
        <li>
          <code>POST /api/proxy/execute/deploy</code> - Execute deploy (gated)
        </li>
        <li>
          <a href="/prod">/prod</a> - Current production state
        </li>
      </ul>
    </main>
  );
}
