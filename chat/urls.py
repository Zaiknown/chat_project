# chat/urls.py
from django.urls import path
from . import views

app_name = 'chat' # Essencial para o namespace 'chat' funcionar

urlpatterns = [
    path('dm/<str:username>/', views.start_dm_view, name='start-dm'),
    # ADICIONE ESTA LINHA
    path('<str:room_name>/delete/', views.delete_room_view, name='delete-room'),

    path('heartbeat/', views.heartbeat_view, name='heartbeat'),
    path('<str:room_name>/', views.chat_room_view, name='chat-room'),
]