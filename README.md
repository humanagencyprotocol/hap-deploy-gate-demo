# HAP Deploy Gate Demo

A working demo showing how humans stay in control of automated deployments. Before any code ships to production, a human must review the changes, confirm they understand the tradeoffs, and sign off — creating a cryptographic attestation that the deployment system verifies before proceeding.

## Structure

```
demo/
├── apps/
│   ├── ui/           # Attestation UI (Next.js, localhost:3000)
│   └── server/       # Service Provider (Next.js, localhost:3001)
├── packages/
│   └── hap-core/     # Shared canonicalization and verification logic
└── .github/
    └── workflows/
        └── hap-check.yml  # GitHub Actions attestation verification
```

## Quick Start

### Option A: Use the Public Server (Recommended)

A public Service Provider is available at **https://service.humanagencyprotocol.org** — no server setup required.

```bash
# Install dependencies
pnpm install

# Build shared package
pnpm --filter @hap-demo/core build

# Start UI only
pnpm dev:ui
```

Create `apps/ui/.env.local`:
```
GITHUB_TOKEN=<your personal access token with repo scope>
NEXT_PUBLIC_SP_URL=https://service.humanagencyprotocol.org
```

### Option B: Run Your Own Server

```bash
# Install dependencies
pnpm install

# Build shared package
pnpm --filter @hap-demo/core build

# Start server (SP)
pnpm dev:server

# Start UI (separate terminal)
pnpm dev:ui
```

Create `apps/ui/.env.local`:
```
GITHUB_TOKEN=<your personal access token with repo scope>
NEXT_PUBLIC_SP_URL=http://localhost:3001
```

## GitHub Setup

### Enable Branch Protection (Required for Merge Gate)

To block merges without valid attestations, you need to set up a branch ruleset:

1. Go to **Settings → Rules → Rulesets → New ruleset → New branch ruleset**
2. Configure the ruleset:
   - **Ruleset name:** `HAP Protection`
   - **Enforcement status:** `Active`
3. Under **Target branches**, click **Add target** → **Include by pattern**:
   - Enter: `main`
4. Under **Branch rules**, enable:
   - **Require status checks to pass**
     - Click **Add checks** and search for: `Verify HAP Attestation`
   - **Require a pull request before merging** (recommended)
   - **Block force pushes** (recommended)
5. Click **Create**

Without this setup, the workflow will report status but won't block merges.

> **Note:** The GitHub Action automatically uses `https://service.humanagencyprotocol.org` for attestation verification. No additional configuration is needed.

## Demo Flow

### Single Approval (Canary Path)

1. Create a PR to the `main` branch
2. Run `pnpm dev:server` and `pnpm dev:ui`
3. Open http://localhost:3000
4. Enter the PR URL and click "Load PR"
5. Select **Canary (gradual rollout)** execution path
6. Review changes and check the confirmation boxes
7. Select **Engineering** role
8. Click "Request Attestation"
9. Click "Post Attestation to PR" to add it as a PR comment
10. The GitHub Action will verify the attestation and allow merge

### Multi-Person Approval (Full Path)

For production deployments requiring multiple approvals:

1. Create a PR and select **Full (immediate deployment)** path
2. **Engineer** goes through the UI:
   - Select role: **Engineering**
   - Complete attestation and post to PR
3. **Release Manager** goes through the UI separately:
   - Select role: **Release Management**
   - Complete attestation and post as another PR comment
4. GitHub Action verifies both attestations are present and valid
5. Merge is allowed only when all required roles have attested

| Execution Path | Required Approvals |
|---------------|-------------------|
| Canary | Engineering only |
| Full | Engineering + Release Management |

## Endpoints

### Service Provider (SP)

- `GET /api/sp/pubkey` - Get SP public key
- `POST /api/sp/attest` - Request attestation
- `POST /api/sp/verify` - Verify attestation signature

### Attestation UI

- `GET /` - Attestation wizard
- `POST /api/attest` - Request attestation (proxies to SP)
- `POST /api/comment` - Post attestation to PR
- `GET /api/comments` - Fetch PR comments

## Environment Variables

### Server

```
SP_PRIVATE_KEY=<hex>     # Ed25519 private key (optional, generates ephemeral if not set)
SP_PUBLIC_KEY=<hex>      # Ed25519 public key
```

### UI

```
GITHUB_TOKEN=<token>     # For posting/reading PR comments
NEXT_PUBLIC_SP_URL=http://localhost:3001
```

## Protocol Compliance

This demo implements:

- **Deploy Gate Profile v0.2** - Frame canonicalization, Decision Owner scopes
- **Attestation format** - Ed25519 signatures, TTL enforcement
- **Multi-person approval** - Role-based attestations aggregated by workflow
- **Cryptographic verification** - Signature verification via deployed service
- **Error codes** - INVALID_SIGNATURE, EXPIRED, FRAME_MISMATCH, etc.

See [Human Agency Protocol](https://humanagencyprotocol.org) for full specification.
