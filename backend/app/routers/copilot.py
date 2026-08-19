from fastapi import APIRouter

from app.copilot import service
from app.schemas.copilot import CopilotChatRequest, CopilotChatResponse

router = APIRouter(prefix='/api/copilot', tags=['copilot'])


@router.post('/chat', response_model=CopilotChatResponse)
def chat(req: CopilotChatRequest):
    result = service.handle_chat_message(req.conversation_id, req.persona, req.running_batch_id, req.message)
    return CopilotChatResponse(**result)
