"""Tests for the agentid parser module."""

import pytest
from openagents.agentid.parser import (
    parse_agent_id,
    normalize_to_level2,
    normalize_to_level3,
    normalize_to_simple,
    extract_components,
    is_valid_agent_id,
    get_format,
    validate_agent_name,
    validate_org_name,
)
from openagents.agentid.models import AgentIDFormat
from openagents.agentid.exceptions import AgentIDFormatError


class TestValidateAgentName:
    """Tests for validate_agent_name function."""

    def test_valid_names(self):
        """Valid agent names should pass validation."""
        valid_names = [
            "abc",  # minimum length
            "my-agent",
            "my_agent",
            "myAgent123",
            "agent-123-test",
            "a" * 64,  # maximum length
        ]
        for name in valid_names:
            assert validate_agent_name(name), f"'{name}' should be valid"

    def test_invalid_names(self):
        """Invalid agent names should fail validation."""
        invalid_names = [
            "",  # empty
            "ab",  # too short
            "a" * 65,  # too long
            "-agent",  # starts with hyphen
            "_agent",  # starts with underscore
            "agent!",  # invalid character
            "agent name",  # space
            "agent@org",  # @ is not allowed in name
        ]
        for name in invalid_names:
            assert not validate_agent_name(name), f"'{name}' should be invalid"


class TestValidateOrgName:
    """Tests for validate_org_name function."""

    def test_valid_orgs(self):
        """Valid organization names should pass validation."""
        valid_orgs = [
            "abc",
            "my-org",
            "my_org",
            "MyOrg123",
        ]
        for org in valid_orgs:
            assert validate_org_name(org), f"'{org}' should be valid"

    def test_invalid_orgs(self):
        """Invalid organization names should fail validation."""
        invalid_orgs = [
            "",
            "ab",  # too short
            "-org",  # starts with hyphen
        ]
        for org in invalid_orgs:
            assert not validate_org_name(org), f"'{org}' should be invalid"


class TestParseAgentId:
    """Tests for parse_agent_id function."""

    def test_parse_simple_format(self):
        """Parse simple format without prefix."""
        result = parse_agent_id("my-agent")
        assert result.agent_name == "my-agent"
        assert result.org is None
        assert result.format == AgentIDFormat.SIMPLE

    def test_parse_simple_format_with_org(self):
        """Parse simple format with organization."""
        result = parse_agent_id("my-agent@my-org")
        assert result.agent_name == "my-agent"
        assert result.org == "my-org"
        assert result.format == AgentIDFormat.SIMPLE

    def test_parse_level2_format(self):
        """Parse Level 2 format (openagents:xxx)."""
        result = parse_agent_id("openagents:my-agent")
        assert result.agent_name == "my-agent"
        assert result.org is None
        assert result.format == AgentIDFormat.LEVEL_2

    def test_parse_level2_format_with_org(self):
        """Parse Level 2 format with organization."""
        result = parse_agent_id("openagents:my-agent@my-org")
        assert result.agent_name == "my-agent"
        assert result.org == "my-org"
        assert result.format == AgentIDFormat.LEVEL_2

    def test_parse_level3_format(self):
        """Parse Level 3 DID format."""
        result = parse_agent_id("did:openagents:my-agent")
        assert result.agent_name == "my-agent"
        assert result.org is None
        assert result.format == AgentIDFormat.LEVEL_3

    def test_parse_level3_format_with_org(self):
        """Parse Level 3 DID format with organization."""
        result = parse_agent_id("did:openagents:my-agent@my-org")
        assert result.agent_name == "my-agent"
        assert result.org == "my-org"
        assert result.format == AgentIDFormat.LEVEL_3

    def test_parse_with_whitespace(self):
        """Parse agent ID with leading/trailing whitespace."""
        result = parse_agent_id("  openagents:my-agent  ")
        assert result.agent_name == "my-agent"

    def test_parse_invalid_empty(self):
        """Empty string should raise error."""
        with pytest.raises(AgentIDFormatError):
            parse_agent_id("")

    def test_parse_invalid_name(self):
        """Invalid agent name should raise error."""
        with pytest.raises(AgentIDFormatError):
            parse_agent_id("openagents:ab")  # too short

    def test_parse_invalid_multiple_at(self):
        """Multiple @ symbols should raise error."""
        with pytest.raises(AgentIDFormatError):
            parse_agent_id("openagents:my-agent@org@extra")

    def test_parse_empty_after_prefix(self):
        """Empty name after prefix should raise error."""
        with pytest.raises(AgentIDFormatError):
            parse_agent_id("openagents:")


class TestNormalizeFunctions:
    """Tests for normalization functions."""

    def test_normalize_to_level2_from_simple(self):
        """Normalize simple format to Level 2."""
        assert normalize_to_level2("my-agent") == "openagents:my-agent"
        assert normalize_to_level2("my-agent@org") == "openagents:my-agent@org"

    def test_normalize_to_level2_from_level2(self):
        """Normalize Level 2 format to Level 2 (no change)."""
        assert normalize_to_level2("openagents:my-agent") == "openagents:my-agent"

    def test_normalize_to_level2_from_level3(self):
        """Normalize Level 3 format to Level 2."""
        assert normalize_to_level2("did:openagents:my-agent") == "openagents:my-agent"

    def test_normalize_to_level3_from_simple(self):
        """Normalize simple format to Level 3."""
        assert normalize_to_level3("my-agent") == "did:openagents:my-agent"
        assert normalize_to_level3("my-agent@org") == "did:openagents:my-agent@org"

    def test_normalize_to_level3_from_level2(self):
        """Normalize Level 2 format to Level 3."""
        assert normalize_to_level3("openagents:my-agent") == "did:openagents:my-agent"

    def test_normalize_to_level3_from_level3(self):
        """Normalize Level 3 format to Level 3 (no change)."""
        assert normalize_to_level3("did:openagents:my-agent") == "did:openagents:my-agent"

    def test_normalize_to_simple(self):
        """Normalize any format to simple format."""
        assert normalize_to_simple("my-agent") == "my-agent"
        assert normalize_to_simple("openagents:my-agent") == "my-agent"
        assert normalize_to_simple("did:openagents:my-agent") == "my-agent"
        assert normalize_to_simple("openagents:my-agent@org") == "my-agent@org"


class TestExtractComponents:
    """Tests for extract_components function."""

    def test_extract_from_simple(self):
        """Extract from simple format."""
        name, org = extract_components("my-agent")
        assert name == "my-agent"
        assert org is None

    def test_extract_with_org(self):
        """Extract with organization."""
        name, org = extract_components("openagents:my-agent@my-org")
        assert name == "my-agent"
        assert org == "my-org"

    def test_extract_from_did(self):
        """Extract from DID format."""
        name, org = extract_components("did:openagents:my-agent@org")
        assert name == "my-agent"
        assert org == "org"


class TestIsValidAgentId:
    """Tests for is_valid_agent_id function."""

    def test_valid_ids(self):
        """Valid agent IDs should return True."""
        valid_ids = [
            "my-agent",
            "openagents:my-agent",
            "did:openagents:my-agent",
            "openagents:my-agent@my-org",
        ]
        for agent_id in valid_ids:
            assert is_valid_agent_id(agent_id), f"'{agent_id}' should be valid"

    def test_invalid_ids(self):
        """Invalid agent IDs should return False."""
        invalid_ids = [
            "",
            "ab",  # too short
            "openagents:",  # empty name
            "my-agent@",  # empty org
        ]
        for agent_id in invalid_ids:
            assert not is_valid_agent_id(agent_id), f"'{agent_id}' should be invalid"


class TestGetFormat:
    """Tests for get_format function."""

    def test_get_simple_format(self):
        """Get format for simple IDs."""
        assert get_format("my-agent") == AgentIDFormat.SIMPLE
        assert get_format("my-agent@org") == AgentIDFormat.SIMPLE

    def test_get_level2_format(self):
        """Get format for Level 2 IDs."""
        assert get_format("openagents:my-agent") == AgentIDFormat.LEVEL_2

    def test_get_level3_format(self):
        """Get format for Level 3 IDs."""
        assert get_format("did:openagents:my-agent") == AgentIDFormat.LEVEL_3


class TestParsedAgentIDProperties:
    """Tests for ParsedAgentID model properties."""

    def test_full_name_without_org(self):
        """Full name without org should be just the agent name."""
        result = parse_agent_id("my-agent")
        assert result.full_name == "my-agent"

    def test_full_name_with_org(self):
        """Full name with org should include @org suffix."""
        result = parse_agent_id("openagents:my-agent@my-org")
        assert result.full_name == "my-agent@my-org"

    def test_level_2_id_property(self):
        """level_2_id property should return correct format."""
        result = parse_agent_id("my-agent@org")
        assert result.level_2_id == "openagents:my-agent@org"

    def test_level_3_id_property(self):
        """level_3_id property should return correct format."""
        result = parse_agent_id("my-agent@org")
        assert result.level_3_id == "did:openagents:my-agent@org"
