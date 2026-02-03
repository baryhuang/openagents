"""Tests for the agentid client module."""

import pytest
import base64
from unittest.mock import AsyncMock, MagicMock, patch
from openagents.agentid.client import AgentIDVerifier, AgentIDAuth
from openagents.agentid.models import (
    VerificationResult,
    AgentInfo,
    ChallengeResponse,
    TokenResponse,
    DIDDocument,
    TokenValidationResult,
    AgentIDLevel,
)
from openagents.agentid.exceptions import (
    AgentIDNotFoundError,
    AgentIDConnectionError,
    AgentIDSignatureError,
    AgentIDChallengeExpiredError,
)


class AsyncContextManagerMock:
    """Helper to create async context manager mocks."""

    def __init__(self, return_value):
        self.return_value = return_value

    async def __aenter__(self):
        return self.return_value

    async def __aexit__(self, *args):
        pass


class TestAgentIDVerifier:
    """Tests for AgentIDVerifier class."""

    @pytest.fixture
    def client(self):
        """Create a test client."""
        return AgentIDVerifier(endpoint="https://test.example.com")

    @pytest.mark.asyncio
    async def test_validate_async_success(self, client):
        """Test successful verification."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "code": 200,
            "data": {
                "agentName": "my-agent",
                "org": "my-org",
                "status": "active",
            }
        })

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.validate_async("openagents:my-agent@my-org")

            assert result.verified is True
            assert result.agent_name == "my-agent"
            assert result.org == "my-org"
            assert result.level == AgentIDLevel.LEVEL_2

    @pytest.mark.asyncio
    async def test_validate_async_not_found(self, client):
        """Test verification when agent not found."""
        mock_response = MagicMock()
        mock_response.status = 404
        mock_response.json = AsyncMock(return_value={
            "code": 404,
            "message": "Agent not found"
        })

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.validate_async("openagents:unknown-agent")

            assert result.verified is False
            assert result.agent_name == "unknown-agent"

    @pytest.mark.asyncio
    async def test_get_agent_info_async_success(self, client):
        """Test getting agent info successfully."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "code": 200,
            "data": {
                "agentName": "my-agent",
                "org": "my-org",
                "status": "active",
                "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
                "serial": "ABC123",
                "algorithm": "RS256",
            }
        })

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.get_agent_info_async("my-agent", org="my-org")

            assert isinstance(result, AgentInfo)
            assert result.agent_name == "my-agent"
            assert result.org == "my-org"
            assert result.status == "active"
            assert result.algorithm == "RS256"

    @pytest.mark.asyncio
    async def test_get_agent_info_async_not_found(self, client):
        """Test getting agent info when not found."""
        mock_response = MagicMock()
        mock_response.status = 404
        mock_response.json = AsyncMock(return_value={
            "code": 404,
            "message": "Agent not found"
        })

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            with pytest.raises(AgentIDNotFoundError):
                await client.get_agent_info_async("unknown-agent")

    @pytest.mark.asyncio
    async def test_request_challenge_async_success(self, client):
        """Test requesting a challenge successfully."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "code": 200,
            "data": {
                "challenge": base64.b64encode(b"test-challenge").decode(),
                "nonce": "test-nonce-123",
                "algorithm": "RS256",
                "expiresIn": 300,
            }
        })

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.request_challenge_async("my-agent", org="my-org")

            assert isinstance(result, ChallengeResponse)
            assert result.nonce == "test-nonce-123"
            assert result.algorithm == "RS256"
            assert result.expires_in == 300

    @pytest.mark.asyncio
    async def test_get_token_async_success(self, client):
        """Test getting a token successfully."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "code": 200,
            "data": {
                "accessToken": "eyJ...",
                "tokenType": "bearer",
                "expiresIn": 899,
                "verificationLevel": 2,
            }
        })

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.get_token_async(
                "my-agent",
                nonce="test-nonce",
                signature="test-signature",
                org="my-org"
            )

            assert isinstance(result, TokenResponse)
            assert result.access_token == "eyJ..."
            assert result.token_type == "bearer"
            assert result.expires_in == 899
            assert result.verification_level == 2

    @pytest.mark.asyncio
    async def test_get_token_async_signature_invalid(self, client):
        """Test getting a token with invalid signature."""
        mock_response = MagicMock()
        mock_response.status = 401
        mock_response.json = AsyncMock(return_value={
            "code": 401,
            "message": "Signature verification failed"
        })

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            with pytest.raises(AgentIDSignatureError):
                await client.get_token_async(
                    "my-agent",
                    nonce="test-nonce",
                    signature="invalid-signature",
                )

    @pytest.mark.asyncio
    async def test_get_token_async_challenge_expired(self, client):
        """Test getting a token with expired challenge."""
        mock_response = MagicMock()
        mock_response.status = 401
        mock_response.json = AsyncMock(return_value={
            "code": 401,
            "message": "Challenge has expired"
        })

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            with pytest.raises(AgentIDChallengeExpiredError):
                await client.get_token_async(
                    "my-agent",
                    nonce="expired-nonce",
                    signature="test-signature",
                )

    @pytest.mark.asyncio
    async def test_verify_token_async_valid(self, client):
        """Test validating a valid token."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "code": 200,
            "data": {
                "valid": True,
                "agentName": "my-agent",
                "org": "my-org",
                "verificationLevel": 2,
            }
        })

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.verify_token_async("eyJ...")

            assert isinstance(result, TokenValidationResult)
            assert result.valid is True
            assert result.agent_name == "my-agent"

    @pytest.mark.asyncio
    async def test_verify_token_async_invalid(self, client):
        """Test validating an invalid token."""
        mock_response = MagicMock()
        mock_response.status = 401
        mock_response.json = AsyncMock(return_value={
            "code": 401,
            "message": "Token expired"
        })

        mock_session = MagicMock()
        mock_session.post = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.verify_token_async("expired-token")

            assert result.valid is False
            assert result.reason == "Token expired"

    @pytest.mark.asyncio
    async def test_resolve_did_async_success(self, client):
        """Test resolving a DID successfully."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "code": 200,
            "data": {
                "@context": ["https://www.w3.org/ns/did/v1"],
                "id": "did:openagents:my-agent@my-org",
                "verificationMethod": [{
                    "id": "did:openagents:my-agent@my-org#key-1",
                    "type": "RsaVerificationKey2018",
                    "controller": "did:openagents:my-agent@my-org",
                    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
                }],
                "authentication": ["did:openagents:my-agent@my-org#key-1"],
            }
        })

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=AsyncContextManagerMock(mock_response))

        with patch.object(client, '_get_session', new=AsyncMock(return_value=mock_session)):
            result = await client.resolve_did_async("did:openagents:my-agent@my-org")

            assert isinstance(result, DIDDocument)
            assert result.id == "did:openagents:my-agent@my-org"
            assert len(result.verification_method) == 1
            assert result.agent_name == "my-agent"
            assert result.org == "my-org"


class TestAgentIDAuth:
    """Tests for AgentIDAuth class."""

    def test_init_with_path(self, tmp_path):
        """Test initialization with private key path."""
        key_file = tmp_path / "key.pem"
        key_file.write_text("-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----")

        auth = AgentIDAuth(
            agent_name="my-agent",
            org="my-org",
            private_key_path=str(key_file),
        )

        assert auth.agent_name == "my-agent"
        assert auth.org == "my-org"
        assert auth.algorithm == "RS256"

    def test_init_with_pem(self):
        """Test initialization with private key PEM string."""
        pem = "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----"

        auth = AgentIDAuth(
            agent_name="my-agent",
            private_key_pem=pem,
        )

        assert auth.agent_name == "my-agent"

    def test_init_without_key_raises(self):
        """Test that initialization without key raises error."""
        with pytest.raises(ValueError):
            AgentIDAuth(agent_name="my-agent")

    def test_sign_challenge_rsa(self, tmp_path):
        """Test signing a challenge with RSA key."""
        # Generate a test RSA key
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        key_file = tmp_path / "key.pem"
        key_file.write_bytes(pem)

        auth = AgentIDAuth(
            agent_name="my-agent",
            private_key_path=str(key_file),
            algorithm="RS256",
        )

        challenge = base64.b64encode(b"test-challenge").decode()
        signature = auth.sign_challenge(challenge)

        # Signature should be base64 encoded
        assert isinstance(signature, str)
        # Should be able to decode it
        sig_bytes = base64.b64decode(signature)
        assert len(sig_bytes) > 0

    @pytest.mark.asyncio
    async def test_get_token_async(self, tmp_path):
        """Test the complete authentication flow."""
        # Generate a test RSA key
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        key_file = tmp_path / "key.pem"
        key_file.write_bytes(pem)

        auth = AgentIDAuth(
            agent_name="my-agent",
            org="my-org",
            private_key_path=str(key_file),
        )

        # Mock the client methods
        challenge = ChallengeResponse(
            challenge=base64.b64encode(b"test-challenge").decode(),
            nonce="test-nonce",
            algorithm="RS256",
            expires_in=300,
        )

        token = TokenResponse(
            access_token="eyJ...",
            token_type="bearer",
            expires_in=899,
            verification_level=2,
        )

        auth.client.request_challenge_async = AsyncMock(return_value=challenge)
        auth.client.get_token_async = AsyncMock(return_value=token)

        result = await auth.get_token_async()

        assert result.access_token == "eyJ..."
        assert result.expires_in == 899

        # Verify the client methods were called correctly
        auth.client.request_challenge_async.assert_called_once_with(
            "my-agent", org="my-org", algorithm="RS256"
        )
        auth.client.get_token_async.assert_called_once()
