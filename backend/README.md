# Backend

> **Spec:** every rule below is a summary of
> [`../SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md) §0, §4, §6, §7. When this README
> and `SYSTEM_DESIGN.md` disagree, `SYSTEM_DESIGN.md` wins.

Eight Python 3.11 Lambdas behind a CloudFront distribution. **One Lambda per
service** — `backend/<svc>/function.py` is auto-discovered by `infra/locals.tf`
and gets its own Function URL plus `/api/<svc>*` CloudFront behavior. No web
framework on Lambda; dispatch on
`event["requestContext"]["http"]["method"]` and `event["rawPath"]`.

## Services

| Folder                  | Purpose                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `projects-service/`     | CRUD on `projects`; search by name; at-risk filter.                                                      |
| `deliverables-service/` | CRUD on `deliverables`; `?assigned_to=` joins `assignments`; server-side DAG validation on `depends_on`. |
| `assignments-service/`  | Many-to-many deliverable ↔ user with `role_on_assignment`.                                               |
| `resources-service/`    | Read / edit staffing metadata on `users WHERE is_allocatable=true`.                                      |
| `equipment-service/`    | CRUD on `equipment` (free-form `kind`); approval workflow on team-member writes.                         |
| `allocations-service/`  | Project-level capacity; warns on over-allocation; approval workflow on team-member self-requests.        |
| `budget-service/`       | Singular per-project ceiling on `projects.budget_amount`; live consumption rollup from assigned equipment. |
| `reports-service/`      | Read-only rollups for the 7 workshop questions.                                                          |
| `migrate-service/`      | Internal-only Lambda that applies bundled `_migrations/*.sql` in lex order, one transaction per file.    |

## Shared code

`_lib/` (underscore prefix → excluded from discovery) is the only code each
service may import. `bin/deploy-backend.sh` rsyncs `_lib/` into every service
folder before `terraform apply`, so each Lambda zip ships with its own copy.
Per-service copies are gitignored.

| Module               | Responsibility                                                                  |
| -------------------- | ------------------------------------------------------------------------------- |
| `_lib/auth.py`       | Cognito JWT verification (cached JWKS), `current_user`, `require_role`.         |
| `_lib/db.py`         | Module-level cached psycopg connection, `transaction()`, `audit()`.             |
| `_lib/http.py`       | Function URL response builders, CORS, OPTIONS short-circuit, JSON body parsing. |
| `_lib/validation.py` | `StrictModel` (pydantic v2 with `extra='forbid'`) + first-error formatter.      |

## Database

DDL lives in `_db/migrations/NNN_*.sql`. Files are idempotent
(`CREATE … IF NOT EXISTS`, `CREATE OR REPLACE TRIGGER`), so `bin/migrate.sh`
can be re-run safely. Migrations are applied automatically at the end of
`bin/deploy-backend.sh`; to re-run on demand:

```bash
./bin/migrate.sh local     # or `aws`
```

Schema is 3NF — see [`SYSTEM_DESIGN.md` §6](../SYSTEM_DESIGN.md) for the
canonical DDL + ERD. Highlights:

- Single identity table (`users`); `is_allocatable` flags staffable users.
- `assignments` is the M:N table for both team leads and team members;
  `role_on_assignment` differentiates `owner` / `contributor` / `reviewer`.
- Budget is a singular ceiling on `projects.budget_amount` /
  `budget_currency`; the only thing that draws against it is `equipment.cost`
  on tangibles / intangibles assigned to the project, and the
  `equipment-service` enforces the ceiling on create / patch.
- `audit_log` is append-only; every mutation writes a row.

## Adding a service

```bash
cp -r backend/_examples/python-service backend/my-svc-service
cd backend/my-svc-service
# 1. Rewrite function.py using the dispatch pattern from projects-service.
# 2. Pin pydantic, psycopg, PyJWT in requirements.txt.
# 3. Re-run ./bin/deploy-backend.sh local
```

Terraform auto-discovers the new folder, builds a Function URL, and adds the
matching `/api/my-svc-service*` CloudFront behavior.

## Conventions

- Dispatch with plain `if method == … and parts == …`. No FastAPI / Flask / Django.
- All SQL is parameterized (`cur.execute(sql, (a, b))`); never f-string into SQL.
- Use `db.transaction()` around every mutation, and call `db.audit(…)` inside it.
- Return errors via `_lib.http.{bad_request, unauthorized, forbidden, not_found, error}` only.
- Never leak stack traces, file paths, or SQL to the client — log to CloudWatch.
