# Shared helpers for backend Lambda services

> **Spec:** these helpers implement the contracts in
> [`../../SYSTEM_DESIGN.md`](../../SYSTEM_DESIGN.md) §5 (modules) and §9
> (security). Don't add helpers here that aren't required by the spec.

This package is **not** a Lambda. It holds the small set of utilities that every
service imports:

| Module          | Purpose                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `http.py`       | Function URL v2.0 response builders, CORS headers, JSON body parsing.            |
| `db.py`         | Module-level cached `psycopg` connection + `transaction()` + `audit()` helpers.  |
| `auth.py`       | Cognito JWT verification (cached JWKS), `current_user`, `require_role` decorator.|
| `validation.py` | `StrictModel` (pydantic v2 with `extra='forbid'`) + first-error formatter.       |
| `projects.py`   | Shared project-membership / ownership checks used by multiple services.           |

`bin/deploy-backend.sh` runs `rsync -a --delete backend/_lib/ backend/<svc>/_lib/`
before `terraform apply` so every Lambda zip contains its own copy. The copied
folders are gitignored.

Do not import anything from `_lib` outside `backend/<svc>/` — the underscore
prefix is what excludes it from Terraform service discovery
(`infra/locals.tf`).
