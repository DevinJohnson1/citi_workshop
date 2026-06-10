"""
Sample code: Hello World with PostgreSQL and MongoDB connectivity.
"""

import json
import logging
import os
from postgres_service import get_postgres_version
# NOTE: mongo_service.py was removed per SYSTEM_DESIGN Appendix B (DocumentDB
# is out of scope). Postgres is the only datastore in v1.

# Configure logging for Lambda
logger = logging.getLogger()

# PostgreSQL connection string built from environment variables with sensible defaults
PG_CONFIG = (
    f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
    f"port={os.getenv('POSTGRES_PORT', '5432')} "
    f"user={os.getenv('POSTGRES_USER', 'test')} "
    f"password={os.getenv('POSTGRES_PASS', 'test')} "
    f"dbname={os.getenv('POSTGRES_NAME', 'test')} "
    f"connect_timeout=15"
)

# MongoDB configuration removed (DocumentDB out of scope; see SYSTEM_DESIGN
# Appendix B). Keep this file Postgres-only.

def handler(event=None, context=None):
    """
    Sample code: Hello World with PostgreSQL and MongoDB connectivity.

    Args:
        event (dict, optional): The Lambda event
        context (object, optional): The Lambda context

    Returns:
        dict: A response object with statusCode, headers, and body
            - statusCode: 200 on success, 500 on error
            - headers: Content-Type set to application/json
            - body: JSON string with database versions or error message
    """
    logger.debug("Received event: %s", event)
    logger.debug("Received context: %s", context)

    try:
        # Retrieve version from Postgres only (MongoDB is out of scope, see Appendix B).
        pg_version = get_postgres_version(PG_CONFIG)

        logger.info("PostgreSQL Version: %s", pg_version)

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "message": "Hello, World!",
                "postgres": pg_version,
            }),
        }
    except Exception as e:
        # Return error response on any exception
        logger.error("Handler error: %s", str(e))
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "error": "Failed to retrieve database versions",
                "message": str(e),
            }),
        }

# Main entry point for local testing
if __name__ == "__main__":
    print(handler())
