# Home Admin

[中文说明](./README.zh-CN.md)

Home Admin is the NestJS backend for the Home self-hosted personal and family admin suite. It powers
a desktop admin console and a mobile H5 app with authentication, RBAC, tasks, insurance records,
family posts, real-time chat, file storage, notifications, automation jobs, and API key based open
APIs.

The project is intentionally practical: one service, one MySQL database, explicit migrations, and a
module structure that is easy to read and extend.

## Why Use It

Most admin starters stop at users, roles, and menus. Home Admin goes further and ships real private
life workflows:

- Personal and family task management with reminders and recurring schedules.
- Household insurance records with members, attachments, payment dates, and expiry reminders.
- Family circle posts and real-time chat with image/video media.
- Local or OSS-backed file storage with private access links.
- Internal notifications plus optional Bark and Feishu delivery.
- API app/key management for controlled integrations.
- Automation tasks that can be configured, run manually, and audited.

It is a good base if you want a self-hosted admin system that is already useful on day one, while
remaining small enough for a personal deployment.

## Feature Highlights

### Auth and RBAC

- JWT access tokens and refresh tokens.
- Persistent refresh-token revocation and cleanup.
- First-run super admin bootstrap with a one-time generated password in logs.
- Users, roles, menus, and permissions.
- Role access assignment for permissions and menus.
- Deny-by-default permission guard: routes must be public, authenticated-only, or explicitly
  permissioned.

### Tasks

- Task lists with active/archive state.
- Tasks, anniversaries, due dates, assignees, tags, important/urgent flags.
- Check items and attachments.
- Complete, reopen, delete, and reminder snooze flows.
- Recurrence support: daily, weekly, monthly, yearly, weekdays, and custom intervals.
- Continuous reminders and scheduled due-reminder delivery.

### Family Insurance

- Insurance members and relationships.
- Policies with company, policy number, type, effective date, expiry date, payment date, amount,
  owner, notes, and attachments.
- Family overview API.
- Expiry and payment reminder jobs.

### Family Circle and Chat

- Family posts with text, image/video media, comments, nested replies, and likes.
- Family chat messages with media.
- Socket.IO gateway for real-time post, comment, like, chat, and notification refresh events.
- Local upload and OSS direct-upload paths for family media.

### Files

- Local disk storage by default.
- Optional Aliyun OSS storage.
- Normal multipart upload and OSS browser direct upload.
- Public downloads, permission-protected downloads, and temporary private access links.
- Module tags for user avatars, documents, videos, insurance policies, task attachments, and more.

### Notifications

- Internal notification records with type, priority, unread/read state, and links.
- Unread list, mark one read, and mark all read APIs.
- Optional Bark and Feishu channels.

### API Apps and Open APIs

- API applications with scoped API keys.
- One-time raw key generation.
- API key guard and scope decorators.
- Open APIs are thin adapters over existing services, with independent DTOs and explicit scopes.
- Access logs with path, status, key, and request metadata.
- Open API scope discovery for frontend integration docs.
- Current open API: public user list at `/api/v1/open/users`.

### Automation

- Configurable cron tasks stored in the database.
- Manual run endpoint.
- Execution logs and last-run status.
- Built-in jobs:
  - Clean expired refresh tokens.
  - Send due task reminders.
  - Send insurance reminders.

## Tech Stack

- NestJS 11
- TypeScript 5.8
- TypeORM 0.3
- MySQL 8
- Passport JWT and custom API key strategy
- Socket.IO
- Nest Schedule
- Swagger/OpenAPI
- Winston logging
- Jest and Supertest

## Requirements

- Node.js 20+
- pnpm 10 recommended
- MySQL 8

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm migration:run:ts
pnpm start:dev
```

The API runs at:

```text
http://localhost:3000/api/v1
```

Health endpoints are not versioned:

```text
http://localhost:3000/healthz
http://localhost:3000/readyz
```

On a fresh database, the app creates an `admin` account and logs a generated password once. Read the
startup logs immediately, log in, and change the password.

## Configuration

Start from `.env.example`. Important settings:

```bash
NODE_ENV=development
PORT=3000
API_PREFIX=api
API_VERSION=1

DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=home

JWT_SECRET=dev-secret-key-change-this-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-key-change-this-in-production

FILE_STORAGE=local
FILE_UPLOAD_DIR=uploads
FILE_BASE_URL=/api/v1/files
FILE_OSS_BASE_URL=

SWAGGER_ENABLE=true
TRUST_PROXY=false
```

Production notes:

- Use strong, different `JWT_SECRET` and `JWT_REFRESH_SECRET` values.
- Keep `SWAGGER_ENABLE=false` in production.
- Keep `DB_SYNCHRONIZE` disabled. Schema changes are managed through migrations.
- Enable `TRUST_PROXY=true` only behind a trusted reverse proxy.
- Use `FILE_STORAGE=oss` only after OSS variables are configured.
- Set `FILE_OSS_BASE_URL` to a CDN/custom domain only for OSS reads; direct browser uploads still use
  `FILE_OSS_ENDPOINT`.

## Useful Commands

```bash
pnpm start:dev              # Watch-mode development server
pnpm build                  # Compile NestJS
pnpm start:prod             # Run compiled app
pnpm test                   # Jest unit tests
pnpm test:e2e               # E2E tests
pnpm test:env:up            # Start MySQL test environment
pnpm test:env:down          # Stop MySQL test environment
pnpm migration:generate     # Generate a TypeORM migration
pnpm migration:run:ts       # Run migrations from TypeScript sources
pnpm migration:run          # Run compiled migrations
pnpm migration:revert       # Revert the latest compiled migration
pnpm lint                   # ESLint
```

## Project Structure

```text
src/
  app.module.ts
  main.ts
  bootstrap/          App bootstrap, CORS, Swagger, validation, security setup
  common/             DTOs, exceptions, enums, utilities
  config/             Environment parsing, validation, TypeORM data source
  core/               Guards, decorators, filters, interceptors, base entities
  migrations/         Explicit database migrations
  modules/
    api-auth/         API apps, API keys, scopes, access logs
    auth/             Login, refresh, logout, token cleanup
    automation/       Cron definitions, configs, logs, executor
    family/           Posts, comments, likes, media, chat, websocket gateway
    file/             Storage abstraction, local storage, OSS storage
    health/           Health and readiness endpoints
    insurance/        Members, policies, attachments, reminders
    menu/             Dynamic menu tree and user menus
    notification/     Internal notifications and push channels
    open-api/         API-key protected external APIs
    permission/       Permission catalog
    role/             Roles and role access assignment
    task/             Task lists, tasks, reminders
    user/             Users, profile, bootstrap admin
  shared/             Cache, database module, logger
test/                 E2E tests and helpers
```

## API Shape

The app uses a global response envelope for successful JSON responses:

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-05-06T00:00:00.000Z",
  "path": "/api/v1/...",
  "method": "GET",
  "requestId": "..."
}
```

Validation uses `whitelist`, `forbidNonWhitelisted`, and implicit conversion. API versioning is URI
based, so controllers are served under `/api/v1` by default.

When Swagger is enabled, docs are available at:

```text
http://localhost:3000/api-docs
```

## API Key Usage

Create an API app in the admin UI or through the API, generate a key, store the raw key immediately,
and call open APIs with:

```http
X-API-Key: sk_live_xxx
```

Scopes are discovered from open API decorators and checked by the API key guard.

## Docker

The backend image builds the NestJS app, installs production dependencies, runs migrations on
container startup, and starts `dist/main`.

From the workspace root, Docker Compose can run MySQL, the backend, and `home-web` together:

```bash
docker compose --env-file .env.local up --build
```

By default the compose stack exposes:

```text
Web:  http://127.0.0.1:8088
API:  http://127.0.0.1:3002/api/v1
MySQL: 127.0.0.1:3307
```

## Testing

```bash
pnpm test
pnpm test:env:up
pnpm test:e2e
pnpm lint
pnpm build
```

Unit tests cover services, DTOs, guards, storage, configuration, and utilities. E2E tests cover core
API flows such as auth, users, roles, menus, permissions, files, notifications, automation, and API
auth.

## Design Boundaries

Home Admin is optimized for a personal, single-instance deployment. It deliberately avoids
distributed locks, distributed cache, multi-service architecture, organization/department platforms,
workflow engines, and generic enterprise abstractions unless they become necessary for the project.

That makes it easier to understand, deploy, and extend for self-hosted use.
