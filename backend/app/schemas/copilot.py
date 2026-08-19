from pydantic import BaseModel


class CopilotChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    persona: str = 'Plant Operator'
    # Optional hint only (e.g. a batch detail page could pass "the batch this
    # page is showing") - never required by the router/service/UI. The
    # copilot resolves which batch(es) a question is about itself, via the
    # list_running_batches tool, so this never gates what can be asked.
    running_batch_id: str | None = None


class CopilotChatResponse(BaseModel):
    reply: str
    conversation_id: str
