from pydantic import BaseModel


class CopilotHistoryTurn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class CopilotChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    persona: str = 'Plant Operator'
    # Optional hint only (e.g. a batch detail page could pass "the batch this
    # page is showing") - never required by the router/service/UI. The
    # copilot resolves which batch(es) a question is about itself, via the
    # list_running_batches tool, so this never gates what can be asked.
    running_batch_id: str | None = None
    # Client-supplied conversation history (the messages already visible in
    # the chat UI) - the frontend keeps these regardless of the backend's own
    # 1-hour-inactivity conversation_store, so a user returning after a long
    # gap still gets real context instead of a silently-forgotten chat. Only
    # the latest 5 EXCHANGES (10 entries) are ever used (see
    # app.copilot.service.stream_chat_message's HISTORY_EXCHANGE_LIMIT) -
    # the client may send more or fewer, the server enforces the cap.
    history: list[CopilotHistoryTurn] = []


class CopilotChatResponse(BaseModel):
    reply: str
    conversation_id: str
