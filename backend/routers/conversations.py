"""
API для управления conversations и messages
Поддержка keyword и semantic search через embeddings
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
import numpy as np

from ..database import get_db, init_db
from ..models.conversation import Conversation
from ..models.message import Message
from ..services.embeddings_service import generate_embedding

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

# Инициализация БД при импорте модуля
init_db()


# Pydantic схемы для запросов/ответов
class ConversationCreate(BaseModel):
    user_id: Optional[str] = None
    title: Optional[str] = None


class ConversationResponse(BaseModel):
    id: str
    user_id: Optional[str]
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    model: Optional[str] = None
    message_metadata: Optional[dict] = None


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    agent_id: Optional[str]
    agent_name: Optional[str]
    model: Optional[str]
    timestamp: datetime
    message_metadata: Optional[dict]
    
    class Config:
        from_attributes = True


class ConversationSearchRequest(BaseModel):
    query: str
    limit: int = 10
    use_semantic: bool = True  # Использовать semantic search через embeddings


class ConversationSearchResponse(BaseModel):
    conversations: List[ConversationResponse]
    messages: List[MessageResponse]


@router.post("", response_model=ConversationResponse)
async def create_conversation(
    conversation: ConversationCreate,
    db: Session = Depends(get_db)
):
    """Создать новую conversation"""
    import uuid
    import traceback
    
    try:
        conv_id = f"conv_{uuid.uuid4().hex[:16]}"
        db_conversation = Conversation(
            id=conv_id,
            user_id=conversation.user_id,
            title=conversation.title
        )
        db.add(db_conversation)
        db.commit()
        db.refresh(db_conversation)
        return db_conversation
    except Exception as e:
        error_msg = f"Ошибка создания conversation: {str(e)}\n{traceback.format_exc()}"
        print(f"❌ {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/{conversation_id}/messages", response_model=MessageResponse)
async def add_message(
    conversation_id: str,
    message: MessageCreate,
    db: Session = Depends(get_db)
):
    """Добавить message в conversation"""
    # Проверяем существование conversation
    db_conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not db_conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    import uuid
    
    msg_id = f"msg_{uuid.uuid4().hex[:16]}"
    
    # Генерируем embedding для semantic search (опционально)
    embedding = None
    if message.content and message.content.strip():
        embedding = generate_embedding(message.content)
        # Если embedding пустой (нет API ключа или ошибка), просто продолжаем без него
    
    db_message = Message(
        id=msg_id,
        conversation_id=conversation_id,
        role=message.role,
        content=message.content,
        embedding=embedding,
        agent_id=message.agent_id,
        agent_name=message.agent_name,
        model=message.model,
        message_metadata=message.message_metadata
    )
    
    db.add(db_message)
    
    # Обновляем updated_at conversation
    db_conversation.updated_at = datetime.now(timezone.utc)
    
    # Если это первое сообщение и нет title, генерируем из первого сообщения
    if not db_conversation.title and message.content:
        title = message.content[:100] + ("..." if len(message.content) > 100 else "")
        db_conversation.title = title
    
    db.commit()
    db.refresh(db_message)
    return db_message


@router.post("/search", response_model=ConversationSearchResponse)
async def search_conversations(
    request: ConversationSearchRequest,
    db: Session = Depends(get_db)
):
    """Поиск по conversations (keyword + semantic)"""
    query = request.query.strip()
    if not query:
        return ConversationSearchResponse(conversations=[], messages=[])
    
    # Keyword search по содержимому сообщений
    keyword_messages = db.query(Message).filter(
        Message.content.ilike(f"%{query}%")
    ).limit(request.limit * 2).all()
    
    # Получаем уникальные conversation_id
    conversation_ids = list(set([msg.conversation_id for msg in keyword_messages]))
    
    # Semantic search (если включен и есть embeddings)
    if request.use_semantic:
        query_embedding = generate_embedding(query)
        if query_embedding:
            # Простой cosine similarity поиск
            # В production лучше использовать pgvector или специализированную БД
            all_messages = db.query(Message).filter(
                Message.embedding.isnot(None)
            ).limit(1000).all()
            
            # Вычисляем similarity для каждого сообщения
            similarities = []
            for msg in all_messages:
                if msg.embedding:
                    try:
                        similarity = np.dot(query_embedding, msg.embedding) / (
                            np.linalg.norm(query_embedding) * np.linalg.norm(msg.embedding)
                        )
                        similarities.append((similarity, msg))
                    except:
                        pass
            
            # Сортируем по similarity и берем топ результаты
            similarities.sort(key=lambda x: x[0], reverse=True)
            semantic_messages = [msg for _, msg in similarities[:request.limit]]
            
            # Добавляем conversation_id из semantic search
            semantic_conv_ids = list(set([msg.conversation_id for msg in semantic_messages]))
            conversation_ids.extend(semantic_conv_ids)
            
            # Объединяем результаты
            keyword_messages.extend(semantic_messages)
        # Если embedding пустой (нет API ключа), просто продолжаем без semantic search
    
    # Получаем conversations
    conversations = db.query(Conversation).filter(
        Conversation.id.in_(conversation_ids[:request.limit])
    ).all()
    
    # Убираем дубликаты сообщений
    seen_msg_ids = set()
    unique_messages = []
    for msg in keyword_messages:
        if msg.id not in seen_msg_ids:
            seen_msg_ids.add(msg.id)
            unique_messages.append(msg)
    
    return ConversationSearchResponse(
        conversations=conversations,
        messages=unique_messages[:request.limit]
    )


@router.get("/recent", response_model=List[ConversationResponse])
async def get_recent_conversations(
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """Получить последние conversations"""
    conversations = db.query(Conversation).order_by(
        Conversation.updated_at.desc()
    ).limit(limit).all()
    return conversations


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db)
):
    """Получить conversation по ID"""
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/{conversation_id}/messages", response_model=List[MessageResponse])
async def get_conversation_messages(
    conversation_id: str,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Получить messages для conversation"""
    messages = db.query(Message).filter(
        Message.conversation_id == conversation_id
    ).order_by(Message.timestamp.asc()).limit(limit).all()
    return messages

