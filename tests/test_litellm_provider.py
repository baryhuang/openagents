"""Tests for LiteLLM provider."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestLiteLLMProviderInit:
    def test_requires_litellm_installed(self):
        with patch.dict("sys.modules", {"litellm": None}):
            from openagents.lms.providers import LiteLLMProvider

            with pytest.raises(ImportError, match="litellm"):
                LiteLLMProvider(model_name="openai/gpt-4o")

    def test_stores_model_name(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="anthropic/claude-sonnet-4-6")
        assert provider.model_name == "anthropic/claude-sonnet-4-6"

    def test_stores_api_key(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o", api_key="sk-test")
        assert provider._api_key == "sk-test"

    def test_stores_api_base(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o", api_base="http://localhost:4000")
        assert provider._api_base == "http://localhost:4000"

    def test_api_key_none_by_default(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o")
        assert provider._api_key is None

    def test_api_base_none_by_default(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o")
        assert provider._api_base is None


class TestLiteLLMProviderChatCompletion:
    @pytest.mark.asyncio
    async def test_chat_completion_basic(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o-mini")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Hello!"
        mock_response.choices[0].message.tool_calls = None
        mock_response.usage.prompt_tokens = 10
        mock_response.usage.completion_tokens = 5
        mock_response.usage.total_tokens = 15

        with patch("litellm.acompletion", new_callable=AsyncMock, return_value=mock_response) as mock:
            result = await provider.chat_completion([{"role": "user", "content": "Hi"}])

            assert result["content"] == "Hello!"
            assert result["usage"]["prompt_tokens"] == 10
            call_kwargs = mock.call_args.kwargs
            assert call_kwargs["model"] == "openai/gpt-4o-mini"
            assert call_kwargs["drop_params"] is True

    @pytest.mark.asyncio
    async def test_chat_completion_forwards_api_key(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o", api_key="sk-test")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "ok"
        mock_response.choices[0].message.tool_calls = None
        mock_response.usage = None

        with patch("litellm.acompletion", new_callable=AsyncMock, return_value=mock_response) as mock:
            await provider.chat_completion([{"role": "user", "content": "test"}])
            assert mock.call_args.kwargs["api_key"] == "sk-test"

    @pytest.mark.asyncio
    async def test_chat_completion_forwards_api_base(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o", api_base="http://proxy:4000")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "ok"
        mock_response.choices[0].message.tool_calls = None
        mock_response.usage = None

        with patch("litellm.acompletion", new_callable=AsyncMock, return_value=mock_response) as mock:
            await provider.chat_completion([{"role": "user", "content": "test"}])
            assert mock.call_args.kwargs["api_base"] == "http://proxy:4000"

    @pytest.mark.asyncio
    async def test_chat_completion_omits_api_key_when_none(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "ok"
        mock_response.choices[0].message.tool_calls = None
        mock_response.usage = None

        with patch("litellm.acompletion", new_callable=AsyncMock, return_value=mock_response) as mock:
            await provider.chat_completion([{"role": "user", "content": "test"}])
            assert "api_key" not in mock.call_args.kwargs

    @pytest.mark.asyncio
    async def test_chat_completion_with_tools(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o")

        mock_tc = MagicMock()
        mock_tc.id = "call_123"
        mock_tc.function.name = "get_weather"
        mock_tc.function.arguments = '{"city": "Paris"}'

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = None
        mock_response.choices[0].message.tool_calls = [mock_tc]
        mock_response.usage = None

        with patch("litellm.acompletion", new_callable=AsyncMock, return_value=mock_response):
            result = await provider.chat_completion(
                [{"role": "user", "content": "Weather?"}],
                tools=[{"name": "get_weather", "parameters": {}}],
            )
            assert len(result["tool_calls"]) == 1
            assert result["tool_calls"][0]["name"] == "get_weather"

    @pytest.mark.asyncio
    async def test_format_tools(self):
        from openagents.lms.providers import LiteLLMProvider

        provider = LiteLLMProvider(model_name="openai/gpt-4o")

        mock_tool = MagicMock()
        mock_tool.to_openai_function.return_value = {"name": "test", "parameters": {}}

        result = provider.format_tools([mock_tool])
        assert result == [{"name": "test", "parameters": {}}]
