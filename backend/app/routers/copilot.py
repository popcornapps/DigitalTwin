from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.copilot import service
from app.schemas.copilot import CopilotChatRequest

router = APIRouter(prefix='/api/copilot', tags=['copilot'])


@router.post('/chat')
def chat(req: CopilotChatRequest):
    # conversation_id is resolved up front (cheap, synchronous) so it can go
    # out as a response header immediately, before the streamed reply body -
    # the client needs it right away to keep tagging this conversation on
    # every later message, not just once the full reply has finished.
    conv_id = service.resolve_conversation_id(req.conversation_id)
    return StreamingResponse(
        service.stream_chat_message(conv_id, req.persona, req.running_batch_id, req.message),
        media_type='text/plain',
        headers={'X-Conversation-Id': conv_id},
    )
