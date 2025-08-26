# chat/urls.py
from django.urls import path
from . import views

app_name = 'chat' # Essencial para o namespace 'chat' funcionar

urlpatterns = [
    path('join/<slug:room_slug>/', views.join_room, name='join_room'),
    path('leave/<slug:room_slug>/', views.leave_room, name='leave_room'),
    path('dm/<str:username>/', views.start_dm_view, name='start-dm'),
    path('<slug:room_slug>/delete/', views.delete_room_view, name='delete-room'),

    path('heartbeat/', views.heartbeat_view, name='heartbeat'),
    path('<slug:room_slug>/', views.chat_room_view, name='chat_room'),
    path('clear_chat/<slug:room_slug>/', views.clear_chat, name='clear_chat'),
]