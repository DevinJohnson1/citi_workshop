# Shared helpers for backend Lambda services

This package is **not** a Lambda. It holds the small set of utilities that every
service imports:

| Module          | Purpose                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `http.py`       | Function URL v2.0 response builders, CORS headers, JSON body parsing.            |
| `db.py`         | Module-level cached `psycopg` connection + `transaction()` + `audit()` helpers.  |
| `auth.py`       | Cognito JWT verification (cached JWKS), `current_user`, `require_role` decorator.|
| `validation.py` | `StrictModel` (pydantic v2 with `extra='forbid'`) + first-error formatter.       |

`bin/deploy-backend.sh` runs `rsync -a --delete backend/_lib/ backend/<svc>/_lib/`
before `terraform apply` so every Lambda zip contains its own copy. The copied
folders are gitignored.

Do not import anything from `_lib` outside `backend/<svc>/` — the underscore
prefix is what excludes it from Terraform service discovery
(`infra/locals.tf`).

