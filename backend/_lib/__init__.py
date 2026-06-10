"""Shared helpers for ACME Project Tracker Lambda services.

This package is copied verbatim into every ``backend/<service>/`` directory
by ``bin/deploy-backend.sh`` before ``terraform apply`` so each Lambda ships
with its own copy (no symlinks — they break on Windows).
"""

