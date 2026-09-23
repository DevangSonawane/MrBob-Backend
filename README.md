# Home Services Platform — Backend

Backend API for the Home Services Platform: customer app, professional app, and admin/ops
dashboard all talk to this single service. Built as a **modular monolith** — one deployable
app with hard module boundaries (`auth`, `users`, `professionals`, `bookings`, `dispatch`,
`payments`, `amc`, `reviews`, `zones`, `partners`, `notifications`) so any one of them can be
extracted into its own service later without a rewrite. See the architecture doc for the
full extraction plan (dispatch and payments are the likely first candidates).

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ / Express 5 |
| Database | PostgreSQL via Prisma ORM |
| Auth | Phone + OTP login, JWT access/refresh tokens |
| Validation | Zod |
| Docs | swagger-jsdoc + swagger-ui-express (`/api-docs`) |
| Logging | Pino |
| Payments | Razorpay |
| Notifications | WhatsApp Business API + Firebase Cloud Messaging (stubbed, see below) |
| Local DB | Docker Compose (Postgres) |
| Deploy (now) | Render (`render.yaml` blueprint) |
| Deploy (later) | AWS EC2/ECS, per the architecture doc |
| CI | GitHub Actions (lint + test on PR) |

## Project layout

```
src/
  config/         env, logger, prisma client, swagger spec
  middlewares/     auth (JWT), centralized error handler
  modules/         one folder per module: *.routes.js, *.controller.js, *.service.js, *.schema.js
  routes/          mounts every module's router under API_BASE_PATH
  utils/           ApiError, catchAsync, validate, pagination
  db/seed/         dev seed data (a city, a zone, 3 service categories, an admin user)
  app.js           Express app (middleware pipeline, routes, error handling)
  server.js        process entrypoint, graceful shutdown
prisma/
  schema.prisma    all models, grouped and commented by owning module
```

Each module follows the same shape: `routes.js` (Express Router + `@openapi` JSDoc) →
`controller.js` (thin, calls the service) → `service.js` (business logic, Prisma calls) →
`schema.js` (Zod request schemas used by `validate()`).

## Getting started

### 1. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` and the JWT secrets at minimum. Everything else (Razorpay, Firebase,
WhatsApp, Google Maps, Cloudflare R2) is optional for local dev — each integration falls back
to a logged stub when its keys are unset, so you can build against the API without live
credentials for any of them.

### 3. Start Postgres

Either run Postgres locally, or use Docker Compose:

```bash
docker compose up -d postgres
```

### 4. Run migrations and seed data

```bash
npm run prisma:migrate
npm run seed
```

The seed creates one city (Bengaluru), one zone (Koramangala), three service categories
(Electrician, Plumber, AC Repair), and one admin user (`+919999999999`).

### 5. Run the server

```bash
npm run dev
```

- API base: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/api-docs`
- Health check: `http://localhost:4000/health`

### Full stack via Docker Compose

```bash
docker compose up --build
```

Runs Postgres + the API together; the API container applies migrations on boot.

## Auth flow

Two independent login paths, both issuing the same JWT access (15m) + refresh (30d) token
pair. Send `Authorization: Bearer <accessToken>` on subsequent requests.

**Phone + OTP** (no password):

1. `POST /auth/otp/request { phone }` — generates a 6-digit OTP (5 min TTL). In dev, with no
   `WHATSAPP_API_TOKEN` set, the OTP is written to the server log instead of sent.
2. `POST /auth/otp/verify { phone, otp, name? }` — verifies the OTP, creates the user on first
   login (role `CUSTOMER`).
3. `POST /auth/refresh { refreshToken }` — rotates the token pair.

The OTP store is an in-memory `Map` (`src/modules/auth/otp.store.js`) — fine for a single
dev/staging instance, but swap it for Redis before running more than one instance behind a
load balancer.

**Email + password**:

1. `POST /auth/signup { name, email, password, phone? }` — creates a `CUSTOMER` account
   (password hashed with bcrypt) and logs in immediately.
2. `POST /auth/login { email, password }`.

Either path lands the user in the same place: a `User` row with `isOnboarded: false`.

## Onboarding

After first login (via either path), the client is expected to walk the user through
onboarding before letting them do anything role-specific:

- `GET /onboarding/status` — `{ isOnboarded, role, hasProfessionalProfile }`.
- `POST /onboarding/customer { cityId, name?, phone?, address? }` — fills in the rest of the
  customer profile and sets `isOnboarded: true`.
- `POST /onboarding/professional { cityId, categories[], name?, phone?, homeZoneId? }` —
  creates the `Professional` profile, flips the user's role to `PROFESSIONAL`, and sets
  `isOnboarded: true`. KYC verification happens separately afterwards
  (`PATCH /professionals/{id}/kyc-status`, admin/ops).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon (auto-restart) |
| `npm start` | Start for production |
| `npm run lint` | ESLint |
| `npm run format` | Prettier write |
| `npm test` | Jest + Supertest |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:deploy` | Apply pending migrations (CI/prod) |
| `npm run prisma:studio` | Prisma Studio GUI |
| `npm run seed` | Run `src/db/seed/index.js` |

## Deploying

### Render (current target)

`render.yaml` defines a Postgres instance and a Docker web service with a health check at
`/health`. Push to the connected branch and Render builds from the `Dockerfile`. Secrets not
listed in `render.yaml` (Razorpay, Firebase, WhatsApp, Maps, R2) are set in the Render
dashboard, not committed.

### AWS (future)

The `Dockerfile` is plain multi-stage Node — it runs the same way on EC2/ECS as it does on
Render. When migrating, the only things that change are where `DATABASE_URL` points and how
the container is scheduled; no application code changes are expected.

## Extending a module → extracting a service later

Per the architecture doc's strangler-fig plan: give the module its own Postgres schema first
(no cross-schema joins), extract it into its own service while still reading/writing that
schema, then move the schema to its own database instance. To keep that mechanical:

- Don't import another module's `*.service.js` directly for anything beyond a read — go
  through Prisma the same way a network call would, not through shared in-process state.
- Keep cross-module references as foreign-key IDs, not embedded objects.
- `dispatch` and `payments` are the flagged first candidates — their services
  (`dispatch.service.js`, `payments.service.js`) are already written to only touch their own
  concerns plus read-only lookups.

## Known scaffold gaps (by design, for a first pass)

- OTP store is in-memory (see above) — move to Redis for multi-instance deployments.
- Razorpay, Firebase, WhatsApp, Google Maps, and Cloudflare R2 are wired up with real client
  code but fall back to logged stubs without credentials — add keys to `.env` to go live.
- Dispatch matching is rating-ranked, not geo/ETA-ranked — needs live professional location
  (Firebase presence + Google Maps) before it's real.
- No file upload endpoints yet (job photos, KYC docs) — add an R2-backed upload module when
  the client apps need it.
