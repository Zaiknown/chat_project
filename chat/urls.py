# chat/urls.py
from django.urls import path
from . import views

app_name = 'chat' # Essencial para o namespace 'chat' funcionar

urlpatterns = [
    path('join/<str:room_name>/', views.join_room, name='join_room'),
    path('leave/<str:room_name>/', views.leave_room, name='leave_room'),
    path('dm/<str:username>/', views.start_dm_view, name='start-dm'),
    path('<str:room_name>/delete/', views.delete_room_view, name='delete-room'),

    path('heartbeat/', views.heartbeat_view, name='heartbeat'),
        path('<str:room_name>/', views.chat_room_view, name='chat_room'),
    path('clear_chat/<str:room_name>/', views.clear_chat, name='clear_chat'),
]