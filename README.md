# HAP Deploy Gate Demo

Reference implementation of the Human Agency Protocol v0.2 Deploy Gate Profile.

## Structure

```
demo/
├── apps/
│   ├── ui/           # Local direction UI (Next.js, localhost:3000)
│   └── server/       # SP + Proxy + /prod (Next.js, Vercel, localhost:3001)
├── packages/
│   └── hap-core/     # Shared canonicalization and verification logic
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Actions deploy workflow
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Build shared package
pnpm --filter @hap-demo/core build

# Start server (SP + Proxy)
pnpm dev:server

# Start UI (separate terminal)
pnpm dev:ui
```

## Endpoints

### Service Provider (SP)

- `GET /api/sp/pubkey` - Get SP public key
- `POST /api/sp/attest` - Request attestation

### Executor Proxy

- `POST /api/proxy/execute/deploy` - Execute deploy (requires bearer token)

### Production State

- `GET /prod` - View current prod state (HTML)
- `GET /prod.json` - View current prod state (JSON)

## Environment Variables

### Server (Vercel)

```
SP_PRIVATE_KEY=<hex>     # Ed25519 private key
SP_PUBLIC_KEY=<hex>      # Ed25519 public key
HAP_PROXY_TOKEN=<token>  # Bearer token for proxy auth
KV_REST_API_URL=<url>    # Vercel KV (optional, uses memory store locally)
KV_REST_API_TOKEN=<token>
```

### UI (Local)

```
GITHUB_TOKEN=<token>     # For posting PR comments
NEXT_PUBLIC_SP_URL=http://localhost:3001
```

### GitHub Actions

```
HAP_PROXY_URL=https://your-deployment.vercel.app
HAP_PROXY_TOKEN=<same as server>
```

## Demo Flow

1. Open a PR in your repo
2. Run `pnpm dev:server` and `pnpm dev:ui`
3. Use the UI to create an attestation for the PR
4. Attestation is posted as a PR comment
5. Trigger the deploy workflow with the PR number
6. View the updated `/prod` page

## Protocol Compliance

This demo implements:

- **Deploy Gate Profile v0.2** - Frame canonicalization, Decision Owner scopes
- **Attestation format** - Ed25519 signatures, TTL enforcement
- **Proxy validation** - Frame hash recomputation, signature verification
- **Error codes** - INVALID_SIGNATURE, EXPIRED, FRAME_MISMATCH, etc.

See [Deploy Gate Profile](/content/0.2/deploy-gate-profile.md) for full specification.
