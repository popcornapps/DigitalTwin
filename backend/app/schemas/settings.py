from pydantic import BaseModel


class AIModeOut(BaseModel):
    mode: str  # 'static' | 'agent_llm'


class AIModeIn(BaseModel):
    mode: str
