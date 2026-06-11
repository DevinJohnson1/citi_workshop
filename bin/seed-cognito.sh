#!/usr/bin/env bash
# Script:  Cognito Seed Users
# Purpose: Create the canonical workshop personas plus a realistic roster of
#          team leads and team members in the deployed Cognito user pool.
#          Idempotent: re-running is a no-op for users that already exist.
# Usage:   ./bin/seed-cognito.sh [local|aws]   (default: local)
#
# The matching role assignment on the backend side lives in
# backend/_lib/auth.py (_SEED_ROLES). Keep the email list in sync there.
#
# Password policy notes:
#   * The four legacy "@workshop.local" personas share \$WORKSHOP_PASSWORD
#     (default "Workshop!2026") so the LoginPage quick-sign-in buttons keep
#     working in the dev loop. They are skipped on TARGET=aws unless the
#     operator both supplies a custom WORKSHOP_PASSWORD and exports
#     SEED_INCLUDE_WORKSHOP=true. The matching frontend toggle is
#     VITE_SEED_LOGIN_ENABLED (set "false" on aws by bin/generate-env.sh).
#   * The 40 ACME roster accounts (10 team_lead + 30 team_member) each get a
#     unique 20-character alphanumeric password (~119 bits of entropy, well
#     above the requested 100-bit floor). Charset is [A-Za-z0-9] only — no
#     quote, semicolon, comment, or backslash characters that could carry a
#     SQL-injection payload through a vulnerable form.

set -euo pipefail

TARGET="${1:-local}"
PASSWORD="${WORKSHOP_PASSWORD:-Workshop!2026}"

# When seeding into a real AWS pool we refuse to plant the four shared
# "@workshop.local" personas, and we refuse to use the default shared
# password — both are research-grade conveniences and have no business in
# production. Override either by exporting:
#   SEED_INCLUDE_WORKSHOP=true   # re-enable the four personas on AWS
#   WORKSHOP_PASSWORD=<strong>   # supply your own >=14-char passphrase
SEED_INCLUDE_WORKSHOP="${SEED_INCLUDE_WORKSHOP:-}"
if [ "$TARGET" = "aws" ]; then
    if [ -z "$SEED_INCLUDE_WORKSHOP" ]; then
        SEED_INCLUDE_WORKSHOP="false"
    fi
    if [ "$SEED_INCLUDE_WORKSHOP" = "true" ] && [ "$PASSWORD" = "Workshop!2026" ]; then
        echo "ERROR: refusing to seed @workshop.local accounts on AWS with the"
        echo "       default password 'Workshop!2026'. Re-run with:"
        echo "         WORKSHOP_PASSWORD='<strong-passphrase>' \\"
        echo "         SEED_INCLUDE_WORKSHOP=true ./bin/seed-cognito.sh aws"
        exit 2
    fi
else
    SEED_INCLUDE_WORKSHOP="${SEED_INCLUDE_WORKSHOP:-true}"
fi

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    cat <<USAGE
Usage: bin/seed-cognito.sh [local|aws]

LocalStack (default): seeds the four @workshop.local personas (shared
password \$WORKSHOP_PASSWORD, default: Workshop!2026) PLUS the 40 @acme.org
roster accounts (each gets a unique 20-char alphanumeric password printed
at the end of the run).

AWS: only the 40 @acme.org roster accounts are seeded. The four shared
@workshop.local personas are skipped because they share the same insecure
password and are the targets of the dev-only quick-sign-in shortcut on the
login page (controlled by VITE_SEED_LOGIN_ENABLED — set to "false" on AWS
by bin/generate-env.sh).

Environment overrides:
  WORKSHOP_PASSWORD=<strong>   Override the shared @workshop.local password.
                               Required when SEED_INCLUDE_WORKSHOP=true on AWS;
                               the script refuses to plant 'Workshop!2026'
                               into a real pool.
  SEED_INCLUDE_WORKSHOP=true   Force-seed the four @workshop.local personas
                               on AWS as well (only honoured with a non-default
                               WORKSHOP_PASSWORD).

Re-running the script is safe; existing users are left alone.
USAGE
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1; pwd -P)"
INFRA_DIR="$PROJECT_ROOT/infra"

command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI is missing"; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "ERROR: terraform is missing"; exit 1; }

# Point the AWS CLI at LocalStack for the "local" target so we don't accidentally
# create users in a real AWS account when the developer has stale creds.
if [ "$TARGET" = "local" ]; then
    export AWS_ENDPOINT_URL="http://localhost:4566"
    # AWS_ENDPOINT_URL_S3 is required for Terraform ≥1.13 S3 backend reads.
    export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
    export AWS_ACCESS_KEY_ID="test"
    export AWS_SECRET_ACCESS_KEY="test"
    export AWS_REGION="${AWS_REGION:-us-east-1}"
    unset AWS_SESSION_TOKEN
fi

cd "$INFRA_DIR"
POOL_ID="$(terraform output -raw cognito_user_pool_id 2>/dev/null || true)"
if [ -z "$POOL_ID" ]; then
    echo "WARNING: cognito_user_pool_id is empty — Cognito is not deployed."
    echo "         Either run ./bin/deploy-backend.sh first, or (on LocalStack"
    echo "         Community) set TF_VAR_enable_cognito=false and skip this step."
    exit 0
fi

echo "==================================="
echo "Coding Workshop - Cognito Seed"
echo "==================================="
echo "INFO: target=$TARGET pool=$POOL_ID"

# email|role|password triples. Roles are advisory metadata; the source of
# truth is backend/_lib/auth.py (_SEED_ROLES) — kept in sync by convention.
#
# The four "@workshop.local" personas reuse $PASSWORD for backwards-compat
# with workshop docs. The 40 "@acme.org" roster accounts each carry a unique
# 20-char alphanumeric password (~119 bits of entropy). Regenerate with:
#   python3 -c "import secrets,string; \
#       a=string.ascii_letters+string.digits; \
#       print(''.join(secrets.choice(a) for _ in range(20)))"
SEED_USERS=()

# --- Four legacy workshop personas (LocalStack / dev pools only) -----------
# Skipped automatically when TARGET=aws unless SEED_INCLUDE_WORKSHOP=true is
# exported alongside a non-default WORKSHOP_PASSWORD. These four accounts
# share $PASSWORD on purpose — they're the targets of the LoginPage quick-
# sign-in buttons (gated by VITE_SEED_LOGIN_ENABLED) and have no place in
# a production user pool.
if [ "$SEED_INCLUDE_WORKSHOP" = "true" ]; then
    SEED_USERS+=(
        "admin@workshop.local|admin|$PASSWORD"
        "lead@workshop.local|team_lead|$PASSWORD"
        "member@workshop.local|team_member|$PASSWORD"
        "viewer@workshop.local|viewer|$PASSWORD"
    )
else
    echo "INFO: skipping @workshop.local personas (TARGET=$TARGET, SEED_INCLUDE_WORKSHOP=$SEED_INCLUDE_WORKSHOP)"
fi

# --- ACME roster (always seeded) -------------------------------------------
# Each row carries a unique 20-char alphanumeric password (~119 bits of
# entropy). Regenerate with:
#   python3 -c "import secrets,string; \
#       a=string.ascii_letters+string.digits; \
#       print(''.join(secrets.choice(a) for _ in range(20)))"
SEED_USERS+=(
    # --- ACME team leads (10) ---
    "olivia.bennett@acme.org|team_lead|NfCEQuxHSUXUslV9p3eW"
    "marcus.chen@acme.org|team_lead|207Ltb2c5Y5tUTRqbDa3"
    "priya.raman@acme.org|team_lead|4yU0CHxqAHWHWVFANq5n"
    "jonas.weber@acme.org|team_lead|4YhMtx5DM3uk6qB1kIqT"
    "amelia.foster@acme.org|team_lead|C6m1CIAUHStdbLQoulM5"
    "diego.alvarez@acme.org|team_lead|cRuxPAjV8DfoCdxKTAFo"
    "sasha.petrova@acme.org|team_lead|GA03SBVa0Gde1geHq5We"
    "ravi.subramanian@acme.org|team_lead|IyKsS7Wi0aExlNU7cSOg"
    "hannah.klein@acme.org|team_lead|kmS0IRruGDyQ1shEfyRq"
    "tobias.larsen@acme.org|team_lead|xPhIm37CMAs614BmE0S0"

    # --- ACME team members (30) ---
    "liam.carter@acme.org|team_member|ypL0bitljzWdnUUJyGSA"
    "emma.donovan@acme.org|team_member|nXnR6wBt1ylDEBEtdOrx"
    "noah.patel@acme.org|team_member|mGOsLu7nCaravkpsCxPc"
    "ava.rodriguez@acme.org|team_member|BvGlUx94yHuEdtjbRS5g"
    "ethan.nakamura@acme.org|team_member|au9XsZDv50XVcokXlg74"
    "mia.johansson@acme.org|team_member|Sf1aTsW3ixo59kDkrjLH"
    "lucas.brennan@acme.org|team_member|H0vvw0gWFDovmfdLHrOy"
    "sophia.mwangi@acme.org|team_member|RP2QgdibL6dyD8cGkhfa"
    "mason.reilly@acme.org|team_member|BbUgMir40p3eMD5H6GbR"
    "isabella.park@acme.org|team_member|t50e2CdjH8PphSlv1ig0"
    "logan.whitaker@acme.org|team_member|6VUP6IX74p0IdRWzKCdv"
    "charlotte.singh@acme.org|team_member|icaL0JQ2XN66IjMk4SYx"
    "benjamin.holloway@acme.org|team_member|NYUVNEcdBH88d9tUQBym"
    "amelia.castillo@acme.org|team_member|0rEDDeEjDNf4CaoM9BTB"
    "elijah.okafor@acme.org|team_member|xMa0imgmIfwznM0fKQyw"
    "harper.lindgren@acme.org|team_member|OMJHlhRxI8kFCkpilvoQ"
    "james.underwood@acme.org|team_member|w6bqO1b8sUIcuE5q3mFK"
    "evelyn.tanaka@acme.org|team_member|nUWBOcSUjpCTQjtJ7IIL"
    "alexander.boyd@acme.org|team_member|C3Q5DIZ0gnHWjl2hK0Bg"
    "abigail.fischer@acme.org|team_member|sk0bDLdSRiFoLfPuQffN"
    "daniel.romano@acme.org|team_member|4O3hoP9pwmaPACygU96N"
    "emily.hartman@acme.org|team_member|yhdIbSRmPSW4RAVaCUui"
    "henry.delacroix@acme.org|team_member|1JL0BQyDsIa9pYvylyIu"
    "scarlett.novak@acme.org|team_member|e9t8RtUspO8iK0j5z8CO"
    "sebastian.ortega@acme.org|team_member|WkNM2t8IqBNaxyjBzbza"
    "lily.karlsson@acme.org|team_member|bBpk1QErFwnyoglRJY8n"
    "jackson.ibarra@acme.org|team_member|XLfaSULdFBC7Vw9uBcnz"
    "grace.sullivan@acme.org|team_member|7PFKHb586nmdPN0WgIUJ"
    "owen.marchetti@acme.org|team_member|fqbFL85Mr0rx3L3CJzWa"
    "zoe.halvorsen@acme.org|team_member|8pCKfzS42gNBIizTpGGa"
)

for entry in "${SEED_USERS[@]}"; do
    email="${entry%%|*}"
    rest="${entry#*|}"
    role="${rest%%|*}"
    user_password="${rest#*|}"

    if aws cognito-idp admin-get-user \
            --user-pool-id "$POOL_ID" --username "$email" \
            >/dev/null 2>&1; then
        echo "  ✓ $email already exists (role=$role)"
        continue
    fi

    aws cognito-idp admin-create-user \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --user-attributes "Name=email,Value=$email" "Name=email_verified,Value=true" \
        --message-action SUPPRESS \
        >/dev/null
    aws cognito-idp admin-set-user-password \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --password "$user_password" \
        --permanent \
        >/dev/null
    echo "  + $email created (role=$role)"
done

echo ""
echo "Sign in at http://localhost:3000/login with any of:"
for entry in "${SEED_USERS[@]}"; do
    email="${entry%%|*}"
    rest="${entry#*|}"
    role="${rest%%|*}"
    user_password="${rest#*|}"
    printf "    %-35s  role=%-12s  password: %s\n" "$email" "$role" "$user_password"
done
echo ""

