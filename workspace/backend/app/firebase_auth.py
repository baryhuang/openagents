# -*- coding: utf-8 -*-
"""
Firebase token verification for workspace user authentication.

Verifies Firebase ID tokens to identify logged-in users (e.g. on workspace.openagents.org).
Used alongside workspace token auth — not a replacement.
"""

import json
import logging
from typing import Optional

from app.config import config

logger = logging.getLogger(__name__)

_firebase_initialized = False


def _make_noop_credential():
    """Create a minimal Firebase credential for token verification only.

    verify_id_token fetches Google's public certs via HTTP and doesn't need
    real credentials. This avoids ADC lookup failures in Docker/non-GCP envs.
    """
    from firebase_admin import credentials as fb_credentials
    import google.auth.credentials

    class _Cred(fb_credentials.Base):
        def get_credential(self):
            return google.auth.credentials.AnonymousCredentials()

    return _Cred()


def _init_firebase() -> bool:
    """Initialize Firebase Admin SDK. Returns True if successful."""
    global _firebase_initialized
    if _firebase_initialized:
        return True

    try:
        import firebase_admin
        from firebase_admin import credentials

        # Check if already initialized
        try:
            firebase_admin.get_app()
            _firebase_initialized = True
            return True
        except ValueError:
            pass

        if config.FIREBASE_CREDENTIALS_JSON:
            cred_dict = json.loads(config.FIREBASE_CREDENTIALS_JSON)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
        elif config.FIREBASE_PROJECT_ID:
            # No service account — use no-op credential.
            # verify_id_token only needs the project ID + Google's public certs.
            firebase_admin.initialize_app(_make_noop_credential(), options={
                "projectId": config.FIREBASE_PROJECT_ID,
            })
        else:
            logger.info("firebase_auth: No Firebase config, skipping init")
            return False

        _firebase_initialized = True
        logger.info("firebase_auth: Firebase Admin SDK initialized (project=%s)", config.FIREBASE_PROJECT_ID)
        return True
    except Exception as e:
        logger.warning("firebase_auth: Firebase init failed: %s", e)
        return False


def verify_firebase_token(token: str) -> Optional[str]:
    """
    Verify a Firebase ID token and return the user's email.

    Returns None if verification fails or Firebase is not configured.
    """
    if not _init_firebase():
        logger.warning("firebase_auth: Firebase not initialized, cannot verify token")
        return None

    try:
        from firebase_admin import auth
        decoded = auth.verify_id_token(token, check_revoked=False)
        email = decoded.get("email")
        if not email:
            logger.warning("firebase_auth: Token valid but no email claim")
            return None
        logger.info("firebase_auth: Verified token for %s", email)
        return email
    except Exception as e:
        logger.warning("firebase_auth: Token verification failed: %s", e)
        return None
