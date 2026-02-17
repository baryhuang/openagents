import os
import aiohttp
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class N8nClient:
    """Helper client to interact with n8n API and webhooks."""

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        """Initialize the n8n client.

        Args:
            base_url: The base URL of the n8n instance.
            api_key: The API key for n8n authentication.
        """
        self.base_url = base_url or os.environ.get("N8N_BASE_URL", "http://localhost:5678")
        self.api_key = api_key or os.environ.get("N8N_API_KEY", "")
        
        if not self.api_key:
            logger.warning("N8N_API_KEY not set. Some n8n interactions may fail.")

    async def call_workflow(self, workflow_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Trigger an n8n workflow via webhook.

        Args:
            workflow_id: The ID or path part of the n8n webhook URL.
            payload: The data to send to the workflow.

        Returns:
            Dict[str, Any]: The response from n8n.
        """
        # Ensure base_url doesn't end with slash for consistent joining
        base = self.base_url.rstrip("/")
        # n8n webhooks usually follow the pattern: BASE_URL/webhook/WORKFLOW_ID
        url = f"{base}/webhook/{workflow_id}"

        headers = {
            "Content-Type": "application/json"
        }
        if self.api_key:
            headers["X-N8N-API-KEY"] = self.api_key

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status >= 400:
                        error_text = await response.text()
                        logger.error(f"n8n workflow call failed: {response.status} - {error_text}")
                        return {"success": False, "error": error_text, "status": response.status}
                    
                    data = await response.json()
                    return {"success": True, "data": data}
        except Exception as e:
            logger.exception(f"Error calling n8n workflow {workflow_id}")
            return {"success": False, "error": str(e)}

    async def interact_with_agent(self, session_id: str, message: str, chat_webhook_id: Optional[str] = None) -> Dict[str, Any]:
        """Interact with an n8n AI Agent node.

        Args:
            session_id: Unique session identifier for the chat.
            message: The message to send to the agent.
            chat_webhook_id: The specific webhook ID for the chat integration (optional).

        Returns:
            Dict[str, Any]: The response from the n8n agent.
        """
        # Default webhook path for chat if not provided
        webhook_id = chat_webhook_id or "chat"
        payload = {
            "sessionId": session_id,
            "action": "sendMessage",
            "chatInput": message
        }
        
        return await self.call_workflow(webhook_id, payload)
